import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { ConversationManager } from '../../../services/ConversationManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { stateManager } from '../../../services/StateManager';
import { isAuthorized } from '../middleware/security';
import { logger } from '../../../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';

export abstract class BaseHandler {
  constructor(
    protected bot: TelegramBot,
    protected executor: ClaudeExecutor,
    protected rateLimiter: RateLimiter,
    protected auditLogger: AuditLogger,
    protected repositoryManager: RepositoryManager,
    protected conversationManager?: ConversationManager,
    protected userConfigManager?: UserConfigManager
  ) { }

  protected async checkAccess(msg: Message): Promise<boolean> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;

    if (!userId) return false;

    if (!isAuthorized(userId)) {
      await this.bot.sendMessage(chatId, 'Unauthorized access');
      logger.warn('Unauthorized access attempt', { userId });
      return false;
    }

    const rateLimitResult = this.rateLimiter.checkRateLimit(userId);
    if (!rateLimitResult.allowed) {
      await this.bot.sendMessage(chatId, `Rate limit: ${rateLimitResult.reason}`);
      return false;
    }

    return true;
  }

  protected getWorkingDirectory(userId: number, override?: string): string {
    if (override) return override;
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    return currentRepo?.path || process.cwd();
  }

  protected async getUserTimeout(userId: number): Promise<number | undefined> {
    if (!this.userConfigManager) return undefined;
    const userConfig = await this.userConfigManager.getConfig(userId);
    return userConfig?.limits?.taskTimeoutMs;
  }

  protected async updatePinnedRepositoryInfo(chatId: number, userId: number): Promise<void> {
    try {
      const currentRepo = this.repositoryManager.getCurrentRepository(userId);
      const webUrl = currentRepo?.gitUrl ? UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl) : null;
      const typeEmoji = currentRepo ? UIHelpers.getRepoTypeEmoji(currentRepo.type) : '';

      const escapedName = currentRepo ? UIHelpers.escapeMarkdown(currentRepo.name) : '';
      const escapedBranch = currentRepo ? UIHelpers.escapeMarkdown(currentRepo.branch || 'main') : '';

      const message = currentRepo
        ? `${typeEmoji} *${escapedName}*\n${escapedBranch}${webUrl ? ` | [GitHub](${webUrl})` : ''}`
        : '*No repository selected*\n\nUse /repo to set up a repository.';

      const existingPinnedId = stateManager.getPinnedMessageId(chatId);

      if (existingPinnedId) {
        try {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: existingPinnedId,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });
        } catch {
          await this.createNewPinnedMessage(chatId, message);
        }
      } else {
        await this.createNewPinnedMessage(chatId, message);
      }
    } catch (error) {
      logger.error('Failed to update pinned repository info', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async createNewPinnedMessage(chatId: number, message: string): Promise<void> {
    try {
      const sentMessage = await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      await this.bot.pinChatMessage(chatId, sentMessage.message_id, {
        disable_notification: true
      });

      stateManager.setPinnedMessageId(chatId, sentMessage.message_id);
      logger.info('Created pinned message', { chatId, messageId: sentMessage.message_id });
    } catch (error) {
      logger.error('Failed to create pinned message', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  protected async fetchPinnedRepositoryName(chatId: number): Promise<string | null> {
    try {
      const chat = await this.bot.getChat(chatId);

      if (!chat.pinned_message?.text) return null;

      if (chat.pinned_message.message_id) {
        stateManager.setPinnedMessageId(chatId, chat.pinned_message.message_id);
      }

      const match = chat.pinned_message.text.match(/^\S+\s+\*(.+?)\*/);
      return match?.[1]?.trim() || null;
    } catch {
      return null;
    }
  }

  public async initializeFromPinnedMessage(userId: number): Promise<void> {
    try {
      const repoName = await this.fetchPinnedRepositoryName(userId);
      if (!repoName) return;

      const repositories = await this.repositoryManager.listRepositories(userId);
      const matchingRepo = repositories.find(r => r.name === repoName);

      if (matchingRepo) {
        await this.repositoryManager.switchRepository(userId, matchingRepo.id);
        logger.info('Switched to repository from pinned message', { userId, repoName });
      }
    } catch (error) {
      logger.error('Failed to initialize from pinned message', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
