import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';

/**
 * Handlers for status and monitoring commands
 */
export class StatusHandlers extends BaseHandler {
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
      message += `• \`${task.id.substring(0, 8)}\` - ${task.prompt.substring(0, 40)}... (${UIHelpers.formatDuration(elapsed)})\n`;
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

    // Try to send log file first
    const logFilePath = this.executor.getTaskLogFilePath(taskId);
    if (logFilePath) {
      try {
        await this.bot.sendDocument(chatId, logFilePath, {
          caption: `📋 Task Execution Log\n\nTask ID: \`${taskId.substring(0, 8)}\`\nStatus: ${task.status}\nPrompt: ${task.prompt.substring(0, 100)}...`
        }, {
          filename: `task-${taskId.substring(0, 8)}.log`,
          contentType: 'text/plain'
        });
        return;
      } catch (error) {
        logger.warn('Failed to send log file, falling back to text', {
          taskId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Fallback to in-memory output if log file not available
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
}

