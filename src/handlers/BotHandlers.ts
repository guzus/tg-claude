import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { TaskStatus } from '../types';
import { isAuthorized, extractCommandContext } from '../middleware/security';
import { logger } from '../utils/logger';

export class BotHandlers {
  constructor(
    private bot: TelegramBot,
    private executor: ClaudeExecutor,
    private rateLimiter: RateLimiter,
    private auditLogger: AuditLogger
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

    try {
      // Send initial status message
      const statusMsg = await this.bot.sendMessage(
        chatId,
        `🤖 Task started...\n\n\`\`\`\n${prompt.substring(0, 200)}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Execute task
      const task = await this.executor.executeTask(userId, chatId, prompt, {
        workingDir
      });

      task.messageId = statusMsg.message_id;

      // Poll for updates
      const updateInterval = setInterval(async () => {
        const currentTask = this.executor.getTask(task.id);
        if (!currentTask) {
          clearInterval(updateInterval);
          return;
        }

        // Update message if task is still running
        if (currentTask.status === TaskStatus.RUNNING) {
          const output = this.executor.getTaskOutput(task.id);
          const preview = output.slice(-1500);

          try {
            await this.bot.editMessageText(
              `🔄 Processing...\n\n\`\`\`\n${preview}\n\`\`\``,
              {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              }
            );
          } catch (error) {
            // Ignore edit errors (message not modified, etc.)
          }
        } else {
          // Task completed
          clearInterval(updateInterval);

          const output = this.executor.getTaskOutput(task.id);
          const statusEmoji = currentTask.status === TaskStatus.COMPLETED ? '✅' : '❌';
          const statusText = currentTask.status === TaskStatus.COMPLETED ? 'Completed' : 'Failed';

          const executionTime = currentTask.endTime
            ? Math.round((currentTask.endTime.getTime() - currentTask.startTime.getTime()) / 1000)
            : 0;

          const finalMessage =
            `${statusEmoji} ${statusText}\n\n` +
            `Exit code: ${currentTask.exitCode || 0}\n` +
            `Time: ${executionTime}s\n\n` +
            `\`\`\`\n${output.slice(-2500)}\n\`\`\``;

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
              Buffer.from(output),
              {},
              {
                filename: 'output.txt',
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
      }, 3000); // Update every 3 seconds

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
        `/task <description> - Execute a task\n` +
        `/commit <message> - Commit and push changes\n` +
        `/read <url> - Read documentation\n` +
        `/review - Review code changes\n` +
        `/test - Run tests\n` +
        `/build - Build project\n` +
        `/status - Check active tasks\n` +
        `/cancel <taskId> - Cancel a task\n` +
        `/limits - Check your rate limits\n` +
        `/help - Show this help message\n\n` +
        `Example:\n` +
        `\`/task Fix the login bug in auth.js\``,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * /task command
   */
  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    if (!match || !match[1]) {
      await this.bot.sendMessage(msg.chat.id, '❌ Usage: /task <description>');
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
}

export default BotHandlers;
