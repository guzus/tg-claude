import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ChamberService } from '../services/ChamberService';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ChamberHandlers {
  private chamberService: ChamberService;

  constructor(private bot: TelegramBot) {
    this.chamberService = new ChamberService(bot);
  }

  async handleChamber(msg: Message, match: RegExpExecArray | null): Promise<void> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;

    if (!userId || !config.allowedUserIds.includes(userId)) {
      await this.bot.sendMessage(chatId, '⛔ Access denied');
      return;
    }

    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0] || 'status';
    const topic = args.slice(1).join(' ');

    try {
      switch (subcommand) {
        case 'start':
          await this.handleStart(chatId, topic);
          break;

        case 'stop':
          await this.handleStop(chatId);
          break;

        case 'status':
        default:
          await this.handleStatus(chatId);
          break;
      }
    } catch (error) {
      logger.error('Chamber command error', {
        userId,
        subcommand,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.bot.sendMessage(chatId, '❌ An error occurred');
    }
  }

  private async handleStart(chatId: number, topic?: string): Promise<void> {
    const result = await this.chamberService.startConversation(topic || undefined);
    await this.bot.sendMessage(chatId, `🏛️ ${result}`, { parse_mode: 'Markdown' });
  }

  private async handleStop(chatId: number): Promise<void> {
    const result = await this.chamberService.stopConversation();
    await this.bot.sendMessage(chatId, `🛑 ${result}`, { parse_mode: 'Markdown' });
  }

  private async handleStatus(chatId: number): Promise<void> {
    const status = this.chamberService.getStatus();

    if (status.isRunning) {
      await this.bot.sendMessage(
        chatId,
        `🏛️ *Chamber Mode*\n\n` +
        `Status: 🟢 Running\n` +
        `Session: \`${status.sessionId}\`\n` +
        `Messages: ${status.messageCount}\n\n` +
        `Commands:\n` +
        `/chamber stop - Stop the conversation`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await this.bot.sendMessage(
        chatId,
        `🏛️ *Chamber Mode*\n\n` +
        `Status: 🔴 Stopped\n\n` +
        `An endless conversation between GLM and Anthropic models, broadcast to @claude_glm.\n\n` +
        `Commands:\n` +
        `/chamber start [topic] - Start conversation\n` +
        `/chamber stop - Stop conversation\n` +
        `/chamber status - Check status`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}
