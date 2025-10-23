import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { TaskHandlers } from './TaskHandlers';
import { RepositoryHandlers } from './RepositoryHandlers';
import { StatusHandlers } from './StatusHandlers';
import { UtilityHandlers } from './UtilityHandlers';
import { ConfigHandlers } from './ConfigHandlers';
import { CallbackQueryHandler } from './CallbackQueryHandler';

/**
 * Main bot handlers class that delegates to specialized handler modules
 */
export class BotHandlers {
  private taskHandlers: TaskHandlers;
  private repositoryHandlers: RepositoryHandlers;
  private statusHandlers: StatusHandlers;
  private utilityHandlers: UtilityHandlers;
  private configHandlers: ConfigHandlers;
  private callbackQueryHandler: CallbackQueryHandler;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    conversationManager: ConversationManager,
    userConfigManager: UserConfigManager
  ) {
    // Initialize all handler modules
    this.taskHandlers = new TaskHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
    this.repositoryHandlers = new RepositoryHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.statusHandlers = new StatusHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.utilityHandlers = new UtilityHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.configHandlers = new ConfigHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, userConfigManager, conversationManager);
    this.callbackQueryHandler = new CallbackQueryHandler(bot, executor, rateLimiter, auditLogger, repositoryManager);
  }

  // ==================== Utility Commands ====================

  async handleStart(msg: Message): Promise<void> {
    return this.utilityHandlers.handleStart(msg);
  }

  async handleHelp(msg: Message): Promise<void> {
    return this.utilityHandlers.handleHelp(msg);
  }

  async handleCheck(msg: Message): Promise<void> {
    return this.utilityHandlers.handleCheck(msg);
  }

  async handleDebug(msg: Message): Promise<void> {
    return this.utilityHandlers.handleDebug(msg, this.taskHandlers);
  }

  async handleScan(msg: Message): Promise<void> {
    return this.utilityHandlers.handleScan(msg);
  }

  // ==================== Task Commands ====================

  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.taskHandlers.handleTask(msg, match);
  }

  async handleBeast(msg: Message, match: RegExpExecArray | null): Promise<void> {
    const prompt = match?.[1] || '';
    return this.taskHandlers.executeBeastMode(msg, prompt);
  }

  async handleCommit(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.taskHandlers.handleCommit(msg, match);
  }

  async handleRead(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.taskHandlers.handleRead(msg, match);
  }

  async handleReview(msg: Message): Promise<void> {
    return this.taskHandlers.handleReview(msg);
  }

  async handleTest(msg: Message): Promise<void> {
    return this.taskHandlers.handleTest(msg);
  }

  async handleBuild(msg: Message): Promise<void> {
    return this.taskHandlers.handleBuild(msg);
  }

  // ==================== Repository Commands ====================

  async handleRepo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.repositoryHandlers.handleRepo(msg, match);
  }

  async handleRemote(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.repositoryHandlers.handleRemote(msg, match);
  }

  // ==================== Status Commands ====================

  async handleStatus(msg: Message): Promise<void> {
    return this.statusHandlers.handleStatus(msg);
  }

  async handleCancel(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.statusHandlers.handleCancel(msg, match);
  }

  async handleLimits(msg: Message): Promise<void> {
    return this.statusHandlers.handleLimits(msg);
  }

  async handleConfig(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.configHandlers.handleConfig(msg, match);
  }

  async handleLogs(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.statusHandlers.handleLogs(msg, match);
  }

  // ==================== Callback Queries ====================

  async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    return this.callbackQueryHandler.handleCallbackQuery(query);
  }

  // ==================== Plain Messages ====================

  async handlePlainMessage(msg: Message): Promise<void> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;
    const text = msg.text?.trim();

    // Check if user has a pending repository creation waiting for a name
    if (userId && text && CallbackQueryHandler.hasPendingRepoCreation(userId)) {
      return this.callbackQueryHandler.handleRepoNameResponse(userId, chatId, text);
    }

    // Otherwise treat as task command
    return this.taskHandlers.handlePlainMessage(msg);
  }
}

export default BotHandlers;
