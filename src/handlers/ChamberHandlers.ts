import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ChamberService } from '../services/ChamberService';
import { RepositoryManager } from '../services/RepositoryManager';
import { config } from '../config';
import { logger } from '../utils/logger';

export class ChamberHandlers {
  private chamberService: ChamberService;

  constructor(
    private bot: TelegramBot,
    private repositoryManager: RepositoryManager
  ) {
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
          await this.handleStart(chatId, userId, topic);
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

  private async handleStart(chatId: number, userId: number, topic?: string): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '❌ No repository selected.\n\nCreate one first:\n`/repo new chamber-1`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const result = await this.chamberService.startConversation(
      currentRepo.path,
      currentRepo.name,
      topic || undefined
    );
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
        `Repo: \`${status.repoName}\`\n` +
        `Topic: ${status.topic}\n` +
        `Turns: ${status.turnCount}\n\n` +
        `Commands:\n` +
        `/chamber stop - Stop the conversation`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await this.bot.sendMessage(
        chatId,
        `🏛️ *Chamber Mode*\n\n` +
        `Status: 🔴 Stopped\n\n` +
        `Both AIs share the current repo. They read CONVERSATION.md, respond, commit & push.\n\n` +
        `Usage:\n` +
        `1. \`/repo new chamber-1\` - Create a repo\n` +
        `2. \`/chamber start [topic]\` - Start conversation\n\n` +
        `Commands:\n` +
        `/chamber start [topic]\n` +
        `/chamber stop\n` +
        `/chamber status`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}
