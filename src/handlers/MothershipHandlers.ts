import TelegramBot, { Message, CallbackQuery } from 'node-telegram-bot-api';
import { MothershipService, BotDeploymentConfig } from '../services/MothershipService';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Handlers for mothership bot deployment commands
 */
export class MothershipHandlers {
  constructor(
    private bot: TelegramBot,
    private mothership: MothershipService,
    private rateLimiter: RateLimiter,
    private auditLogger: AuditLogger
  ) {}

  /**
   * Check access permissions
   */
  private async checkAccess(msg: Message): Promise<boolean> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;

    if (!userId) {
      await this.bot.sendMessage(chatId, '❌ Unable to identify user');
      return false;
    }

    if (!config.allowedUserIds.includes(userId)) {
      await this.bot.sendMessage(chatId, '🚫 Unauthorized access');
      logger.warn('Unauthorized access attempt', { userId, chatId });
      return false;
    }

    const rateLimit = this.rateLimiter.checkRateLimit(userId);
    if (!rateLimit.allowed) {
      await this.bot.sendMessage(
        chatId,
        `⏱️ ${rateLimit.reason}\n\nUse /limits to check your remaining quota.`
      );
      logger.warn('Rate limit exceeded', { userId });
      return false;
    }

    return true;
  }

  /**
   * Main /bot command handler - shows help or routes subcommands
   */
  async handleBot(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const args = match?.[1]?.trim();

    if (!args) {
      return this.showBotHelp(chatId);
    }

    const [subcommand, ...params] = args.split(/\s+/);

    switch (subcommand.toLowerCase()) {
      case 'run':
        return this.handleBotRun(msg, params);
      case 'list':
        return this.handleBotList(msg);
      case 'status':
        return this.handleBotStatus(msg, params);
      case 'logs':
        return this.handleBotLogs(msg, params);
      case 'stop':
        return this.handleBotStop(msg, params);
      case 'check':
        return this.handleBotCheck(msg);
      default:
        await this.bot.sendMessage(
          chatId,
          `❌ Unknown subcommand: ${subcommand}\n\nUse /bot to see available commands.`
        );
    }
  }

  /**
   * Show bot management help
   */
  private async showBotHelp(chatId: number): Promise<void> {
    const helpText = `🤖 *Bot Management via Mothership*

*Commands:*

\`/bot check\` - Check Mothership & Nomad status
\`/bot run <bot-dir> [token]\` - Build & deploy bot to Nomad
\`/bot list\` - List deployed bots
\`/bot status <name>\` - Check bot status
\`/bot logs <name> [lines]\` - View bot logs
\`/bot stop <name>\` - Stop bot

*Examples:*
\`/bot run ping-bot 123456:ABC...\`
\`/bot status ping-bot\`
\`/bot logs ping-bot 50\`
\`/bot stop ping-bot\`

*Workflow:*
1. Check setup: \`/bot check\`
2. Create bot using mothership CLI or use example
3. Edit bot code with \`/task\`
4. Run (build + deploy): \`/bot run ping-bot <token>\`
5. Monitor: \`/bot status ping-bot\`
`;

    await this.bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  }

  /**
   * Check Mothership and Nomad status
   */
  private async handleBotCheck(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    await this.bot.sendMessage(chatId, '🔍 Checking Mothership setup...');

    try {
      const mothershipOk = await this.mothership.checkMothershipCli();
      const nomadOk = await this.mothership.checkNomad();

      let status = '📊 *System Status*\n\n';
      status += `Mothership CLI: ${mothershipOk ? '✅' : '❌'}\n`;
      status += `Nomad: ${nomadOk ? '✅' : '❌'}\n`;
      status += `Bots Directory: \`${this.mothership.getBotsDirectory()}\`\n`;

      if (mothershipOk && nomadOk) {
        status += '\n✅ All systems operational!';
      } else {
        status += '\n⚠️ Some systems are not available.';
        if (!mothershipOk) {
          status += '\n\nInstall Mothership CLI:\n\`npm install -g @guzus/mothership-cli\`';
        }
      }

      await this.bot.sendMessage(chatId, status, { parse_mode: 'Markdown' });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Error checking status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Build and deploy a bot in one command
   */
  private async handleBotRun(msg: Message, params: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (params.length < 1) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: `/bot run <bot-dir> [token]`\n\n' +
        'Example: `/bot run ping-bot 123456:ABC...`\n\n' +
        'Bot directory should be in: `bots/<bot-dir>/`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const name = params[0];
    const token = params[1]; // Optional - can use Vault
    const imageName = `${name}:latest`;

    const statusMsg = await this.bot.sendMessage(
      chatId,
      `🚀 Building and deploying ${name}...\n\n` +
      `Step 1/2: Building Docker image...`
    );

    try {
      // Step 1: Build Docker image
      await this.mothership.buildBotImage(name, 'latest');

      await this.bot.editMessageText(
        `🚀 Building and deploying ${name}...\n\n` +
        `✅ Step 1/2: Docker image built\n` +
        `⏳ Step 2/2: Deploying to Nomad...`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );

      // Step 2: Deploy to Nomad
      const deployConfig: BotDeploymentConfig = {
        name,
        dockerImage: imageName,
        token,
        cpu: 100,
        memory: 256,
        useVault: !token
      };

      await this.mothership.deployBot(deployConfig);

      await this.bot.editMessageText(
        `✅ *Bot deployed successfully!*\n\n` +
        `🤖 Name: ${name}\n` +
        `🐳 Image: ${imageName}\n` +
        `🔐 Auth: ${token ? 'Token provided' : 'Vault'}\n\n` +
        `*Next steps:*\n` +
        `Check status: \`/bot status ${name}\`\n` +
        `View logs: \`/bot logs ${name}\``,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot run ${name}`,
        success: true
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to run bot: ${error instanceof Error ? error.message : String(error)}\n\n` +
        `Make sure:\n` +
        `1. Bot directory exists: \`bots/${name}/\`\n` +
        `2. Bot has a Dockerfile\n` +
        `3. Token is valid (or stored in Vault)\n` +
        `4. Nomad is running: \`/bot check\``,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot run ${name}`,
        success: false
      });
    }
  }

  /**
   * List all deployed bots with interactive dashboard
   */
  private async handleBotList(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    const statusMsg = await this.bot.sendMessage(chatId, '📋 Fetching deployed bots...');

    try {
      const bots = await this.mothership.listBots();

      if (bots.length === 0) {
        await this.bot.editMessageText(
          '📋 *No bots deployed yet*\n\n' +
          'Deploy your first bot:\n' +
          '`/bot run <bot-name> <token>`',
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
        return;
      }

      // Build message with bot status
      let message = `🤖 *Running Bots (${bots.length})*\n\n`;

      for (const bot of bots) {
        const statusEmoji = bot.status === 'running' ? '✅' :
                           bot.status === 'pending' ? '⏳' :
                           bot.status === 'stopped' ? '⏸️' : '❌';
        message += `${statusEmoji} *${bot.name}*\n`;
        message += `   Status: ${bot.status}`;
        if (bot.running !== undefined && bot.desired !== undefined) {
          message += ` (${bot.running}/${bot.desired})`;
        }
        message += `\n\n`;
      }

      // Create inline keyboard with bot actions
      const keyboard: any[] = [];

      for (const bot of bots) {
        const row = [
          {
            text: `📊 ${bot.name}`,
            callback_data: `bot_status_${bot.name}`
          },
          {
            text: '📄 Logs',
            callback_data: `bot_logs_${bot.name}`
          },
          {
            text: '🔄 Restart',
            callback_data: `bot_restart_${bot.name}`
          },
          {
            text: '🛑 Stop',
            callback_data: `bot_stop_${bot.name}`
          }
        ];
        keyboard.push(row);
      }

      // Add refresh button
      keyboard.push([
        {
          text: '🔄 Refresh',
          callback_data: 'bot_refresh_list'
        }
      ]);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      this.auditLogger.logCommand({
        userId,
        command: '/bot list',
        success: true
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to list bots: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: '/bot list',
        success: false
      });
    }
  }

  /**
   * Get bot status
   */
  private async handleBotStatus(msg: Message, params: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (params.length < 1) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: `/bot status <name>`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const name = params[0];

    await this.bot.sendMessage(chatId, `🔍 Checking status for ${name}...`);

    try {
      const status = await this.mothership.getBotStatus(name);

      if (!status) {
        await this.bot.sendMessage(chatId, `❌ Bot not found: ${name}`);
        return;
      }

      const statusEmoji = status.status === 'running' ? '✅' : '❌';
      const message =
        `${statusEmoji} *Bot Status: ${name}*\n\n` +
        `Status: ${status.status}\n` +
        `${status.running !== undefined ? `Running: ${status.running}/${status.desired}\n` : ''}\n` +
        `View logs: \`/bot logs ${name}\``;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });

      this.auditLogger.logCommand({
        userId,
        command: `/bot status ${name}`,
        success: true
      });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to get status: ${error instanceof Error ? error.message : String(error)}`
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot status ${name}`,
        success: false
      });
    }
  }

  /**
   * Get bot logs
   */
  private async handleBotLogs(msg: Message, params: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (params.length < 1) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: `/bot logs <name> [lines]`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const name = params[0];
    const tail = params[1] ? parseInt(params[1]) : 50;

    await this.bot.sendMessage(chatId, `📄 Fetching logs for ${name}...`);

    try {
      const logs = await this.mothership.getBotLogs(name, tail);

      if (!logs || logs.trim().length === 0) {
        await this.bot.sendMessage(chatId, `📄 No logs available for ${name}`);
        return;
      }

      // Split logs into chunks if too long
      const maxLength = 4000;
      const logLines = logs.split('\n');
      let currentChunk = '';

      for (const line of logLines) {
        if ((currentChunk + line + '\n').length > maxLength) {
          await this.bot.sendMessage(chatId, `\`\`\`\n${currentChunk}\n\`\`\``, { parse_mode: 'Markdown' });
          currentChunk = line + '\n';
        } else {
          currentChunk += line + '\n';
        }
      }

      if (currentChunk.trim()) {
        await this.bot.sendMessage(chatId, `\`\`\`\n${currentChunk}\n\`\`\``, { parse_mode: 'Markdown' });
      }

      this.auditLogger.logCommand({
        userId,
        command: `/bot logs ${name}`,
        success: true
      });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to get logs: ${error instanceof Error ? error.message : String(error)}`
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot logs ${name}`,
        success: false
      });
    }
  }

  /**
   * Stop a bot
   */
  private async handleBotStop(msg: Message, params: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId) return;

    if (params.length < 1) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: `/bot stop <name>`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const name = params[0];

    const statusMsg = await this.bot.sendMessage(chatId, `🛑 Stopping bot: ${name}...`);

    try {
      await this.mothership.stopBot(name, true); // purge = true

      await this.bot.editMessageText(
        `✅ Bot stopped: ${name}\n\n` +
        `Redeploy with: \`/bot deploy ${name} <image> <token>\``,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot stop ${name}`,
        success: true
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to stop bot: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot stop ${name}`,
        success: false
      });
    }
  }

  /**
   * Handle callback queries from inline keyboards
   */
  async handleBotCallback(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const userId = query.from.id;
    const data = query.data;

    if (!chatId || !messageId || !data) return;

    // Check authorization
    if (!config.allowedUserIds.includes(userId)) {
      await this.bot.answerCallbackQuery(query.id, {
        text: '🚫 Unauthorized',
        show_alert: true
      });
      return;
    }

    try {
      if (data === 'bot_refresh_list') {
        // Refresh the bot list
        await this.bot.answerCallbackQuery(query.id, { text: '🔄 Refreshing...' });
        await this.refreshBotList(chatId, messageId, userId);
      } else if (data.startsWith('bot_status_')) {
        const botName = data.replace('bot_status_', '');
        await this.bot.answerCallbackQuery(query.id, { text: `📊 Getting status for ${botName}...` });
        await this.showBotStatus(chatId, messageId, botName, userId);
      } else if (data.startsWith('bot_logs_')) {
        const botName = data.replace('bot_logs_', '');
        await this.bot.answerCallbackQuery(query.id, { text: `📄 Fetching logs for ${botName}...` });
        await this.showBotLogs(chatId, botName, userId);
      } else if (data.startsWith('bot_restart_')) {
        const botName = data.replace('bot_restart_', '');
        await this.bot.answerCallbackQuery(query.id, { text: `🔄 Restarting ${botName}...` });
        await this.restartBot(chatId, messageId, botName, userId);
      } else if (data.startsWith('bot_stop_')) {
        const botName = data.replace('bot_stop_', '');
        await this.bot.answerCallbackQuery(query.id, { text: `🛑 Stopping ${botName}...`, show_alert: true });
        await this.stopBotFromCallback(chatId, messageId, botName, userId);
      } else if (data === 'bot_back_to_list') {
        await this.bot.answerCallbackQuery(query.id);
        await this.refreshBotList(chatId, messageId, userId);
      }
    } catch (error) {
      logger.error('Error handling bot callback', { error, data });
      await this.bot.answerCallbackQuery(query.id, {
        text: '❌ Error: ' + (error instanceof Error ? error.message : String(error)),
        show_alert: true
      });
    }
  }

  /**
   * Refresh bot list display
   */
  private async refreshBotList(chatId: number, messageId: number, _userId: number): Promise<void> {
    try {
      const bots = await this.mothership.listBots();

      if (bots.length === 0) {
        await this.bot.editMessageText(
          '📋 *No bots deployed yet*\n\n' +
          'Deploy your first bot:\n' +
          '`/bot run <bot-name> <token>`',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );
        return;
      }

      let message = `🤖 *Running Bots (${bots.length})*\n\n`;

      for (const bot of bots) {
        const statusEmoji = bot.status === 'running' ? '✅' :
                           bot.status === 'pending' ? '⏳' :
                           bot.status === 'stopped' ? '⏸️' : '❌';
        message += `${statusEmoji} *${bot.name}*\n`;
        message += `   Status: ${bot.status}`;
        if (bot.running !== undefined && bot.desired !== undefined) {
          message += ` (${bot.running}/${bot.desired})`;
        }
        message += `\n\n`;
      }

      const keyboard: any[] = [];
      for (const bot of bots) {
        const row = [
          { text: `📊 ${bot.name}`, callback_data: `bot_status_${bot.name}` },
          { text: '📄 Logs', callback_data: `bot_logs_${bot.name}` },
          { text: '🔄 Restart', callback_data: `bot_restart_${bot.name}` },
          { text: '🛑 Stop', callback_data: `bot_stop_${bot.name}` }
        ];
        keyboard.push(row);
      }

      keyboard.push([{ text: '🔄 Refresh', callback_data: 'bot_refresh_list' }]);

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to refresh: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
    }
  }

  /**
   * Show detailed bot status
   */
  private async showBotStatus(chatId: number, messageId: number, botName: string, _userId: number): Promise<void> {
    try {
      const status = await this.mothership.getBotStatus(botName);

      if (!status) {
        await this.bot.editMessageText(`❌ Bot not found: ${botName}`, {
          chat_id: chatId,
          message_id: messageId
        });
        return;
      }

      const statusEmoji = status.status === 'running' ? '✅' : '❌';
      let message = `${statusEmoji} *Bot Status: ${botName}*\n\n`;
      message += `Status: ${status.status}\n`;
      if (status.running !== undefined && status.desired !== undefined) {
        message += `Running: ${status.running}/${status.desired}\n`;
      }

      const keyboard = [
        [
          { text: '📄 View Logs', callback_data: `bot_logs_${botName}` },
          { text: '🔄 Restart', callback_data: `bot_restart_${botName}` }
        ],
        [
          { text: '🛑 Stop', callback_data: `bot_stop_${botName}` },
          { text: '⬅️ Back', callback_data: 'bot_back_to_list' }
        ]
      ];

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to get status: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
    }
  }

  /**
   * Show bot logs
   */
  private async showBotLogs(chatId: number, botName: string, _userId: number): Promise<void> {
    try {
      const logs = await this.mothership.getBotLogs(botName, 50);

      if (!logs || logs.trim().length === 0) {
        await this.bot.sendMessage(chatId, `📄 No logs available for ${botName}`);
        return;
      }

      const maxLength = 4000;
      if (logs.length > maxLength) {
        await this.bot.sendMessage(chatId, `\`\`\`\n${logs.substring(0, maxLength)}\n...\n\`\`\``, { parse_mode: 'Markdown' });
      } else {
        await this.bot.sendMessage(chatId, `\`\`\`\n${logs}\n\`\`\``, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to get logs: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Restart a bot
   */
  private async restartBot(chatId: number, messageId: number, botName: string, _userId: number): Promise<void> {
    try {
      await this.bot.editMessageText(
        `🔄 Restarting ${botName}...\n\nThis may take a moment.`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );

      // Stop the bot first
      await this.mothership.stopBot(botName, true);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get bot info and redeploy
      const botInfo = await this.mothership.getBotInfo(botName);
      if (botInfo) {
        const deployConfig: BotDeploymentConfig = {
          name: botName,
          dockerImage: `${botName}:latest`,
          cpu: 100,
          memory: 256,
          useVault: true
        };

        await this.mothership.deployBot(deployConfig);

        await this.bot.editMessageText(
          `✅ *${botName} restarted!*\n\n` +
          `Use \`/bot\` to check status.`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '⬅️ Back to List', callback_data: 'bot_back_to_list' }
              ]]
            }
          }
        );
      } else {
        await this.bot.editMessageText(
          `❌ Could not restart ${botName}: Bot info not found`,
          {
            chat_id: chatId,
            message_id: messageId
          }
        );
      }
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to restart: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
    }
  }

  /**
   * Stop bot from callback
   */
  private async stopBotFromCallback(chatId: number, messageId: number, botName: string, userId: number): Promise<void> {
    try {
      await this.bot.editMessageText(
        `🛑 Stopping ${botName}...`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );

      await this.mothership.stopBot(botName, true);

      await this.bot.editMessageText(
        `✅ *${botName} stopped*\n\n` +
        `Redeploy with: \`/bot run ${botName} <token>\``,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '⬅️ Back to List', callback_data: 'bot_back_to_list' }
            ]]
          }
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot stop ${botName}`,
        success: true
      });
    } catch (error) {
      await this.bot.editMessageText(
        `❌ Failed to stop: ${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );

      this.auditLogger.logCommand({
        userId,
        command: `/bot stop ${botName}`,
        success: false
      });
    }
  }
}
