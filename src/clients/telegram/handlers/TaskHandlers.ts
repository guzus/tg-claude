import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { TaskStatus, ClaudeTaskWithStreaming } from '../../../types';
import { logger } from '../../../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { ClaudeExecutorInstance } from '../../../services/IClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { ConversationManager } from '../../../services/ConversationManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { gitService } from '../../../services/GitService';
import { getErrorMessage } from '../../../utils/errors';
import { getProviderLabel } from '../../../utils/providers';
import { formatDuration } from '../../../utils/time';

/**
 * Handlers for task execution commands
 */
export class TaskHandlers extends BaseHandler {
  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutorInstance,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    conversationManager?: ConversationManager,
    userConfigManager?: UserConfigManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
  }

  resumeTaskMonitor(params: {
    taskId: string;
    userId: number;
    chatId: number;
    messageId: number;
    workingDir?: string;
    aiProvider?: { provider?: string };
  }): void {
    this.monitorTaskLifecycle(
      params.taskId,
      params.userId,
      params.chatId,
      params.messageId,
      params.workingDir,
      params.aiProvider
    );
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
          reply_to_message_id: msg.message_id,
          reply_markup: {
            inline_keyboard: [[
              { text: '🛑 Cancel', callback_data: 'cancel_pending' }
            ]]
          }
        }
      );

      // Get user-specific timeout if available
      const userTimeout = await this.getUserTimeout(userId);

      // Get user's AI provider configuration
      const userConfig = await this.userConfigManager?.getConfig(userId);
      const aiProvider = userConfig?.aiProvider;

      // Execute task
      const task = this.executor.startTask(userId, chatId, prompt, {
        workingDir: actualWorkingDir,
        timeout: userTimeout,
        aiProvider
      });

      task.messageId = statusMsg.message_id;
      this.executor.setTaskMessageId(task.id, statusMsg.message_id);

      this.monitorTaskLifecycle(
        task.id,
        userId,
        chatId,
        statusMsg.message_id,
        actualWorkingDir,
        aiProvider,
        startTime,
        username,
        commitMessageContext
      );

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);

      this.auditLogger.logCommand({
        userId,
        username,
        command: commitMessageContext,
        success: false,
        executionTime,
        error: errorMessage,
        platform: 'telegram'
      });

      logger.error('Task execution failed', {
        userId,
        prompt: commitMessageContext.substring(0, 100),
        error: errorMessage
      });
    }
  }

  private monitorTaskLifecycle(
    taskId: string,
    userId: number,
    chatId: number,
    messageId: number,
    workingDir?: string,
    aiProvider?: { provider?: string },
    startTime = Date.now(),
    username?: string,
    commitMessageContext?: string
  ): void {
    let lastUpdateText = '';

    const updateInterval = setInterval(async () => {
      const currentTask = this.executor.getTask(taskId) as ClaudeTaskWithStreaming | undefined;
      if (!currentTask) {
        clearInterval(updateInterval);
        return;
      }

      if (currentTask.status === TaskStatus.RUNNING) {
        const elapsed = Math.round((Date.now() - currentTask.startTime.getTime()) / 1000);
        const providerLabel = getProviderLabel(aiProvider?.provider);
        const newUpdateText = this.buildStreamingStatusMessage(currentTask, elapsed, providerLabel);
        const controlButtons = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🛑 Cancel', callback_data: `cancel_task:${taskId}` },
                { text: '📋 Full Log', callback_data: `view_log:${taskId}` }
              ]
            ]
          }
        };

        if (newUpdateText !== lastUpdateText) {
          try {
            await this.bot.editMessageText(newUpdateText, {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown',
              ...controlButtons
            });
            lastUpdateText = newUpdateText;
          } catch (error) {
            logger.debug('Failed to update message', {
              taskId,
              error: getErrorMessage(error)
            });
          }
        }
        return;
      }

      clearInterval(updateInterval);

      const output = this.executor.getTaskOutput(taskId);
      const errorOutput = currentTask.errorOutput || '';
      const statusEmoji = currentTask.status === TaskStatus.COMPLETED ? '✅' : '❌';
      const statusText = currentTask.status === TaskStatus.COMPLETED ? 'Completed' : 'Failed';

      const executionTime = currentTask.endTime
        ? Math.round((currentTask.endTime.getTime() - currentTask.startTime.getTime()) / 1000)
        : 0;

      let commitInfo = '';
      let needsRemoteSetup = false;
      if (currentTask.status === TaskStatus.COMPLETED && workingDir) {
        try {
          const commitHash = await gitService.autoCommit(workingDir);
          let shouldPush = false;

          if (commitHash) {
            shouldPush = true;
          } else {
            const hasUnpushedCommits = await gitService.hasUnpushedCommits(workingDir);
            if (hasUnpushedCommits) {
              shouldPush = true;
            }
          }

          if (shouldPush) {
            const pushResult = (await gitService.push(workingDir)).status;

            if (pushResult === 'success') {
              commitInfo = ' · Pushed ✓';
            } else if (pushResult === 'no_remote') {
              needsRemoteSetup = true;
            }
          }
        } catch (error) {
          logger.error('Auto-commit/push failed', {
            taskId,
            error: getErrorMessage(error)
          });
        }
      }

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

      const currentRepo = this.repositoryManager.getCurrentRepository(userId);
      const repoFooter = UIHelpers.createRepositoryFooter(currentRepo || null);

      const streamingTask = currentTask as ClaudeTaskWithStreaming;
      const providerName = getProviderLabel(aiProvider?.provider);
      let statsLine = formatDuration(executionTime);
      if (streamingTask.costUsd && streamingTask.costUsd > 0) {
        statsLine += ` · $${streamingTask.costUsd.toFixed(2)}`;
      }
      statsLine += ` · ${providerName}`;

      let commitsInfo = '';
      if (workingDir && currentRepo?.gitUrl) {
        const commits = await this.executor.getTaskCommits(taskId, workingDir);
        if (commits.length > 0) {
          const webUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);
          if (webUrl) {
            commitsInfo = '\n';
            for (const c of commits.slice(0, 3)) {
              const shortHash = c.hash.substring(0, 7);
              const shortMsg = c.message.length > 45 ? c.message.substring(0, 42) + '...' : c.message;
              commitsInfo += `› [\`${shortHash}\`](${webUrl}/commit/${c.hash}) ${shortMsg}\n`;
            }
            if (commits.length > 3) {
              commitsInfo += `_+${commits.length - 3} more_\n`;
            }
          }
        }
        this.executor.cleanupTaskHead(taskId);
      }

      const completedEvent = streamingTask.events?.find(e => e.type === 'completed');
      let answerPreview = '';
      if (completedEvent && completedEvent.type === 'completed' && completedEvent.answer) {
        const answer = completedEvent.answer;
        answerPreview = answer.length > 400 ? answer.substring(0, 400) + '...' : answer;
      }

      const finalMessage =
        `${statusEmoji} *${statusText}* · ${statsLine}${commitInfo}\n` +
        (answerPreview ? `\n${answerPreview}\n` : '') +
        commitsInfo +
        repoFooter;

      const completionButtons = {
        inline_keyboard: [
          [
            { text: '📋 View Log', callback_data: `view_log:${taskId}` }
          ]
        ]
      };

      try {
        await this.bot.editMessageText(finalMessage, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: completionButtons
        });
      } catch {
        const shortMessage =
          `${statusEmoji} *${statusText}* · ${statsLine}${commitInfo}\n` +
          commitsInfo +
          repoFooter;

        try {
          await this.bot.editMessageText(shortMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: completionButtons
          });
        } catch {
          await this.bot.editMessageText(
            `${statusEmoji} *${statusText}* · ${statsLine}${commitInfo}`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown',
              reply_markup: completionButtons
            }
          ).catch(() => {});
        }
      }

      if (needsRemoteSetup && workingDir) {
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
                  { text: '✅ Create Public Repository', callback_data: `create_repo_public_${workingDir}` },
                  { text: '🔒 Create Private Repository', callback_data: `create_repo_private_${workingDir}` }
                ],
                [
                  { text: '❌ Skip', callback_data: 'create_repo_skip' }
                ]
              ]
            }
          }
        );
      }

      this.auditLogger.logCommand({
        userId,
        username,
        command: commitMessageContext || currentTask.prompt,
        taskId,
        success: currentTask.status === TaskStatus.COMPLETED,
        executionTime,
        error: currentTask.status !== TaskStatus.COMPLETED ? currentTask.errorOutput : undefined,
        platform: 'telegram'
      });
    }, 2000);
  }

  /**
   * Handle task command (deprecated - use plain messages instead)
   */
  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(chatId, '❌ Please provide a task description');
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
   * Handle plain text messages
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
        '• /repo add <path> - Add existing repository\n' +
        '• /scan - Scan for already-synced repositories',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📁 Setup Repository', callback_data: 'repo_menu' }],
              [{ text: '📋 List Repositories', callback_data: 'repo_list' }]
            ]
          }
        }
      );
      return;
    }

    // Add user message to conversation history
    this.conversationManager?.addUserMessage(userId, userMessage, currentRepo.id);

    // Execute task with user's prompt
    await this.executeAndStream(msg, userMessage);
  }

  /**
   * Build a status message from streaming events (delegates to UIHelpers)
   */
  private buildStreamingStatusMessage(task: ClaudeTaskWithStreaming, elapsed: number, provider: string = 'Claude'): string {
    return UIHelpers.buildStreamingStatusMessage(task, elapsed, provider);
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
