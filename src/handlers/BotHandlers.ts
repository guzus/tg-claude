import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { TaskHandlers } from './TaskHandlers';
import { RepositoryHandlers } from './RepositoryHandlers';
import { StatusHandlers } from './StatusHandlers';
import { UtilityHandlers } from './UtilityHandlers';

/**
 * Main bot handlers class that delegates to specialized handler modules
 */
export class BotHandlers {
  private taskHandlers: TaskHandlers;
  private repositoryHandlers: RepositoryHandlers;
  private statusHandlers: StatusHandlers;
  private utilityHandlers: UtilityHandlers;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager
  ) {
    // Initialize all handler modules
    this.taskHandlers = new TaskHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.repositoryHandlers = new RepositoryHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.statusHandlers = new StatusHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
    this.utilityHandlers = new UtilityHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager);
  }

  // ==================== Utility Commands ====================

  async handleStart(msg: Message): Promise<void> {
    return this.utilityHandlers.handleStart(msg);
  }

  async handleHelp(msg: Message): Promise<void> {
    return this.utilityHandlers.handleHelp(msg);
  }

  async handleLink(msg: Message): Promise<void> {
    return this.utilityHandlers.handleLink(msg);
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

  async handleLogs(msg: Message, match: RegExpExecArray | null): Promise<void> {
    return this.statusHandlers.handleLogs(msg, match);
  }
}

export default BotHandlers;
