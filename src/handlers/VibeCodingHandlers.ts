import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { VibeCodingExecutor, VibeCodingSession, VibeCodingStatus } from '../services/VibeCodingExecutor';
import { voiceCallService } from '../services/VoiceCallService';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';

export class VibeCodingHandlers extends BaseHandler {
  private vibeCodingExecutor: VibeCodingExecutor;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    conversationManager?: ConversationManager,
    userConfigManager?: UserConfigManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);

    this.vibeCodingExecutor = new VibeCodingExecutor(executor);

    // Set up callbacks for status updates
    this.vibeCodingExecutor.setStatusUpdateCallback(async (session, message) => {
      await this.sendStatusUpdate(session, message);
    });

    this.vibeCodingExecutor.setCompleteCallback(async (session) => {
      await this.onSessionComplete(session);
    });
  }

  /**
   * Handle /vibe command
   * Usage:
   *   /vibe <task description> - Start vibe coding
   *   /vibe phone +1234567890 - Set phone number
   *   /vibe stop - Stop current session
   *   /vibe status - Get session status
   */
  async handleVibe(msg: Message): Promise<void> {
    if (!await this.checkAccess(msg)) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const args = text.replace(/^\/vibe\s*/i, '').trim();

    this.auditLogger.logCommand({
      userId,
      username: msg.from?.username,
      command: '/vibe',
      success: true
    });

    // Parse subcommand
    if (!args) {
      await this.showVibeHelp(chatId);
      return;
    }

    const [subcommand, ...rest] = args.split(/\s+/);

    switch (subcommand.toLowerCase()) {
      case 'stop':
        await this.stopVibeSession(userId, chatId);
        break;

      case 'status':
        await this.showVibeStatus(userId, chatId);
        break;

      case 'phone':
        await this.setPhoneNumber(userId, chatId, rest.join(' '));
        break;

      default:
        // Treat as task description
        await this.startVibeSession(userId, chatId, args);
        break;
    }
  }

  /**
   * Start a vibe coding session
   */
  private async startVibeSession(userId: number, chatId: number, task: string): Promise<void> {
    const workingDir = this.getWorkingDirectory(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.sendMessage(chatId,
        '📂 No repository selected.\n\n' +
        'Use `/repo clone <url>` or `/repo new <name>` to set up a repository first.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Get user's phone number from config
    let phoneNumber = '';
    if (this.userConfigManager) {
      const config = await this.userConfigManager.getConfig(userId);
      phoneNumber = (config as any)?.vibePhone || '';
    }

    // Check if voice calls are configured
    const voiceConfigured = voiceCallService.isConfigured();

    // Start session status message
    const statusMsg = await this.bot.sendMessage(chatId,
      `🎸 *Vibe Coding Started*\n\n` +
      `📂 Repository: \`${UIHelpers.escapeMarkdown(currentRepo.name)}\`\n` +
      `📋 Task: ${UIHelpers.escapeMarkdown(task.substring(0, 200))}${task.length > 200 ? '...' : ''}\n\n` +
      `📞 Voice callbacks: ${phoneNumber && voiceConfigured ? `Enabled (${phoneNumber.substring(0, 6)}****)` : 'Disabled'}\n` +
      ((!phoneNumber || !voiceConfigured) ? '\n_Set phone with `/vibe phone +1234567890`_\n' : '') +
      `\n⏳ Working...`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🛑 Stop', callback_data: 'vibe_stop' }
          ]]
        }
      }
    );

    try {
      const session = await this.vibeCodingExecutor.startSession(
        userId,
        chatId,
        task,
        workingDir,
        {
          phoneNumber,
          callOnProblem: !!phoneNumber && voiceConfigured,
          autoRetry: true,
          maxRetries: 5
        }
      );

      session.messageId = statusMsg.message_id;

      logger.info('Vibe coding session started', {
        sessionId: session.sessionId,
        userId,
        task: task.substring(0, 100)
      });

    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to start vibe coding session:\n\n${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );
    }
  }

  /**
   * Stop vibe coding session
   */
  private async stopVibeSession(userId: number, chatId: number): Promise<void> {
    const session = this.vibeCodingExecutor.getSessionForUser(userId);

    if (!session) {
      await this.bot.sendMessage(chatId, '🎸 No active vibe coding session.');
      return;
    }

    await this.vibeCodingExecutor.stopSession(session.sessionId);

    await this.bot.sendMessage(chatId,
      `🛑 *Vibe Coding Stopped*\n\n` +
      `Completed ${session.iterations.length} iteration(s).`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Show vibe coding status
   */
  private async showVibeStatus(userId: number, chatId: number): Promise<void> {
    const session = this.vibeCodingExecutor.getSessionForUser(userId);

    if (!session) {
      await this.bot.sendMessage(chatId, '🎸 No active vibe coding session.');
      return;
    }

    const statusEmoji = {
      [VibeCodingStatus.RUNNING]: '🏃',
      [VibeCodingStatus.AWAITING_RESPONSE]: '📞',
      [VibeCodingStatus.COMPLETED]: '✅',
      [VibeCodingStatus.FAILED]: '❌',
      [VibeCodingStatus.STOPPED]: '🛑'
    };

    const duration = Math.round((Date.now() - session.startTime.getTime()) / 1000);

    let message = `🎸 *Vibe Coding Status*\n\n`;
    message += `${statusEmoji[session.status]} Status: ${session.status}\n`;
    message += `📋 Task: ${UIHelpers.escapeMarkdown(session.task.substring(0, 100))}...\n`;
    message += `🔄 Iterations: ${session.iterations.length}\n`;
    message += `⏱ Duration: ${duration}s\n`;

    if (session.awaitingUserResponse && session.currentProblem) {
      message += `\n⚠️ *Awaiting your response:*\n`;
      message += `\`\`\`\n${session.currentProblem.substring(0, 500)}\n\`\`\``;
    }

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: session.status === VibeCodingStatus.RUNNING || session.status === VibeCodingStatus.AWAITING_RESPONSE
        ? {
            inline_keyboard: [[
              { text: '🛑 Stop', callback_data: 'vibe_stop' }
            ]]
          }
        : undefined
    });
  }

  /**
   * Set phone number for voice callbacks
   */
  private async setPhoneNumber(userId: number, chatId: number, phone: string): Promise<void> {
    if (!phone) {
      await this.bot.sendMessage(chatId,
        '📞 *Set Phone Number*\n\n' +
        'Usage: `/vibe phone +1234567890`\n\n' +
        'This number will be called when the agent needs your input.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Basic phone validation
    const cleanPhone = phone.replace(/[\s\-\(\)]/g, '');
    if (!cleanPhone.match(/^\+?[0-9]{10,15}$/)) {
      await this.bot.sendMessage(chatId,
        '❌ Invalid phone number format.\n\nUse international format: `+1234567890`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Save to user config
    if (this.userConfigManager) {
      const config = await this.userConfigManager.getConfig(userId);
      await this.userConfigManager.updateConfig(userId, {
        ...config,
        vibePhone: cleanPhone
      } as any);
    }

    const voiceConfigured = voiceCallService.isConfigured();

    await this.bot.sendMessage(chatId,
      `✅ Phone number saved: \`${cleanPhone.substring(0, 6)}****\`\n\n` +
      (voiceConfigured
        ? 'Voice callbacks are *enabled*. You will receive calls when the agent needs input.'
        : '⚠️ Voice service not configured. Set `TWILIO_*` and `GEMINI_API_KEY` environment variables.'),
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Show vibe help
   */
  private async showVibeHelp(chatId: number): Promise<void> {
    const voiceConfigured = voiceCallService.isConfigured();

    await this.bot.sendMessage(chatId,
      `🎸 *Vibe Coding Mode*\n\n` +
      `Autonomous coding with voice call notifications when help is needed.\n\n` +
      `*Commands:*\n` +
      `/vibe <task>` + ' - Start vibe coding\n' +
      `/vibe phone <number>` + ' - Set callback phone\n' +
      `/vibe status` + ' - Check session status\n' +
      `/vibe stop` + ' - Stop current session\n\n' +
      `*Voice Service:* ${voiceConfigured ? '✅ Configured' : '❌ Not configured'}\n\n` +
      `*How it works:*\n` +
      `1. Start with a task description\n` +
      `2. Claude works autonomously\n` +
      `3. When a problem needs your input:\n` +
      `   - Calls you (if phone configured)\n` +
      `   - Or sends Telegram message\n` +
      `4. You respond, Claude continues\n` +
      `5. Repeat until task complete`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Send status update for session
   */
  private async sendStatusUpdate(session: VibeCodingSession, message: string): Promise<void> {
    try {
      await this.bot.sendMessage(session.chatId,
        `🎸 *Vibe Update*\n\n${message}`,
        {
          parse_mode: 'Markdown',
          reply_markup: session.status === VibeCodingStatus.AWAITING_RESPONSE
            ? {
                inline_keyboard: [[
                  { text: '🛑 Stop', callback_data: 'vibe_stop' }
                ]]
              }
            : undefined
        }
      );
    } catch (error) {
      logger.error('Failed to send vibe status update', {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle session completion
   */
  private async onSessionComplete(session: VibeCodingSession): Promise<void> {
    try {
      const duration = session.endTime
        ? Math.round((session.endTime.getTime() - session.startTime.getTime()) / 1000)
        : 0;

      const successIterations = session.iterations.filter(i => i.status === 'success').length;
      const problemIterations = session.iterations.filter(i => i.status === 'problem').length;

      await this.bot.sendMessage(session.chatId,
        `🎸 *Vibe Coding Complete!*\n\n` +
        `📋 Task: ${UIHelpers.escapeMarkdown(session.task.substring(0, 100))}...\n` +
        `⏱ Duration: ${duration}s\n` +
        `🔄 Iterations: ${session.iterations.length}\n` +
        `✅ Successful: ${successIterations}\n` +
        `⚠️ Problems resolved: ${problemIterations}\n\n` +
        `_Check the repository for changes._`,
        { parse_mode: 'Markdown' }
      );

      // Auto commit if configured
      if (this.userConfigManager) {
        const config = await this.userConfigManager.getConfig(session.userId);
        if (config?.preferences?.autoCommit) {
          const commitHash = await this.executor.autoCommitChanges(session.workingDir);
          if (commitHash) {
            await this.bot.sendMessage(session.chatId,
              `📝 Auto-committed changes: \`${commitHash.substring(0, 8)}\``,
              { parse_mode: 'Markdown' }
            );
          }
        }
      }

    } catch (error) {
      logger.error('Failed to handle session completion', {
        sessionId: session.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Handle text message (for responding to vibe coding prompts)
   */
  async handleTextMessage(msg: Message): Promise<boolean> {
    const userId = msg.from?.id;
    if (!userId) return false;

    const text = msg.text?.trim();
    if (!text) return false;

    // Check if user has an active session awaiting response
    return await this.vibeCodingExecutor.handleTextResponse(userId, text);
  }

  /**
   * Handle callback queries for vibe coding
   */
  async handleCallback(callbackQuery: TelegramBot.CallbackQuery): Promise<boolean> {
    const data = callbackQuery.data;
    if (!data?.startsWith('vibe_')) return false;

    const userId = callbackQuery.from.id;
    const chatId = callbackQuery.message?.chat.id;

    if (!chatId) return false;

    if (data === 'vibe_stop') {
      const session = this.vibeCodingExecutor.getSessionForUser(userId);
      if (session) {
        await this.vibeCodingExecutor.stopSession(session.sessionId);
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'Vibe coding stopped' });

        await this.bot.sendMessage(chatId,
          `🛑 *Vibe Coding Stopped*\n\nCompleted ${session.iterations.length} iteration(s).`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await this.bot.answerCallbackQuery(callbackQuery.id, { text: 'No active session' });
      }
      return true;
    }

    return false;
  }

  /**
   * Get the VibeCodingExecutor instance
   */
  getExecutor(): VibeCodingExecutor {
    return this.vibeCodingExecutor;
  }
}
