import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { ConversationManager } from '../../../services/ConversationManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { MothershipService } from '../../../services/MothershipService';
import { stateManager } from '../../../services/StateManager';
import { TaskHandlers } from './TaskHandlers';
import { RepositoryHandlers } from './RepositoryHandlers';
import { StatusHandlers } from './StatusHandlers';
import { UtilityHandlers } from './UtilityHandlers';
import { ConfigHandlers } from './ConfigHandlers';
import { CallbackQueryHandler } from './CallbackQueryHandler';
import { MothershipHandlers } from './MothershipHandlers';
import { RalphWiggumHandler } from './RalphWiggumHandler';

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
  private mothershipHandlers: MothershipHandlers;
  private ralphHandler: RalphWiggumHandler;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    conversationManager: ConversationManager,
    userConfigManager: UserConfigManager,
    mothershipService: MothershipService
  ) {
    // Initialize all handler modules
    this.taskHandlers = new TaskHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
    this.repositoryHandlers = new RepositoryHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.statusHandlers = new StatusHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.utilityHandlers = new UtilityHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.configHandlers = new ConfigHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, userConfigManager, conversationManager);
    this.callbackQueryHandler = new CallbackQueryHandler(bot, executor, rateLimiter, auditLogger, repositoryManager, undefined, userConfigManager);
    this.mothershipHandlers = new MothershipHandlers(bot, mothershipService, rateLimiter, auditLogger);
    this.ralphHandler = new RalphWiggumHandler(bot, executor, rateLimiter, auditLogger, repositoryManager, userConfigManager);

    // Connect ralph executor to callback handler
    this.callbackQueryHandler.setRalphExecutor(this.ralphHandler.getRalphExecutor());
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

  async handleVersion(msg: Message): Promise<void> {
    return this.utilityHandlers.handleVersion(msg);
  }

  async handleLimits(msg: Message): Promise<void> {
    return this.utilityHandlers.handleLimits(msg);
  }

  async handleCancel(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.utilityHandlers.handleCancel(msg, match);
  }

  // ==================== Task Commands ====================

  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.taskHandlers.handleTask(msg, match);
  }

  // ==================== Repository Commands ====================

  async handleRepo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.repositoryHandlers.handleRepo(msg, match);
  }

  async handleRemote(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.repositoryHandlers.handleRemote(msg, match);
  }

  async handleScan(msg: Message): Promise<void> {
    return this.repositoryHandlers.handleScan(msg);
  }

  async handleNewRepo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.repositoryHandlers.handleNewRepoCommand(msg, match);
  }

  // ==================== Status Commands ====================

  async handleStatus(msg: Message): Promise<void> {
    return this.statusHandlers.handleStatus(msg);
  }

  async handleSystem(msg: Message): Promise<void> {
    return this.statusHandlers.handleSystem(msg);
  }

  async handleConfig(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.configHandlers.handleConfig(msg, match);
  }

  async handleAi(msg: Message): Promise<void> {
    return this.configHandlers.handleAi(msg);
  }

  async handleMcp(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.configHandlers.handleMcp(msg, match);
  }

  async handlePlugin(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.configHandlers.handlePlugin(msg, match);
  }

  // ==================== Ralph Wiggum Plugin ====================

  async handleRalph(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.ralphHandler.handleRalph(msg, match);
  }

  // ==================== Mothership Bot Commands ====================

  async handleBotCommand(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.mothershipHandlers.handleBot(msg, match);
  }

  // ==================== Callback Queries ====================

  async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    // Route bot-related callbacks to MothershipHandlers
    if (query.data?.startsWith('bot_')) {
      return this.mothershipHandlers.handleBotCallback(query);
    }

    // Route other callbacks to CallbackQueryHandler
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

    // Check if user has a pending /new_repo command waiting for name
    if (userId && text && stateManager.hasPendingNewRepoName(userId)) {
      return this.repositoryHandlers.handleNewRepoNameInput(userId, chatId, text);
    }

    // Check if user is entering an API key (GLM/OpenRouter)
    if (userId && text && stateManager.hasPendingApiKeyEntry(userId)) {
      return this.configHandlers.handleApiKeyEntry(msg);
    }

    // Check if user is entering a model ID (OpenRouter)
    if (userId && text && stateManager.hasPendingModelEntry(userId)) {
      return this.configHandlers.handleModelEntry(msg);
    }

    // Otherwise treat as task command
    return this.taskHandlers.handlePlainMessage(msg);
  }

  // ==================== Photo Messages ====================

  async handlePhotoMessage(msg: Message): Promise<void> {
    return this.taskHandlers.handlePhotoMessage(msg);
  }
}
