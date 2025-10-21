import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { isAuthorized } from '../middleware/security';
import { logger } from '../utils/logger';

/**
 * Base handler class with common dependencies and utility methods
 */
export abstract class BaseHandler {
  constructor(
    protected bot: TelegramBot,
    protected executor: ClaudeExecutor,
    protected rateLimiter: RateLimiter,
    protected auditLogger: AuditLogger,
    protected repositoryManager: RepositoryManager,
    protected conversationManager?: ConversationManager
  ) { }

  /**
   * Check authorization and rate limits
   */
  protected async checkAccess(msg: Message): Promise<boolean> {
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
  protected getWorkingDirectory(userId: number, override?: string): string {
    if (override) {
      return override;
    }

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    return currentRepo?.path || process.cwd();
  }
}

