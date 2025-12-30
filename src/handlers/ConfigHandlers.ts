import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UserConfigManager } from '../services/UserConfigManager';
import { logger } from '../utils/logger';

/**
 * Handlers for user configuration commands
 */
export class ConfigHandlers extends BaseHandler {
  constructor(
    bot: any,
    executor: any,
    rateLimiter: any,
    auditLogger: any,
    repositoryManager: any,
    userConfigManager: UserConfigManager,
    conversationManager?: any
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
  }

  /**
   * /config command - Manage user configuration
   */
  async handleConfig(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    if (!subcommand) {
      await this.showConfigMenu(msg);
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'show':
        case 'view':
          await this.showConfig(msg);
          break;

        case 'set':
          await this.setConfigValue(msg, args.slice(1));
          break;

        case 'reset':
          await this.resetConfig(msg);
          break;

        default:
          await this.bot.sendMessage(
            chatId,
            `❌ Unknown subcommand: ${subcommand}\nUse /config to see available commands.`
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      logger.error('Config command failed', {
        userId,
        subcommand,
        error: errorMessage
      });
    }
  }

  /**
   * Show config menu with inline buttons
   */
  private async showConfigMenu(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    const message =
      `⚙️ *User Configuration*\n\n` +
      `Commands:\n` +
      `/config show - View current configuration\n` +
      `/config set <key> <value> - Set a config value\n` +
      `/config reset - Reset to defaults\n\n` +
      `Configuration keys:\n` +
      `• \`git.userName\` - Git user name\n` +
      `• \`git.userEmail\` - Git user email\n` +
      `• \`git.defaultBranch\` - Default branch name\n` +
      `• \`preferences.autoCommit\` - Auto-commit (true/false)\n` +
      `• \`preferences.autoPush\` - Auto-push (true/false)\n` +
      `• \`preferences.notifyOnTaskComplete\` - Notifications (true/false)\n` +
      `• \`preferences.dangerModeEnabled\` - Danger mode (true/false)\n` +
      `• \`limits.maxConcurrentTasks\` - Max concurrent tasks (number)\n` +
      `• \`limits.taskTimeoutMs\` - Task timeout in ms (number)\n` +
      `• \`techStack.languages\` - Preferred languages (e.g., TypeScript, Python)\n` +
      `• \`techStack.frameworks\` - Preferred frameworks (e.g., React, FastAPI)\n` +
      `• \`techStack.tools\` - Preferred tools (e.g., Bun, Docker)\n\n` +
      `Example:\n` +
      `\`/config set git.userName "John Doe"\`\n` +
      `\`/config set techStack.languages "TypeScript, Python"\``;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📄 View Config', callback_data: 'config_show' },
            { text: '🔄 Reset Config', callback_data: 'config_reset_confirm' }
          ],
          [
            { text: '👤 Git Settings', callback_data: 'config_git' },
            { text: '⚙️ Preferences', callback_data: 'config_preferences' }
          ],
          [
            { text: '📊 Limits', callback_data: 'config_limits' },
            { text: '🛠️ Tech Stack', callback_data: 'config_techstack' }
          ],
          [
            { text: '🔙 Back to Main Menu', callback_data: 'main_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show current configuration
   */
  private async showConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);

    const message =
      `⚙️ *Your Configuration*\n\n` +
      `*Git Settings:*\n` +
      `👤 User Name: \`${config.git?.userName || 'Not set'}\`\n` +
      `📧 User Email: \`${config.git?.userEmail || 'Not set'}\`\n` +
      `🌿 Default Branch: \`${config.git?.defaultBranch || 'main'}\`\n\n` +
      `*Preferences:*\n` +
      `💾 Auto Commit: ${config.preferences?.autoCommit ? '✅' : '❌'}\n` +
      `📤 Auto Push: ${config.preferences?.autoPush ? '✅' : '❌'}\n` +
      `🔔 Notify on Complete: ${config.preferences?.notifyOnTaskComplete ? '✅' : '❌'}\n` +
      `⚠️ Danger Mode: ${config.preferences?.dangerModeEnabled ? '✅' : '❌'}\n\n` +
      `*Limits:*\n` +
      `🔢 Max Concurrent Tasks: \`${config.limits?.maxConcurrentTasks || 3}\`\n` +
      `⏱️ Task Timeout: \`${(config.limits?.taskTimeoutMs || 1800000) / 1000}s\`\n\n` +
      `*Tech Stack:*\n` +
      `💻 Languages: \`${config.techStack?.languages || 'Not set'}\`\n` +
      `📦 Frameworks: \`${config.techStack?.frameworks || 'Not set'}\`\n` +
      `🛠️ Tools: \`${config.techStack?.tools || 'Not set'}\`\n\n` +
      `_Last updated: ${config.updatedAt.toLocaleString()}_`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👤 Edit Git', callback_data: 'config_git' },
            { text: '⚙️ Edit Preferences', callback_data: 'config_preferences' }
          ],
          [
            { text: '📊 Edit Limits', callback_data: 'config_limits' },
            { text: '🛠️ Edit Tech Stack', callback_data: 'config_techstack' }
          ],
          [
            { text: '🔙 Back to Config Menu', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Set a config value
   */
  private async setConfigValue(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    if (args.length < 2) {
      await this.bot.sendMessage(
        chatId,
        `❌ Usage: /config set <key> <value>\n\n` +
        `Example: \`/config set git.userName "John Doe"\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const key = args[0];
    const value = args.slice(1).join(' ').replace(/^["']|["']$/g, ''); // Remove quotes

    try {
      const updates = this.parseConfigUpdate(key, value);
      await this.userConfigManager.updateConfig(userId, updates);

      await this.bot.sendMessage(
        chatId,
        `✅ Configuration updated!\n\n` +
        `\`${key}\` = \`${value}\`\n\n` +
        `Use \`/config show\` to see all settings.`,
        { parse_mode: 'Markdown' }
      );

      logger.info('User config updated via command', {
        userId,
        key,
        value
      });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to update config: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse config key and value into update object
   */
  private parseConfigUpdate(key: string, value: string): any {
    const parts = key.split('.');

    if (parts.length !== 2) {
      throw new Error('Invalid config key format. Use: category.key (e.g., git.userName)');
    }

    const [category, field] = parts;

    // Convert string value to appropriate type
    let parsedValue: any = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(Number(value))) parsedValue = Number(value);

    // Build update object
    const update: any = {};

    switch (category) {
      case 'git':
        update.git = { [field]: parsedValue };
        break;
      case 'preferences':
        update.preferences = { [field]: parsedValue };
        break;
      case 'limits':
        update.limits = { [field]: parsedValue };
        break;
      case 'techStack':
        update.techStack = { [field]: parsedValue };
        break;
      default:
        throw new Error(`Unknown config category: ${category}. Valid: git, preferences, limits, techStack`);
    }

    return update;
  }

  /**
   * Reset config to defaults
   */
  private async resetConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    try {
      await this.userConfigManager.resetConfig(userId);

      await this.bot.sendMessage(
        chatId,
        `✅ Configuration reset to defaults!\n\n` +
        `Use \`/config show\` to see the default settings.`,
        { parse_mode: 'Markdown' }
      );

      logger.info('User config reset', { userId });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        `❌ Failed to reset config: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
