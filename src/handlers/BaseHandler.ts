import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { UserMCPConfig } from '../types';
import { isAuthorized } from '../middleware/security';
import { logger } from '../utils/logger';

/**
 * Base handler class with common dependencies and utility methods
 */
export abstract class BaseHandler {
  // Track pinned message IDs per chat
  private static pinnedMessages: Map<number, number> = new Map();

  constructor(
    protected bot: TelegramBot,
    protected executor: ClaudeExecutor,
    protected rateLimiter: RateLimiter,
    protected auditLogger: AuditLogger,
    protected repositoryManager: RepositoryManager,
    protected conversationManager?: ConversationManager,
    protected userConfigManager?: UserConfigManager
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

  /**
   * Get user-specific timeout or fallback to global config
   */
  protected async getUserTimeout(userId: number): Promise<number | undefined> {
    if (!this.userConfigManager) {
      return undefined; // Will use global config default
    }

    const userConfig = await this.userConfigManager.getConfig(userId);
    return userConfig?.limits?.taskTimeoutMs;
  }

  /**
   * Get user's MCP configuration for task execution
   */
  protected async getUserMCPConfig(userId: number): Promise<UserMCPConfig | undefined> {
    if (!this.userConfigManager) {
      return undefined;
    }

    const userConfig = await this.userConfigManager.getConfig(userId);
    return userConfig?.mcp;
  }

  /**
   * Update pinned message with current repository info
   */
  protected async updatePinnedRepositoryInfo(chatId: number, userId: number): Promise<void> {
    try {
      const currentRepo = this.repositoryManager.getCurrentRepository(userId);

      // Build repository info message
      const { UIHelpers } = require('../utils/UIHelpers');
      const webUrl = currentRepo?.gitUrl ? UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl) : null;
      const typeEmoji = currentRepo ? UIHelpers.getRepoTypeEmoji(currentRepo.type) : '📂';

      // Escape special characters for Markdown
      const escapedName = currentRepo ? UIHelpers.escapeMarkdown(currentRepo.name) : '';
      const escapedBranch = currentRepo ? UIHelpers.escapeMarkdown(currentRepo.branch || 'main') : '';

      const message = currentRepo
        ? `${typeEmoji} *${escapedName}*\n` +
          `🌿 ${escapedBranch}${webUrl ? ` | [GitHub](${webUrl})` : ''}`
        : '📂 *No repository selected*\n\nUse /repo to set up a repository.';

      // Check if we have an existing pinned message
      const existingPinnedId = BaseHandler.pinnedMessages.get(chatId);

      if (existingPinnedId) {
        // Try to update existing pinned message
        try {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: existingPinnedId,
            parse_mode: 'Markdown',
            disable_web_page_preview: true
          });
          logger.debug('Updated existing pinned message', { chatId, messageId: existingPinnedId });
        } catch (error) {
          // If update fails, create a new one
          logger.debug('Failed to update pinned message, creating new one', { chatId });
          await this.createNewPinnedMessage(chatId, message);
        }
      } else {
        // Create new pinned message
        await this.createNewPinnedMessage(chatId, message);
      }
    } catch (error) {
      logger.error('Failed to update pinned repository info', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Create and pin a new repository info message
   */
  private async createNewPinnedMessage(chatId: number, message: string): Promise<void> {
    try {
      const sentMessage = await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      });

      // Pin the message (disable notification to avoid spam)
      await this.bot.pinChatMessage(chatId, sentMessage.message_id, {
        disable_notification: true
      });

      // Store the message ID
      BaseHandler.pinnedMessages.set(chatId, sentMessage.message_id);

      logger.info('Created and pinned repository info message', {
        chatId,
        messageId: sentMessage.message_id
      });
    } catch (error) {
      logger.error('Failed to create/pin message', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Fetch pinned message from a chat and extract repository name
   */
  protected async fetchPinnedRepositoryName(chatId: number): Promise<string | null> {
    try {
      const chat = await this.bot.getChat(chatId);

      if (!chat.pinned_message) {
        logger.debug('No pinned message found', { chatId });
        return null;
      }

      const pinnedMessage = chat.pinned_message;

      // Store the pinned message ID
      if (pinnedMessage.message_id) {
        BaseHandler.pinnedMessages.set(chatId, pinnedMessage.message_id);
      }

      // Parse repository name from message text
      // Format: "<emoji> *<repository-name>*\n🌿 <branch>..."
      if (!pinnedMessage.text) {
        logger.debug('Pinned message has no text', { chatId });
        return null;
      }

      const text = pinnedMessage.text;

      // Extract repository name between asterisks on the first line
      const match = text.match(/^\S+\s+\*(.+?)\*/);
      if (match && match[1]) {
        const repoName = match[1].trim();
        logger.info('Extracted repository name from pinned message', {
          chatId,
          repoName
        });
        return repoName;
      }

      logger.debug('Could not parse repository name from pinned message', {
        chatId,
        text
      });
      return null;
    } catch (error) {
      logger.debug('Failed to fetch pinned message', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Initialize current repository from pinned message
   */
  public async initializeFromPinnedMessage(userId: number): Promise<void> {
    try {
      // In Telegram, private chat ID is the same as user ID
      const chatId = userId;

      const repoName = await this.fetchPinnedRepositoryName(chatId);
      if (!repoName) {
        logger.debug('No repository name found in pinned message', { userId });
        return;
      }

      // Find repository by name
      const repositories = await this.repositoryManager.listRepositories(userId);
      const matchingRepo = repositories.find(r => r.name === repoName);

      if (matchingRepo) {
        await this.repositoryManager.switchRepository(userId, matchingRepo.id);
        logger.info('Switched to repository from pinned message', {
          userId,
          repoName,
          repoId: matchingRepo.id
        });
      } else {
        logger.debug('Repository from pinned message not found in user repositories', {
          userId,
          repoName,
          availableRepos: repositories.map(r => r.name)
        });
      }
    } catch (error) {
      logger.error('Failed to initialize from pinned message', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

