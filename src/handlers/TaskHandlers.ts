import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { TaskStatus, StreamAction, ClaudeTaskWithStreaming } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { PromptBuilder } from '../utils/PromptBuilder';
import { BeastModeExecutor } from '../services/BeastModeExecutor';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { UserConfigManager } from '../services/UserConfigManager';

/**
 * Handlers for task execution commands
 */
export class TaskHandlers extends BaseHandler {
  private beastModeExecutor: BeastModeExecutor;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    conversationManager?: ConversationManager,
    userConfigManager?: UserConfigManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
    this.beastModeExecutor = new BeastModeExecutor(bot, executor, repositoryManager);
  }

  /**
   * Get the beast mode executor (for callback handlers)
   */
  getBeastModeExecutor(): BeastModeExecutor {
    return this.beastModeExecutor;
  }

  /**
   * Execute a Claude task and stream output
   */
  async executeAndStream(
    msg: Message,
    prompt: string,
    workingDir?: string,
    originalUserRequest?: string
  ): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const startTime = Date.now();

    // Use current repository if no working directory specified
    const actualWorkingDir = this.getWorkingDirectory(userId, workingDir);

    // Use original user request for commit messages, fallback to prompt
    const commitMessageContext = originalUserRequest || prompt;

    try {
      // Send initial status message as reply to user's instruction
      const statusMsg = await this.bot.sendMessage(
        chatId,
        `⏳ Starting...`,
        {
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id
        }
      );

      // Get user-specific timeout if available
      const userTimeout = await this.getUserTimeout(userId);

      // Get user's AI provider configuration
      const userConfig = await this.userConfigManager?.getConfig(userId);
      const aiProvider = userConfig?.aiProvider;

      // Execute task
      const task = await this.executor.executeTask(userId, chatId, prompt, {
        workingDir: actualWorkingDir,
        timeout: userTimeout,
        aiProvider
      });

      task.messageId = statusMsg.message_id;

      // Track last update to avoid hitting rate limits
      let lastUpdateText = '';

      // Poll for updates
      const updateInterval = setInterval(async () => {
        const currentTask = this.executor.getTask(task.id) as ClaudeTaskWithStreaming | undefined;
        if (!currentTask) {
          clearInterval(updateInterval);
          return;
        }

        // Update message if task is still running
        if (currentTask.status === TaskStatus.RUNNING) {
          const elapsed = Math.round((Date.now() - currentTask.startTime.getTime()) / 1000);

          // Build status message using streaming events
          const newUpdateText = this.buildStreamingStatusMessage(currentTask, elapsed);

          // Create control buttons
          const controlButtons = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🛑 Cancel', callback_data: `cancel_task:${task.id}` },
                  { text: '📋 Full Log', callback_data: `view_log:${task.id}` }
                ]
              ]
            }
          };

          // Only update if text has changed (avoid rate limit errors)
          if (newUpdateText !== lastUpdateText) {
            try {
              await this.bot.editMessageText(newUpdateText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                ...controlButtons
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

          // Auto-commit and push changes if task completed successfully
          let commitInfo = '';
          let needsRemoteSetup = false;
          if (currentTask.status === TaskStatus.COMPLETED && actualWorkingDir) {
            try {
              const commitHash = await this.executor.autoCommitChanges(actualWorkingDir);
              let shouldPush = false;

              if (commitHash) {
                shouldPush = true;
              } else {
                // Check if there are unpushed commits
                const hasUnpushedCommits = await this.executor.hasUnpushedCommits(actualWorkingDir);
                if (hasUnpushedCommits) {
                  shouldPush = true;
                }
              }

              // Attempt push if there are commits to push
              if (shouldPush) {
                const pushResult = await this.executor.autoPushChanges(actualWorkingDir);

                if (pushResult === 'success') {
                  commitInfo = ' · Pushed ✓';
                } else if (pushResult === 'no_remote') {
                  needsRemoteSetup = true;
                }
              }
            } catch (error) {
              logger.error('Auto-commit/push failed', {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

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

          // Get repository info for quick access
          const currentRepo = this.repositoryManager.getCurrentRepository(userId);
          const repoFooter = UIHelpers.createRepositoryFooter(currentRepo || null);

          // Build clean stats line
          const streamingTask = currentTask as ClaudeTaskWithStreaming;
          let statsLine = UIHelpers.formatDuration(executionTime);
          if (streamingTask.costUsd && streamingTask.costUsd > 0) {
            statsLine += ` · $${streamingTask.costUsd.toFixed(2)}`;
          }

          // Get commits made during task execution
          let commitsInfo = '';
          if (actualWorkingDir && currentRepo?.gitUrl) {
            const commits = await this.executor.getTaskCommits(task.id, actualWorkingDir);
            if (commits.length > 0) {
              const webUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);
              if (webUrl) {
                // Clean commit links on one line
                const commitLinks = commits.slice(0, 3).map(c =>
                  `[\`${c.hash.substring(0, 7)}\`](${webUrl}/commit/${c.hash})`
                ).join(' ');
                const moreText = commits.length > 3 ? ` +${commits.length - 3}` : '';
                commitsInfo = `\n📝 ${commitLinks}${moreText}\n`;
              }
            }
            // Clean up task head tracking
            this.executor.cleanupTaskHead(task.id);
          }

          // Get final answer from streaming events (if available)
          const completedEvent = streamingTask.events?.find(e => e.type === 'completed');
          let answerPreview = '';
          if (completedEvent && completedEvent.type === 'completed' && completedEvent.answer) {
            const answer = completedEvent.answer;
            answerPreview = answer.length > 400 ? answer.substring(0, 400) + '...' : answer;
          }

          // Build clean final message
          const finalMessage =
            `${statusEmoji} *${statusText}* · ${statsLine}${commitInfo}\n` +
            (answerPreview ? `\n${answerPreview}\n` : '') +
            commitsInfo +
            repoFooter;

          // Completion buttons - just one row
          const completionButtons = {
            inline_keyboard: [
              [
                { text: '📋 View Log', callback_data: `view_log:${task.id}` }
              ]
            ]
          };

          try {
            await this.bot.editMessageText(finalMessage, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown',
              reply_markup: completionButtons
            });

            // Send log file as a document
            const logFilePath = this.executor.getTaskLogFilePath(task.id);
            if (logFilePath) {
              await this.bot.sendDocument(chatId, logFilePath, {
                caption: `📋 Full execution log for task \`${task.id.substring(0, 8)}\``,
                parse_mode: 'Markdown'
              }, {
                filename: `task-${task.id.substring(0, 8)}.log`,
                contentType: 'text/plain'
              });
            }
          } catch (error) {
            // If message is too long, send parsed answer as document (not raw JSON)
            const documentContent = completedEvent?.type === 'completed' && completedEvent.answer
              ? completedEvent.answer
              : fullOutput;
            await this.bot.sendDocument(
              chatId,
              Buffer.from(documentContent),
              {},
              {
                filename: 'task-result.txt',
                contentType: 'text/plain'
              }
            );

            // Send repo dashboard separately
            if (currentRepo) {
              const { message: repoMessage, keyboard: repoKeyboard } =
                UIHelpers.createRepositoryDashboard(currentRepo);
              await this.bot.sendMessage(chatId, repoMessage, {
                parse_mode: 'Markdown',
                reply_markup: repoKeyboard
              });
            }
          }

          // Prompt user to create remote repository if needed
          if (needsRemoteSetup && actualWorkingDir) {
            await this.bot.sendMessage(
              chatId,
              '📦 *Create GitHub Repository?*\n\n' +
              'Your changes have been committed locally but no remote repository exists.\n\n' +
              'Would you like to create a GitHub repository and push your changes?',
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Create Public Repository', callback_data: `create_repo_public_${actualWorkingDir}` },
                      { text: '🔒 Create Private Repository', callback_data: `create_repo_private_${actualWorkingDir}` }
                    ],
                    [
                      { text: '❌ Skip', callback_data: 'create_repo_skip' }
                    ]
                  ]
                }
              }
            );
          }

          // Log audit entry
          this.auditLogger.logCommand({
            userId,
            username,
            command: commitMessageContext,
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
        command: commitMessageContext,
        success: false,
        executionTime,
        error: errorMessage
      });

      logger.error('Task execution failed', {
        userId,
        prompt: commitMessageContext.substring(0, 100),
        error: errorMessage
      });
    }
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

    // Augment prompt to instruct AI to commit and push changes
    const augmentedPrompt = `${taskDescription}

IMPORTANT: After completing the coding task:
1. Use git commands to stage all changes (git add .)
2. Create a commit with a descriptive message using: git commit -m "your message"
3. Push changes to the remote repository using: git push
4. If there's no remote repository set up, initialize one and push using gh CLI:
   - gh repo create (if needed)
   - git push -u origin main (or appropriate branch)

Always commit and push your changes after completing the task unless explicitly told not to.`;

    await this.executeAndStream(msg, augmentedPrompt, undefined, taskDescription);
  }

  /**
   * Handle plain text messages (no /task prefix needed)
   */
  async handlePlainMessage(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const userMessage = msg.text || '';

    // Get current repository
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '📁 *No repository selected*\n\n' +
        'Please set up a repository first:\n' +
        '• /repo clone <url> - Clone a repository\n' +
        '• /repo new <name> - Create new repository\n' +
        '• /scan - Scan for existing repositories',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Add user message to conversation history
    this.conversationManager?.addUserMessage(userId, userMessage, currentRepo.id);

    // Get conversation context
    const context = this.conversationManager?.getContext(userId);

    // Build enhanced prompt with context
    const enhancedPrompt = PromptBuilder.buildEnhancedPrompt(
      userMessage,
      currentRepo,
      context,
      false // Not beast mode for plain messages
    );

    // Execute with enhanced prompt, passing original user message for commit messages
    await this.executeAndStream(msg, enhancedPrompt, undefined, userMessage);
  }

  /**
   * Execute task in beast mode (autonomous execution loop)
   */
  async executeBeastMode(msg: Message, userRequest: string): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '❌ Beast mode requires an active repository.\n\n' +
        'Set up a repository first with:\n' +
        '• `/repo clone <url>` - Clone a repository\n' +
        '• `/repo new <name>` - Create a new repository',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!userRequest.trim()) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: `/beast <task description>`\n\n' +
        'Example: `/beast implement user authentication with JWT`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Add to conversation
    this.conversationManager?.addUserMessage(userId, `[BEAST MODE] ${userRequest}`, currentRepo.id);

    try {
      // Start beast mode session
      await this.bot.sendMessage(
        chatId,
        '🔥 **Starting Beast Mode**\n\n' +
        `Task: ${userRequest.substring(0, 200)}${userRequest.length > 200 ? '...' : ''}\n\n` +
        'Beast mode will autonomously:\n' +
        '• Execute the task\n' +
        '• Fix any errors or test failures\n' +
        '• Iterate until complete\n\n' +
        '_Starting autonomous execution..._',
        { parse_mode: 'Markdown' }
      );

      // Get user's AI provider configuration
      const userConfig = await this.userConfigManager?.getConfig(userId);
      const aiProvider = userConfig?.aiProvider;

      await this.beastModeExecutor.startSession(
        userId,
        chatId,
        userRequest,
        currentRepo.path,
        {},
        aiProvider
      );

      logger.info('Beast mode session started', {
        userId,
        request: userRequest.substring(0, 100),
        repository: currentRepo.name
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.bot.sendMessage(
        chatId,
        `❌ Failed to start beast mode: ${errorMessage}`
      );

      logger.error('Failed to start beast mode', {
        userId,
        error: errorMessage
      });
    }
  }

  /**
   * Stop beast mode for a user
   */
  async stopBeastMode(userId: number, chatId: number): Promise<boolean> {
    const stopped = this.beastModeExecutor.stopSessionByUser(userId);

    if (stopped) {
      await this.bot.sendMessage(
        chatId,
        '🛑 Beast mode stopped.',
        { parse_mode: 'Markdown' }
      );
    }

    return stopped;
  }

  /**
   * Build a status message from streaming events
   */
  private buildStreamingStatusMessage(task: ClaudeTaskWithStreaming, elapsed: number): string {
    const lines: string[] = [];

    // Clean header with time
    lines.push(`⏳ *${UIHelpers.formatDuration(elapsed)}*`);

    // Recent completed actions (last 3, more compact)
    const recentEvents = task.events
      .filter((e): e is { type: 'action'; action: StreamAction; phase: 'completed'; ok?: boolean; message?: string } =>
        e.type === 'action' && e.phase === 'completed'
      )
      .slice(-3);

    if (recentEvents.length > 0 || task.currentAction) {
      lines.push('');

      // Show recent actions
      for (const event of recentEvents) {
        const icon = event.ok === false ? '✗' : '›';
        const actionTitle = this.formatAction(event.action);
        lines.push(`${icon} ${actionTitle}`);
      }

      // Current action (if any)
      if (task.currentAction) {
        lines.push(`› ${this.formatAction(task.currentAction)}...`);
      }
    } else {
      lines.push('');
      lines.push('_Starting..._');
    }

    return lines.join('\n');
  }

  /**
   * Format an action for display
   */
  private formatAction(action: StreamAction): string {
    let title = action.title;

    // Truncate long titles
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }

    // Escape markdown special characters
    title = title.replace(/[_*`[\]]/g, '\\$&');

    return title;
  }

  /**
   * Parse Claude's output to extract current action/file being worked on
   * @deprecated Use streaming events instead
   */
  private parseCurrentAction(output: string): string | null {
    if (!output) return null;

    const lines = output.split('\n');
    const recentLines = lines.slice(-50); // Look at last 50 lines

    // Look for common Claude Code patterns
    for (let i = recentLines.length - 1; i >= 0; i--) {
      const line = recentLines[i].trim();

      // Reading files
      if (line.match(/Reading|Read.*file|Opening/i)) {
        const fileMatch = line.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]/);
        if (fileMatch) return `Reading ${fileMatch[1]}`;
      }

      // Writing/editing files
      if (line.match(/Writing|Wrote|Editing|Modified|Updated/i)) {
        const fileMatch = line.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]/);
        if (fileMatch) return `Editing ${fileMatch[1]}`;
      }

      // Running commands
      if (line.match(/Running|Executing|Command:/i)) {
        const cmdMatch = line.match(/Running|Executing|Command:\s*(.{0,50})/i);
        if (cmdMatch) return `Running: ${cmdMatch[1] || 'command'}`;
      }

      // Git operations
      if (line.match(/git (add|commit|push|pull|clone)/i)) {
        const gitOp = line.match(/git\s+(\w+)/i);
        if (gitOp) return `Git ${gitOp[1]}`;
      }

      // Installing packages
      if (line.match(/npm install|yarn add|pnpm add|pip install/i)) {
        return 'Installing dependencies';
      }

      // Building/compiling
      if (line.match(/Building|Compiling|Bundling/i)) {
        return 'Building project';
      }

      // Testing
      if (line.match(/Running tests|Testing/i)) {
        return 'Running tests';
      }
    }

    return null;
  }
}

