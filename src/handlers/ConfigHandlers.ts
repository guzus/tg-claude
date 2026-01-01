import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { UserConfigManager } from '../services/UserConfigManager';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { McpConfig, McpServer, UserConfig, AIProvider, GLM_MODEL_MAPPINGS } from '../types';

// Default Anthropic models used by Claude Code
// Per docs: https://docs.claude.com/en/docs/claude-code/model-config
const ANTHROPIC_MODELS = {
  haiku: 'Haiku 3.5',
  sonnet: 'Sonnet 4.5',
  opus: 'Opus 4.5'
};
import { logger } from '../utils/logger';

export class ConfigHandlers extends BaseHandler {
  private repoManager: RepositoryManager;

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    repositoryManager: RepositoryManager,
    userConfigManager: UserConfigManager,
    conversationManager?: ConversationManager
  ) {
    super(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager);
    this.repoManager = repositoryManager;
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

        case 'claudemd':
          await this.handleClaudeMd(msg, args.slice(1));
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

  private async showConfigMenu(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    const message =
      `⚙️ *User Configuration*\n\n` +
      `Commands:\n` +
      `/config show - View current configuration\n` +
      `/config set <key> <value> - Set a config value\n` +
      `/config claudemd - Manage CLAUDE.md template\n` +
      `/config reset - Reset to defaults\n\n` +
      `Configuration keys:\n` +
      `• \`git.userName\` - Git user name\n` +
      `• \`git.userEmail\` - Git user email\n` +
      `• \`techStack.typescript\` - TS (bun/npm/pnpm/yarn)\n` +
      `• \`techStack.python\` - Python (uv/pip/poetry/pipenv)\n` +
      `• \`aiProvider.provider\` - AI provider (anthropic/glm)\n` +
      `• \`aiProvider.apiKey\` - Provider API key\n` +
      `• \`preferences.dangerModeEnabled\` - Danger mode\n` +
      `• \`limits.maxConcurrentTasks\` - Max tasks\n\n` +
      `Example:\n` +
      `\`/config set aiProvider.provider glm\``;

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
            { text: '🛠️ Tech Stack', callback_data: 'config_techstack' },
            { text: '🤖 AI Provider', callback_data: 'config_aiprovider' }
          ],
          [
            { text: '📊 Limits', callback_data: 'config_limits' },
            { text: '🔙 Back to Main Menu', callback_data: 'main_menu' }
          ]
        ]
      }
    });
  }

  private async showConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const providerDisplay = config.aiProvider?.provider || 'anthropic';
    const hasApiKey = config.aiProvider?.apiKey ? '✅ Set' : '❌ Not set';

    // Get model mappings based on provider
    const isGlm = providerDisplay === 'glm';
    const models = isGlm ? GLM_MODEL_MAPPINGS : ANTHROPIC_MODELS;

    const message =
      `⚙️ *Your Configuration*\n\n` +
      `*Git Settings:*\n` +
      `👤 User Name: \`${config.git?.userName || 'Not set'}\`\n` +
      `📧 User Email: \`${config.git?.userEmail || 'Not set'}\`\n` +
      `🌿 Default Branch: \`${config.git?.defaultBranch || 'main'}\`\n\n` +
      `*AI Provider:*\n` +
      `🤖 Provider: \`${providerDisplay}\`\n` +
      `🔑 API Key: ${hasApiKey}\n` +
      `📊 Models:\n` +
      `   Haiku → \`${models.haiku}\`\n` +
      `   Sonnet → \`${models.sonnet}\`\n` +
      `   Opus → \`${models.opus}\`\n\n` +
      `*Tech Stack:*\n` +
      `📦 TypeScript: \`${config.techStack?.typescript || 'bun'}\`\n` +
      `🐍 Python: \`${config.techStack?.python || 'uv'}\`\n\n` +
      `*Preferences:*\n` +
      `💾 Auto Commit: ${config.preferences?.autoCommit ? '✅' : '❌'}\n` +
      `📤 Auto Push: ${config.preferences?.autoPush ? '✅' : '❌'}\n` +
      `🔔 Notify on Complete: ${config.preferences?.notifyOnTaskComplete ? '✅' : '❌'}\n` +
      `⚠️ Danger Mode: ${config.preferences?.dangerModeEnabled ? '✅' : '❌'}\n\n` +
      `*Limits:*\n` +
      `🔢 Max Concurrent Tasks: \`${config.limits?.maxConcurrentTasks || 3}\`\n` +
      `⏱️ Task Timeout: \`${(config.limits?.taskTimeoutMs || 1800000) / 1000}s\`\n\n` +
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
            { text: '🛠️ Edit Tech Stack', callback_data: 'config_techstack' },
            { text: '🤖 Edit AI Provider', callback_data: 'config_aiprovider' }
          ],
          [
            { text: '📊 Edit Limits', callback_data: 'config_limits' },
            { text: '🔙 Back to Config Menu', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

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
        `Example: \`/config set techStack.typescript bun\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const key = args[0];
    const value = args.slice(1).join(' ').replace(/^["']|["']$/g, '');

    try {
      const updates = this.parseConfigUpdate(key, value);
      await this.userConfigManager.updateConfig(userId, updates);

      if (key.startsWith('techStack.')) {
        await this.syncTechStackToAllRepos(userId);
      }

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

  private async syncTechStackToAllRepos(userId: number): Promise<void> {
    const repos = await this.repoManager.listRepositories(userId);
    for (const repo of repos) {
      await this.repoManager.syncClaudeSettings(userId, repo.path);
    }
  }

  private parseConfigUpdate(key: string, value: string): Partial<UserConfig> {
    const parts = key.split('.');

    if (parts.length !== 2) {
      throw new Error('Invalid config key format. Use: category.key (e.g., git.userName)');
    }

    const [category, field] = parts;

    let parsedValue: string | boolean | number = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (!isNaN(Number(value))) parsedValue = Number(value);

    const update: Partial<UserConfig> = {};

    switch (category) {
      case 'git':
        update.git = { [field]: parsedValue };
        break;
      case 'techStack':
        this.validateTechStackValue(field, value);
        update.techStack = { [field]: value };
        break;
      case 'aiProvider':
        this.validateAIProviderValue(field, value);
        update.aiProvider = { [field]: value } as any;
        break;
      case 'preferences':
        update.preferences = { [field]: parsedValue };
        break;
      case 'limits':
        update.limits = { [field]: parsedValue };
        break;
      default:
        throw new Error(`Unknown config category: ${category}. Valid: git, techStack, aiProvider, preferences, limits`);
    }

    return update;
  }

  private validateTechStackValue(field: string, value: string): void {
    const validValues: Record<string, string[]> = {
      typescript: ['bun', 'npm', 'pnpm', 'yarn'],
      python: ['uv', 'pip', 'poetry', 'pipenv']
    };

    const allowed = validValues[field];
    if (!allowed) {
      throw new Error(`Unknown techStack field: ${field}. Valid: typescript, python`);
    }
    if (!allowed.includes(value)) {
      throw new Error(`Invalid value for techStack.${field}. Valid: ${allowed.join(', ')}`);
    }
  }

  private validateAIProviderValue(field: string, value: string): void {
    const validProviders: AIProvider[] = ['anthropic', 'glm'];

    if (field === 'provider') {
      if (!validProviders.includes(value as AIProvider)) {
        throw new Error(`Invalid AI provider: ${value}. Valid: ${validProviders.join(', ')}`);
      }
    } else if (field === 'apiKey') {
      // API key can be any non-empty string
      if (!value || value.trim() === '') {
        throw new Error('API key cannot be empty');
      }
    } else if (field === 'model') {
      // Model can be any string
    } else {
      throw new Error(`Unknown aiProvider field: ${field}. Valid: provider, apiKey, model`);
    }
  }

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

  private async handleClaudeMd(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);

    if (args.length === 0 || args[0] === 'show') {
      const template = config.claudeMdTemplate || '(not set)';
      await this.bot.sendMessage(chatId,
        `📝 *CLAUDE.md Template*\n\n\`\`\`\n${template}\n\`\`\`\n\n` +
        `To update, use:\n\`/config claudemd set <content>\`\n\n` +
        `Or reset to default:\n\`/config claudemd reset\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (args[0] === 'reset') {
      await this.userConfigManager.resetConfig(userId);
      const newConfig = await this.userConfigManager.getConfig(userId);
      await this.bot.sendMessage(chatId,
        `✅ CLAUDE.md template reset to default.\n\n\`\`\`\n${newConfig.claudeMdTemplate}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (args[0] === 'set') {
      const content = args.slice(1).join(' ');
      if (!content) {
        await this.bot.sendMessage(chatId,
          `❌ Usage: /config claudemd set <content>\n\n` +
          `Example:\n\`/config claudemd set # My Guidelines\\n1. Be concise\\n2. Write tests\``,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const parsed = content.replace(/\\n/g, '\n');
      await this.userConfigManager.updateConfig(userId, { claudeMdTemplate: parsed });
      
      await this.bot.sendMessage(chatId,
        `✅ CLAUDE.md template updated!\n\n\`\`\`\n${parsed}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
      logger.info('CLAUDE.md template updated', { userId });
      return;
    }

    await this.bot.sendMessage(chatId,
      `❌ Unknown claudemd subcommand: ${args[0]}\n\nUse: show, set, reset`
    );
  }

  async handleMcp(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    const currentRepo = this.repoManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(chatId, '❌ No repository selected. Use `/repo` first.', { parse_mode: 'Markdown' });
      return;
    }

    if (!subcommand) {
      await this.showMcpHelp(chatId, userId, currentRepo.id);
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'add':
          await this.addMcpServer(msg, args.slice(1), currentRepo.id);
          break;
        case 'remove':
        case 'rm':
          await this.removeMcpServer(msg, args.slice(1), currentRepo.id);
          break;
        case 'list':
        case 'show':
          await this.showMcpServers(msg, currentRepo.id);
          break;
        case 'clear':
          await this.clearMcpServers(msg, currentRepo.id);
          break;
        default:
          await this.bot.sendMessage(chatId, `❌ Unknown subcommand: ${subcommand}\nUse /mcp for help.`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      logger.error('MCP command failed', { userId, subcommand, error: errorMessage });
    }
  }

  private async showMcpHelp(chatId: number, userId: number, repoId: string): Promise<void> {
    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcpConfigs?.[repoId];
    const serverCount = mcpConfig ? Object.keys(mcpConfig.mcpServers).length : 0;

    const message =
      `🔌 *MCP Servers* (current repo)\n\n` +
      `Configured servers: ${serverCount}\n\n` +
      `*Commands:*\n` +
      `/mcp add <name> <command> [args...] - Add server\n` +
      `/mcp remove <name> - Remove server\n` +
      `/mcp list - Show all servers\n` +
      `/mcp clear - Remove all servers\n\n` +
      `*Examples:*\n` +
      `\`/mcp add filesystem npx -y @anthropic/mcp-filesystem\`\n` +
      `\`/mcp add github npx -y @anthropic/mcp-github\`\n` +
      `\`/mcp remove filesystem\``;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async addMcpServer(msg: Message, args: string[], repoId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length < 2) {
      await this.bot.sendMessage(chatId,
        `❌ Usage: /mcp add <name> <command> [args...]\n\n` +
        `Example: \`/mcp add filesystem npx -y @anthropic/mcp-filesystem\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const [serverName, command, ...serverArgs] = args;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const mcpConfigs = config.mcpConfigs || {};
    const repoMcpConfig: McpConfig = mcpConfigs[repoId] || { mcpServers: {} };

    const server: McpServer = { command };
    if (serverArgs.length > 0) {
      server.args = serverArgs;
    }

    repoMcpConfig.mcpServers[serverName] = server;
    mcpConfigs[repoId] = repoMcpConfig;

    await this.userConfigManager.updateConfig(userId, { mcpConfigs });

    const currentRepo = this.repoManager.getCurrentRepository(userId);
    if (currentRepo) {
      await this.repoManager.syncClaudeSettings(userId, currentRepo.path, repoId);
    }

    await this.bot.sendMessage(chatId,
      `✅ MCP server added: \`${serverName}\`\n\n` +
      `Command: \`${command}\`\n` +
      (serverArgs.length > 0 ? `Args: \`${serverArgs.join(' ')}\`` : ''),
      { parse_mode: 'Markdown' }
    );

    logger.info('MCP server added', { userId, repoId, serverName, command });
  }

  private async removeMcpServer(msg: Message, args: string[], repoId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length < 1) {
      await this.bot.sendMessage(chatId, `❌ Usage: /mcp remove <name>`);
      return;
    }

    const serverName = args[0];

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const mcpConfigs = config.mcpConfigs || {};
    const repoMcpConfig = mcpConfigs[repoId];

    if (!repoMcpConfig || !repoMcpConfig.mcpServers[serverName]) {
      await this.bot.sendMessage(chatId, `❌ MCP server not found: \`${serverName}\``, { parse_mode: 'Markdown' });
      return;
    }

    delete repoMcpConfig.mcpServers[serverName];
    mcpConfigs[repoId] = repoMcpConfig;

    await this.userConfigManager.updateConfig(userId, { mcpConfigs });

    const currentRepo = this.repoManager.getCurrentRepository(userId);
    if (currentRepo) {
      await this.repoManager.syncClaudeSettings(userId, currentRepo.path, repoId);
    }

    await this.bot.sendMessage(chatId, `✅ MCP server removed: \`${serverName}\``, { parse_mode: 'Markdown' });
    logger.info('MCP server removed', { userId, repoId, serverName });
  }

  private async showMcpServers(msg: Message, repoId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const mcpConfig = config.mcpConfigs?.[repoId];

    if (!mcpConfig || Object.keys(mcpConfig.mcpServers).length === 0) {
      await this.bot.sendMessage(chatId, '📭 No MCP servers configured for this repository.\n\nUse `/mcp add` to add one.', { parse_mode: 'Markdown' });
      return;
    }

    const serverLines = Object.entries(mcpConfig.mcpServers).map(([name, server]) => {
      const argsStr = server.args?.join(' ') || '';
      return `• \`${name}\`: ${server.command} ${argsStr}`.trim();
    });

    await this.bot.sendMessage(chatId,
      `🔌 *MCP Servers*\n\n${serverLines.join('\n')}`,
      { parse_mode: 'Markdown' }
    );
  }

  private async clearMcpServers(msg: Message, repoId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const mcpConfigs = config.mcpConfigs || {};

    if (mcpConfigs[repoId]) {
      delete mcpConfigs[repoId];
      await this.userConfigManager.updateConfig(userId, { mcpConfigs });

      const currentRepo = this.repoManager.getCurrentRepository(userId);
      if (currentRepo) {
        await this.repoManager.syncClaudeSettings(userId, currentRepo.path, repoId);
      }
    }

    await this.bot.sendMessage(chatId, '✅ All MCP servers cleared for this repository.');
    logger.info('MCP servers cleared', { userId, repoId });
  }
}
