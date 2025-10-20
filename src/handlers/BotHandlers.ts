import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { TaskStatus, RepositoryType } from '../types';
import { isAuthorized } from '../middleware/security';
import { logger } from '../utils/logger';

export class BotHandlers {
  constructor(
    private bot: TelegramBot,
    private executor: ClaudeExecutor,
    private rateLimiter: RateLimiter,
    private auditLogger: AuditLogger,
    private repositoryManager: RepositoryManager
  ) {}

  /**
   * Check authorization and rate limits
   */
  private async checkAccess(msg: Message): Promise<boolean> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;

    if (!userId) {
      return false;
    }

    // Check authorization
    if (!isAuthorized(userId)) {
      await this.bot.sendMessage(chatId, '🚫 Unauthorized access');
      logger.warn('Unauthorized access attempt', { userId });
      return false;
    }

    // Check rate limits
    const rateLimitResult = this.rateLimiter.checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      await this.bot.sendMessage(chatId, `⏱️ ${rateLimitResult.reason}`);
      return false;
    }

    return true;
  }

  /**
   * Get working directory for user (from current repo or default)
   */
  private getWorkingDirectory(userId: number, override?: string): string {
    if (override) {
      return override;
    }

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    return currentRepo?.path || process.cwd();
  }

  /**
   * Execute a Claude task and stream output
   */
  private async executeAndStream(
    msg: Message,
    prompt: string,
    workingDir?: string
  ): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const startTime = Date.now();

    // Use current repository if no working directory specified
    const actualWorkingDir = this.getWorkingDirectory(userId, workingDir);

    try {
      // Send initial status message
      const statusMsg = await this.bot.sendMessage(
        chatId,
        `🤖 Task started...\n\n\`\`\`\n${prompt.substring(0, 200)}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Execute task
      const task = await this.executor.executeTask(userId, chatId, prompt, {
        workingDir: actualWorkingDir
      });

      task.messageId = statusMsg.message_id;

      // Track last update to avoid hitting rate limits
      let lastUpdateText = '';
      let updateCount = 0;

      // Poll for updates
      const updateInterval = setInterval(async () => {
        const currentTask = this.executor.getTask(task.id);
        if (!currentTask) {
          clearInterval(updateInterval);
          return;
        }

        // Update message if task is still running
        if (currentTask.status === TaskStatus.RUNNING) {
          updateCount++;
          const elapsed = Math.round((Date.now() - currentTask.startTime.getTime()) / 1000);

          // Get both stdout and stderr
          const output = this.executor.getTaskOutput(task.id);
          const errorOutput = currentTask.errorOutput || '';

          // Combine outputs
          let combinedOutput = '';
          if (output) {
            combinedOutput += output;
          }
          if (errorOutput) {
            combinedOutput += (combinedOutput ? '\n---STDERR---\n' : '') + errorOutput;
          }

          // If no output yet, show waiting message
          if (!combinedOutput.trim()) {
            combinedOutput = `⏳ Waiting for Claude to respond...\n\nElapsed: ${elapsed}s\nThis may take a few moments as Claude analyzes your request.`;
          }

          const preview = combinedOutput.slice(-1500);
          const newUpdateText =
            `🔄 Processing... (${elapsed}s)\n\n` +
            `Updates: ${updateCount}\n` +
            `Output size: ${combinedOutput.length} chars\n\n` +
            `\`\`\`\n${preview}\n\`\`\``;

          // Only update if text has changed (avoid rate limit errors)
          if (newUpdateText !== lastUpdateText) {
            try {
              await this.bot.editMessageText(newUpdateText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              });
              lastUpdateText = newUpdateText;
            } catch (error) {
              // Ignore edit errors (message not modified, rate limit, etc.)
              logger.debug('Failed to update message', {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } else {
          // Task completed
          clearInterval(updateInterval);

          const output = this.executor.getTaskOutput(task.id);
          const errorOutput = currentTask.errorOutput || '';
          const statusEmoji = currentTask.status === TaskStatus.COMPLETED ? '✅' : '❌';
          const statusText = currentTask.status === TaskStatus.COMPLETED ? 'Completed' : 'Failed';

          const executionTime = currentTask.endTime
            ? Math.round((currentTask.endTime.getTime() - currentTask.startTime.getTime()) / 1000)
            : 0;

          // Combine outputs for final display
          let fullOutput = '';
          if (output) {
            fullOutput += output;
          }
          if (errorOutput) {
            fullOutput += (fullOutput ? '\n\n---STDERR---\n' : '') + errorOutput;
          }
          if (!fullOutput.trim()) {
            fullOutput = 'No output captured';
          }

          const finalMessage =
            `${statusEmoji} ${statusText}\n\n` +
            `Exit code: ${currentTask.exitCode || 0}\n` +
            `Time: ${executionTime}s\n` +
            `Total output: ${fullOutput.length} chars\n\n` +
            `\`\`\`\n${fullOutput.slice(-2500)}\n\`\`\``;

          try {
            await this.bot.editMessageText(finalMessage, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown'
            });
          } catch (error) {
            // If message is too long, send as document
            await this.bot.sendDocument(
              chatId,
              Buffer.from(fullOutput),
              {},
              {
                filename: 'task-output.txt',
                contentType: 'text/plain'
              }
            );
          }

          // Log audit entry
          this.auditLogger.logCommand({
            userId,
            username,
            command: prompt,
            taskId: task.id,
            success: currentTask.status === TaskStatus.COMPLETED,
            executionTime,
            error: currentTask.status !== TaskStatus.COMPLETED ? currentTask.errorOutput : undefined
          });
        }
      }, 2000); // Update every 2 seconds

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);

      this.auditLogger.logCommand({
        userId,
        username,
        command: prompt,
        success: false,
        executionTime,
        error: errorMessage
      });

      logger.error('Task execution failed', {
        userId,
        prompt: prompt.substring(0, 100),
        error: errorMessage
      });
    }
  }

  /**
   * /start command
   */
  async handleStart(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const username = msg.from?.first_name || 'there';

    await this.bot.sendMessage(
      chatId,
      `👋 Hello ${username}!\n\n` +
        `🤖 *Claude Code Remote Control Bot*\n\n` +
        `Available commands:\n\n` +
        `📁 *Repository Management:*\n` +
        `/repo - Manage repositories (clone/new/list/switch)\n\n` +
        `🛠️ *Development:*\n` +
        `/task <description> - Execute a task\n` +
        `/commit <message> - Commit and push changes\n` +
        `/read <url> - Read documentation\n` +
        `/review - Review code changes\n` +
        `/test - Run tests\n` +
        `/build - Build project\n\n` +
        `ℹ️ *Status & Help:*\n` +
        `/status - Check active tasks\n` +
        `/cancel <taskId> - Cancel a task\n` +
        `/limits - Check your rate limits\n` +
        `/help - Show this help message\n\n` +
        `💡 *Quick Start:*\n` +
        `1. Use \`/repo clone <url>\` to clone a repository\n` +
        `2. Use \`/task <description>\` to execute tasks\n` +
        `3. Use \`/repo list\` to see your repositories`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * /task command
   */
  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(chatId, '❌ Usage: /task <description>');
      return;
    }

    // Check if user has a repository set up
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        `⚠️ No active repository!\n\n` +
          `Please set up a repository first:\n` +
          `• /repo clone <url> - Clone a repository\n` +
          `• /repo new <name> - Create a new repository\n` +
          `• /repo add <path> - Add existing repository\n\n` +
          `Example: \`/repo new my-calculator-app\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const taskDescription = match[1].trim();
    await this.executeAndStream(msg, taskDescription);
  }

  /**
   * /commit command
   */
  async handleCommit(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    if (!match || !match[1]) {
      await this.bot.sendMessage(msg.chat.id, '❌ Usage: /commit <message>');
      return;
    }

    const commitMessage = match[1].trim();
    const prompt = `Create a git commit with message: "${commitMessage}" and push to remote`;
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /read command
   */
  async handleRead(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    if (!match || !match[1]) {
      await this.bot.sendMessage(msg.chat.id, '❌ Usage: /read <url>');
      return;
    }

    const url = match[1].trim();
    const prompt = `Read and summarize the documentation at ${url}`;
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /review command
   */
  async handleReview(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Review the current code changes and provide feedback';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /test command
   */
  async handleTest(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Run all tests and report results';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /build command
   */
  async handleBuild(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Build the project and fix any errors';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /status command
   */
  async handleStatus(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    const activeTasks = this.executor.getActiveTasksForUser(userId);

    if (activeTasks.length === 0) {
      await this.bot.sendMessage(chatId, '✅ No active tasks');
      return;
    }

    let message = `📊 Active Tasks (${activeTasks.length}):\n\n`;

    for (const task of activeTasks) {
      const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000);
      message += `• \`${task.id.substring(0, 8)}\` - ${task.prompt.substring(0, 40)}... (${elapsed}s)\n`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * /cancel command
   */
  async handleCancel(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(chatId, '❌ Usage: /cancel <taskId>');
      return;
    }

    const taskId = match[1].trim();
    const success = this.executor.cancelTask(taskId);

    if (success) {
      await this.bot.sendMessage(chatId, '✅ Task cancelled');
    } else {
      await this.bot.sendMessage(chatId, '❌ Task not found or already completed');
    }
  }

  /**
   * /limits command
   */
  async handleLimits(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    const remaining = this.rateLimiter.getRemainingRequests(userId);
    const stats = this.rateLimiter.getUserStats(userId);

    let message = '📊 *Your Rate Limits*\n\n';
    message += `Remaining this hour: ${remaining.hourly}\n`;
    message += `Remaining today: ${remaining.daily}\n`;

    if (stats) {
      message += `\nRequests this hour: ${stats.requestsThisHour}\n`;
      message += `Requests today: ${stats.requestsToday}`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * /help command
   */
  async handleHelp(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    await this.handleStart(msg);
  }

  /**
   * /check command - Check Claude CLI installation and setup
   */
  async handleCheck(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    await this.bot.sendMessage(chatId, '🔍 Checking Claude CLI setup...');

    try {
      const { spawn } = require('child_process');

      // Check if claude command exists
      const whichClaude = spawn('which', ['claude']);
      let claudePath = '';

      whichClaude.stdout?.on('data', (data: Buffer) => {
        claudePath += data.toString();
      });

      await new Promise((resolve) => {
        whichClaude.on('close', async (code: number) => {
          if (code !== 0 || !claudePath.trim()) {
            await this.bot.sendMessage(
              chatId,
              '❌ *Claude CLI not found*\n\n' +
              'Please install it first:\n' +
              '```bash\n' +
              'npm install -g @anthropic-ai/claude-code\n' +
              '# or\n' +
              'curl -fsSL https://claude.ai/install.sh | sh\n' +
              '```\n\n' +
              'Then authenticate:\n' +
              '```bash\nclaude login\n```',
              { parse_mode: 'Markdown' }
            );
          } else {
            // Check version
            const versionCheck = spawn('claude', ['--version']);
            let version = '';

            versionCheck.stdout?.on('data', (data: Buffer) => {
              version += data.toString();
            });

            versionCheck.on('close', async () => {
              const currentRepo = this.repositoryManager.getCurrentRepository(userId);

              await this.bot.sendMessage(
                chatId,
                '✅ *Claude CLI Status*\n\n' +
                `📍 Path: \`${claudePath.trim()}\`\n` +
                `📦 Version: ${version.trim() || 'Unable to detect'}\n\n` +
                `📁 Current Repo: ${currentRepo ? currentRepo.name : '❌ None (use /repo)'}\n` +
                `📂 Working Dir: ${currentRepo ? '`' + currentRepo.path + '`' : 'N/A'}\n\n` +
                `🔐 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '⚠️ Using CLI auth'}\n\n` +
                `To test, try:\n\`/task say hello\``,
                { parse_mode: 'Markdown' }
              );
            });
          }
          resolve(null);
        });
      });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        '❌ Error checking setup: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * /debug command - Run a simple test to debug Claude CLI
   */
  async handleDebug(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '⚠️ No active repository! Create one first:\n`/repo new test-debug`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      '🐛 *Debug Mode - Running Test Task*\n\n' +
      'Testing Claude CLI with a simple command...\n' +
      `Working directory: \`${currentRepo.path}\``,
      { parse_mode: 'Markdown' }
    );

    // Run a simple test command
    await this.executeAndStream(msg, 'echo "Hello from Claude" > test.txt');
  }

  /**
   * /logs command - Get full output of a task
   */
  async handleLogs(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: /logs <taskId>\n\nGet the task ID from /status command.'
      );
      return;
    }

    const taskId = match[1].trim();
    const task = this.executor.getTask(taskId);

    if (!task) {
      await this.bot.sendMessage(chatId, '❌ Task not found');
      return;
    }

    const fullOutput = task.output || '';
    const errorOutput = task.errorOutput || '';
    let combinedOutput = '';

    if (fullOutput) {
      combinedOutput += '=== STDOUT ===\n' + fullOutput;
    }
    if (errorOutput) {
      combinedOutput += '\n\n=== STDERR ===\n' + errorOutput;
    }
    if (!combinedOutput.trim()) {
      combinedOutput = 'No output captured yet.';
    }

    // Send as document if too large
    if (combinedOutput.length > 3000) {
      await this.bot.sendDocument(
        chatId,
        Buffer.from(combinedOutput),
        {},
        {
          filename: `task-${taskId.substring(0, 8)}-logs.txt`,
          contentType: 'text/plain'
        }
      );
    } else {
      await this.bot.sendMessage(
        chatId,
        `📋 *Task Logs*\n\n` +
          `Task ID: \`${taskId.substring(0, 8)}\`\n` +
          `Status: ${task.status}\n` +
          `Prompt: ${task.prompt.substring(0, 100)}...\n\n` +
          `\`\`\`\n${combinedOutput}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * /scan command - Rescan for repositories
   */
  async handleScan(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;

    await this.bot.sendMessage(chatId, '🔍 Scanning for repositories...');

    try {
      const result = await this.repositoryManager.rescan();

      await this.bot.sendMessage(
        chatId,
        `✅ *Repository Scan Complete*\n\n` +
          `👥 Users: ${result.usersFound}\n` +
          `📁 New repositories found: ${result.reposFound}\n\n` +
          `Use \`/repo list\` to see all repositories.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        '❌ Scan failed: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  }

  /**
   * /repo command - Repository management
   */
  async handleRepo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    if (!subcommand) {
      await this.bot.sendMessage(
        chatId,
        `📁 *Repository Management*\n\n` +
          `Commands:\n` +
          `/repo clone <git-url> [name] [branch] - Clone a repository\n` +
          `/repo new <name> - Create new repository\n` +
          `/repo add <path> [name] - Add existing repository\n` +
          `/repo list - List all repositories\n` +
          `/repo switch <id> - Switch to repository\n` +
          `/repo current - Show current repository\n` +
          `/repo delete <id> - Delete repository\n\n` +
          `💡 Tip: Use \`/scan\` to discover existing repos\n\n` +
          `Examples:\n` +
          `\`/repo clone https://github.com/user/repo.git\`\n` +
          `\`/repo new my-project\`\n` +
          `\`/repo list\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'clone':
          await this.handleRepoClone(msg, args.slice(1));
          break;
        case 'new':
          await this.handleRepoNew(msg, args.slice(1));
          break;
        case 'add':
          await this.handleRepoAdd(msg, args.slice(1));
          break;
        case 'list':
          await this.handleRepoList(msg);
          break;
        case 'switch':
          await this.handleRepoSwitch(msg, args.slice(1));
          break;
        case 'current':
          await this.handleRepoCurrent(msg);
          break;
        case 'delete':
          await this.handleRepoDelete(msg, args.slice(1));
          break;
        default:
          await this.bot.sendMessage(
            chatId,
            `❌ Unknown subcommand: ${subcommand}\nUse /repo to see available commands.`
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      logger.error('Repository command failed', {
        userId: msg.from?.id,
        subcommand,
        error: errorMessage
      });
    }
  }

  /**
   * Clone repository
   */
  private async handleRepoClone(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: /repo clone <git-url> [name] [branch]'
      );
      return;
    }

    const gitUrl = args[0];
    const name = args[1];
    const branch = args[2];

    const statusMsg = await this.bot.sendMessage(
      chatId,
      `🔄 Cloning repository...\n\`${gitUrl}\``,
      { parse_mode: 'Markdown' }
    );

    try {
      const repo = await this.repositoryManager.cloneRepository(
        userId,
        gitUrl,
        name,
        branch
      );

      await this.bot.editMessageText(
        `✅ Repository cloned successfully!\n\n` +
          `📁 Name: ${repo.name}\n` +
          `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
          `📂 Path: \`${repo.path}\`\n` +
          `🌿 Branch: ${repo.branch || 'default'}\n\n` +
          `This repository is now active. Use /task to work on it.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.editMessageText(`❌ Failed to clone repository:\n${errorMessage}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Create new repository
   */
  private async handleRepoNew(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo new <name>');
      return;
    }

    const name = args[0];

    try {
      const repo = await this.repositoryManager.createRepository(userId, name);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository created successfully!\n\n` +
          `📁 Name: ${repo.name}\n` +
          `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
          `📂 Path: \`${repo.path}\`\n\n` +
          `This repository is now active. Use /task to work on it.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to create repository:\n${errorMessage}`);
    }
  }

  /**
   * Add existing repository
   */
  private async handleRepoAdd(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo add <path> [name]');
      return;
    }

    const repoPath = args[0];
    const name = args[1];

    try {
      const repo = await this.repositoryManager.addExistingRepository(
        userId,
        repoPath,
        name
      );

      await this.bot.sendMessage(
        chatId,
        `✅ Repository added successfully!\n\n` +
          `📁 Name: ${repo.name}\n` +
          `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
          `📂 Path: \`${repo.path}\`\n` +
          `${repo.gitUrl ? `🔗 Remote: ${repo.gitUrl}\n` : ''}\n` +
          `This repository is now active. Use /task to work on it.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to add repository:\n${errorMessage}`);
    }
  }

  /**
   * List repositories
   */
  private async handleRepoList(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const repositories = this.repositoryManager.listRepositories(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (repositories.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `📁 No repositories yet.\n\n` +
          `Use:\n` +
          `• /repo clone <url> to clone a repository\n` +
          `• /repo new <name> to create a new one\n` +
          `• /repo add <path> to add an existing one`
      );
      return;
    }

    let message = `📁 *Your Repositories (${repositories.length})*\n\n`;

    for (const repo of repositories) {
      const isCurrent = currentRepo?.id === repo.id;
      const typeEmoji =
        repo.type === RepositoryType.CLONED
          ? '📥'
          : repo.type === RepositoryType.NEW
          ? '✨'
          : '📂';

      message +=
        `${isCurrent ? '▶️ ' : ''}${typeEmoji} *${repo.name}*\n` +
        `   ID: \`${repo.id.substring(0, 8)}\`\n` +
        `   Path: \`${repo.path}\`\n`;

      if (repo.gitUrl) {
        message += `   Remote: ${repo.gitUrl}\n`;
      }

      message += `\n`;
    }

    message += `Use \`/repo switch <id>\` to switch repositories.`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Switch repository
   */
  private async handleRepoSwitch(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo switch <id>');
      return;
    }

    const partialId = args[0];

    // Find repository by partial ID
    const repositories = this.repositoryManager.listRepositories(userId);
    const repo = repositories.find((r) => r.id.startsWith(partialId));

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `❌ Repository not found with ID: ${partialId}\nUse /repo list to see available repositories.`
      );
      return;
    }

    try {
      this.repositoryManager.switchRepository(userId, repo.id);

      await this.bot.sendMessage(
        chatId,
        `✅ Switched to repository: *${repo.name}*\n\n` +
          `📂 Path: \`${repo.path}\`\n` +
          `${repo.gitUrl ? `🔗 Remote: ${repo.gitUrl}\n` : ''}\n` +
          `Use /task to work on this repository.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to switch repository:\n${errorMessage}`);
    }
  }

  /**
   * Show current repository
   */
  private async handleRepoCurrent(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const repo = this.repositoryManager.getCurrentRepository(userId);

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `📁 No active repository.\n\n` +
          `Use:\n` +
          `• /repo clone <url> to clone a repository\n` +
          `• /repo new <name> to create a new one\n` +
          `• /repo list to see all repositories`
      );
      return;
    }

    const typeEmoji =
      repo.type === RepositoryType.CLONED
        ? '📥 Cloned'
        : repo.type === RepositoryType.NEW
        ? '✨ New'
        : '📂 Existing';

    await this.bot.sendMessage(
      chatId,
      `▶️ *Current Repository*\n\n` +
        `📁 Name: ${repo.name}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${repo.path}\`\n` +
        `📝 Type: ${typeEmoji}\n` +
        `${repo.gitUrl ? `🔗 Remote: ${repo.gitUrl}\n` : ''}` +
        `${repo.branch ? `🌿 Branch: ${repo.branch}\n` : ''}` +
        `🕒 Last used: ${repo.lastUsed.toLocaleString()}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Delete repository
   */
  private async handleRepoDelete(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo delete <id>');
      return;
    }

    const partialId = args[0];

    // Find repository by partial ID
    const repositories = this.repositoryManager.listRepositories(userId);
    const repo = repositories.find((r) => r.id.startsWith(partialId));

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `❌ Repository not found with ID: ${partialId}\nUse /repo list to see available repositories.`
      );
      return;
    }

    try {
      await this.repositoryManager.deleteRepository(userId, repo.id);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository deleted: *${repo.name}*\n\n` +
          `${repo.type !== RepositoryType.EXISTING ? 'Directory removed from disk.' : 'Reference removed (directory kept).'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to delete repository:\n${errorMessage}`);
    }
  }
}

export default BotHandlers;
