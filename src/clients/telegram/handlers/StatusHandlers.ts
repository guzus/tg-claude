import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { formatDuration } from '../../../utils/time';

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
      message += `• \`${task.id.substring(0, 8)}\` - ${task.prompt.substring(0, 40)}... (${formatDuration(elapsed)})\n`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

}
