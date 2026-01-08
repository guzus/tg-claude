import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { RalphLoopExecutor, RalphLoopStatus, RalphLoopConfig } from '../../../services/RalphLoopExecutor';
import { logger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

/**
 * Ralph Wiggum Handler - Implements the Ralph Wiggum loop plugin
 * Based on https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 *
 * "Ralph is a Bash loop" - An autonomous loop that keeps working until task completion
 */
export class RalphWiggumHandler extends BaseHandler {
  private ralphExecutor: RalphLoopExecutor;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    userConfigManager?: UserConfigManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, undefined, userConfigManager);
    this.ralphExecutor = new RalphLoopExecutor(bot, executor, repositoryManager);
  }

  /**
   * Get the Ralph Loop Executor for external access (e.g., callbacks)
   */
  getRalphExecutor(): RalphLoopExecutor {
    return this.ralphExecutor;
  }

  /**
   * /ralph command - Start a Ralph Wiggum loop
   *
   * Usage:
   *   /ralph <task description>
   *   /ralph <task> --max 100 --promise DONE
   */
  async handleRalph(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const argsText = match?.[1]?.trim() || '';

    this.auditLogger.logCommand({ userId, command: 'ralph', success: true });

    // Parse arguments
    const { task, config } = this.parseArguments(argsText);

    // No task = show help
    if (!task) {
      await this.showHelp(chatId);
      return;
    }

    // Check for active session
    const existingSession = this.ralphExecutor.getUserSession(userId);
    if (existingSession && existingSession.status === RalphLoopStatus.RUNNING) {
      await this.bot.sendMessage(
        chatId,
        `🔄 Ralph loop already running!\n\nIteration: ${existingSession.iteration}/${existingSession.config.maxIterations}\n\nUse the stop button or wait for completion.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Get working directory
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '❌ No repository selected. Use `/repo` to select one first.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Get AI provider config if available
    let aiProvider;
    if (this.userConfigManager) {
      const userConfig = await this.userConfigManager.getConfig(userId);
      aiProvider = userConfig.aiProvider;
    }

    try {
      // Start the Ralph loop
      const session = await this.ralphExecutor.startSession(
        userId,
        chatId,
        task,
        currentRepo.path,
        config,
        aiProvider
      );

      logger.info('Ralph loop started', {
        sessionId: session.sessionId,
        userId,
        task: task.substring(0, 100),
        maxIterations: config.maxIterations,
        completionPromise: config.completionPromise
      });

    } catch (error) {
      const errorMessage = getErrorMessage(error);
      await this.bot.sendMessage(chatId, `❌ Failed to start Ralph loop: ${errorMessage}`);
      logger.error('Failed to start Ralph loop', { userId, error: errorMessage });
    }
  }

  /**
   * Handle callback query for stopping Ralph loop
   */
  async handleCallback(query: CallbackQuery): Promise<void> {
    const data = query.data;
    if (!data?.startsWith('ralph_stop:')) return;

    const userId = query.from.id;
    const chatId = query.message?.chat.id;

    const stopped = this.ralphExecutor.stopSessionByUser(userId);

    if (chatId) {
      if (stopped) {
        await this.bot.sendMessage(chatId, '🛑 Ralph loop stopped.');
      } else {
        await this.bot.sendMessage(chatId, '⚠️ No active Ralph loop to stop.');
      }
    }

    await this.bot.answerCallbackQuery(query.id);
  }

  /**
   * Parse command arguments
   */
  private parseArguments(argsText: string): { task: string; config: Partial<RalphLoopConfig> } {
    const config: Partial<RalphLoopConfig> = {};

    // Extract --max or --max-iterations
    const maxMatch = argsText.match(/--max(?:-iterations?)?\s+(\d+)/i);
    if (maxMatch) {
      config.maxIterations = Math.min(parseInt(maxMatch[1], 10), 100);
      argsText = argsText.replace(maxMatch[0], '').trim();
    }

    // Extract --promise or --completion-promise
    const promiseMatch = argsText.match(/--(?:completion-)?promise\s+"([^"]+)"|--(?:completion-)?promise\s+(\S+)/i);
    if (promiseMatch) {
      config.completionPromise = promiseMatch[1] || promiseMatch[2];
      argsText = argsText.replace(promiseMatch[0], '').trim();
    }

    // Extract --timeout (in minutes)
    const timeoutMatch = argsText.match(/--timeout\s+(\d+)/i);
    if (timeoutMatch) {
      config.maxDurationMs = Math.min(parseInt(timeoutMatch[1], 10), 120) * 60 * 1000;
      argsText = argsText.replace(timeoutMatch[0], '').trim();
    }

    return { task: argsText.trim(), config };
  }

  /**
   * Show help message
   */
  private async showHelp(chatId: number): Promise<void> {
    const message = `🔄 **Ralph Wiggum Loop**

_Iterative AI development with self-referential feedback loops_

**Usage:**
\`/ralph <task description>\`

**Options:**
\`--max-iterations <n>\` - Stop after N iterations (default: 50, max: 100)
\`--timeout <min>\` - Max duration in minutes (default: 60, max: 120)

**Examples:**
\`/ralph Fix all failing tests\`
\`/ralph Implement user auth --max-iterations 30\`
\`/ralph Build the REST API for todos\`

**How It Works:**
1. Claude works on your task autonomously
2. Stop hook intercepts exit attempts and re-feeds the prompt
3. Previous work persists in files and git history
4. Each iteration sees modified files from previous work
5. Loop ends when task is complete or max iterations reached

**Tips:**
• Define clear completion criteria in your task
• Break complex tasks into phases
• Use test-driven development for automatic verification`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }
}
