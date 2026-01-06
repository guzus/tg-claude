import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../services/ClaudeExecutor';
import { RateLimiter } from '../services/RateLimiter';
import { AuditLogger } from '../services/AuditLogger';
import { UserConfigManager } from '../services/UserConfigManager';
import { RepositoryManager } from '../services/RepositoryManager';
import { ConversationManager } from '../services/ConversationManager';
import { McpConfig, McpServer, UserConfig, AIProvider, GLM_MODEL_MAPPINGS, OPENROUTER_MODEL_MAPPINGS } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { stateManager } from '../services/StateManager';

// MCP Server Presets - popular MCP servers that can be easily added
const MCP_PRESETS: Record<string, { server: McpServer; description: string }> = {
  playwright: {
    server: { command: 'npx', args: ['@playwright/mcp@latest'] },
    description: 'Browser automation via Playwright (Microsoft)'
  },
  filesystem: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-filesystem'] },
    description: 'File system access'
  },
  github: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-github'] },
    description: 'GitHub API integration'
  },
  memory: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-memory'] },
    description: 'Persistent memory/knowledge graph'
  },
  puppeteer: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-puppeteer'] },
    description: 'Browser automation via Puppeteer'
  },
  fetch: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-fetch'] },
    description: 'HTTP fetch capabilities'
  }
};

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
   * /ai command - Quick toggle between AI providers
   */
  async handleAi(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Config manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const provider = config.aiProvider?.provider || 'anthropic';

    const providerLabels: Record<AIProvider, string> = {
      anthropic: 'Claude',
      glm: 'GLM',
      openrouter: 'OpenRouter'
    };

    const models = this.getProviderModelMap(provider, config);
    const isCustom = {
      haiku: !!config.aiProvider?.haikuModel,
      sonnet: !!config.aiProvider?.sonnetModel,
      opus: !!config.aiProvider?.opusModel
    };
    const modelLines = [
      `Haiku: \`${UIHelpers.escapeMarkdown(models.haiku)}\`${isCustom.haiku ? ' _(custom)_' : ''}`,
      `Sonnet: \`${UIHelpers.escapeMarkdown(models.sonnet)}\`${isCustom.sonnet ? ' _(custom)_' : ''}`,
      `Opus: \`${UIHelpers.escapeMarkdown(models.opus)}\`${isCustom.opus ? ' _(custom)_' : ''}`,
    ].join('\n');

    const keyStatus = (() => {
      if (provider === 'glm') return config.aiProvider?.glmApiKey ? '✓' : '–';
      if (provider === 'openrouter') return config.aiProvider?.openrouterApiKey ? '✓' : '–';
      return '–';
    })();

    // Build buttons for providers other than current
    const buttons = (['anthropic', 'glm', 'openrouter'] as AIProvider[])
      .filter(p => p !== provider)
      .map(p => ({ text: providerLabels[p], callback_data: `ai_switch_${p}` }));

    const message =
      `*${providerLabels[provider]}*\n` +
      (provider === 'anthropic' ? `` : `Key: *${keyStatus}*\n`) +
      `\n${modelLines}`;

    const keyboardRows: { text: string; callback_data: string }[][] = [];
    if (buttons.length > 0) keyboardRows.push(buttons);

    if (provider === 'glm') {
      keyboardRows.push([{ text: config.aiProvider?.glmApiKey ? '🔑 Update GLM Key' : '🔑 Set GLM Key', callback_data: 'apikey_set_glm' }]);
    } else if (provider === 'openrouter') {
      keyboardRows.push([{ text: config.aiProvider?.openrouterApiKey ? '🔑 Update OpenRouter Key' : '🔑 Set OpenRouter Key', callback_data: 'apikey_set_openrouter' }]);
      keyboardRows.push([
        { text: 'H Model', callback_data: 'model_menu_openrouter_haiku' },
        { text: 'S Model', callback_data: 'model_menu_openrouter_sonnet' },
        { text: 'O Model', callback_data: 'model_menu_openrouter_opus' }
      ]);
      keyboardRows.push([{ text: '↩︎ Reset Models to Defaults', callback_data: 'model_reset_openrouter' }]);
    }

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  }

  /**
   * Handle API key entry from a plain text message (triggered by inline buttons)
   */
  async handleApiKeyEntry(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const text = msg.text?.trim() || '';

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Config manager not available');
      return;
    }

    const pending = stateManager.getPendingApiKeyEntry(userId);
    if (!pending) {
      // Not actually pending anymore; treat as normal message
      return;
    }

    // Allow user to type "cancel"
    if (text.toLowerCase() === 'cancel') {
      stateManager.clearPendingApiKeyEntry(userId);
      await this.bot.sendMessage(chatId, 'Cancelled.');
      return;
    }

    const key = text;
    if (!key) {
      await this.bot.sendMessage(chatId, '❌ Empty key. Paste the API key, or type `cancel`.', { parse_mode: 'Markdown' });
      return;
    }

    const current = await this.userConfigManager.getConfig(userId);
    const aiProvider = current.aiProvider || { provider: 'anthropic' as AIProvider };
    const updates = pending.provider === 'glm'
      ? { aiProvider: { ...aiProvider, glmApiKey: key } }
      : { aiProvider: { ...aiProvider, openrouterApiKey: key } };

    await this.userConfigManager.updateConfig(userId, updates);
    stateManager.clearPendingApiKeyEntry(userId);

    // Best-effort delete the user's message containing the secret
    try {
      if (msg.message_id) {
        const botWithDelete = this.bot as unknown as {
          deleteMessage?: (chatId: number, messageId: string) => Promise<boolean>;
        };
        await botWithDelete.deleteMessage?.(chatId, String(msg.message_id));
      }
    } catch {
      // Ignore if we can't delete (permissions/Telegram behavior)
    }

    const masked = this.maskSecret(key);
    const providerLabel = pending.provider === 'glm' ? 'GLM' : 'OpenRouter';
    const switchCb = pending.provider === 'glm' ? 'ai_switch_glm' : 'ai_switch_openrouter';

    await this.bot.editMessageText(
      `✅ *${providerLabel} key saved*\n\n` +
      `Stored: \`${UIHelpers.escapeMarkdown(masked)}\`\n\n` +
      `_Tip: if the key message wasn’t deleted automatically, delete it manually._`,
      {
        chat_id: pending.chatId,
        message_id: pending.messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: `Switch to ${providerLabel}`, callback_data: switchCb }],
            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }

  /**
   * Handle model entry from a plain text message (triggered by inline buttons)
   */
  async handleModelEntry(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const text = msg.text?.trim() || '';

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Config manager not available');
      return;
    }

    const pending = stateManager.getPendingModelEntry(userId);
    if (!pending) return;

    if (text.toLowerCase() === 'cancel') {
      stateManager.clearPendingModelEntry(userId);
      await this.bot.sendMessage(chatId, 'Cancelled.');
      return;
    }

    const model = text;
    if (!model) {
      await this.bot.sendMessage(
        chatId,
        '❌ Empty model. Paste a model id like `openai/gpt-5.2` (or `anthropic/claude-sonnet-4.5`), or type `cancel`.',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const current = await this.userConfigManager.getConfig(userId);
    const aiProvider = current.aiProvider || { provider: 'openrouter' as AIProvider };
    const field = pending.slot === 'haiku' ? 'haikuModel' : pending.slot === 'sonnet' ? 'sonnetModel' : 'opusModel';
    const updatedAiProvider = { ...aiProvider, [field]: model } as typeof aiProvider;

    await this.userConfigManager.updateConfig(userId, { aiProvider: updatedAiProvider });
    stateManager.clearPendingModelEntry(userId);

    await this.bot.editMessageText(
      `✅ *OpenRouter model saved*\n\n` +
      `Slot: *${pending.slot.toUpperCase()}*\n` +
      `Model: \`${UIHelpers.escapeMarkdown(model)}\`\n\n` +
      `Configure another slot below, or run /ai to verify.`,
      {
        chat_id: pending.chatId,
        message_id: pending.messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: 'H Model', callback_data: 'model_menu_openrouter_haiku' },
              { text: 'S Model', callback_data: 'model_menu_openrouter_sonnet' },
              { text: 'O Model', callback_data: 'model_menu_openrouter_opus' }
            ],
            [{ text: '↩︎ Reset Defaults', callback_data: 'model_reset_openrouter' }],
            [{ text: '🏠 Main Menu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }

  private maskSecret(secret: string): string {
    const s = secret.trim();
    if (s.length <= 10) return `${s.substring(0, 2)}…${s.substring(Math.max(0, s.length - 2))}`;
    return `${s.substring(0, 4)}…${s.substring(s.length - 4)}`;
  }

  private getProviderModelMap(provider: AIProvider, config: UserConfig): { haiku: string; sonnet: string; opus: string } {
    const ai = config.aiProvider;

    if (provider === 'glm') {
      return {
        haiku: ai?.haikuModel || GLM_MODEL_MAPPINGS.haiku,
        sonnet: ai?.sonnetModel || GLM_MODEL_MAPPINGS.sonnet,
        opus: ai?.opusModel || GLM_MODEL_MAPPINGS.opus,
      };
    }

    if (provider === 'openrouter') {
      return {
        haiku: ai?.haikuModel || OPENROUTER_MODEL_MAPPINGS.haiku,
        sonnet: ai?.sonnetModel || OPENROUTER_MODEL_MAPPINGS.sonnet,
        opus: ai?.opusModel || OPENROUTER_MODEL_MAPPINGS.opus,
      };
    }

    // Anthropic (Claude subscription via Claude Code): show Claude Code's internal slots.
    return { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' };
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

    // No subcommand or 'show' - display current config
    if (!subcommand || subcommand.toLowerCase() === 'show' || subcommand.toLowerCase() === 'view') {
      await this.showConfig(msg);
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
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
            `Unknown: ${subcommand}\n\n` +
            `/config set <key> <value>\n` +
            `/config reset`
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

  private async showConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Config manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const provider: AIProvider = config.aiProvider?.provider || 'anthropic';

    const providerLabels: Record<string, string> = {
      anthropic: 'Claude',
      glm: 'GLM',
      openrouter: 'OpenRouter'
    };

    const models = this.getProviderModelMap(provider, config);

    const glmKeyMasked = config.aiProvider?.glmApiKey ? `set (\`${UIHelpers.escapeMarkdown(this.maskSecret(config.aiProvider.glmApiKey))}\`)` : '–';
    const openRouterKeyMasked = config.aiProvider?.openrouterApiKey ? `set (\`${UIHelpers.escapeMarkdown(this.maskSecret(config.aiProvider.openrouterApiKey))}\`)` : '–';

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    const repoId = currentRepo?.id || config.currentRepositoryId;
    const mcpServerCount = repoId ? Object.keys(config.mcpConfigs?.[repoId]?.mcpServers || {}).length : 0;

    const timeoutMs = config.limits?.taskTimeoutMs;
    const timeoutStr = timeoutMs ? UIHelpers.formatDuration(Math.round(timeoutMs / 1000)) : '–';

    const lines: string[] = [];

    lines.push('*Your Configuration*');
    lines.push('');

    // Repo
    lines.push('📁 *Repository*');
    lines.push(`Current: ${currentRepo ? `*${UIHelpers.escapeMarkdown(currentRepo.name)}* (\`${currentRepo.id.substring(0, 8)}\`)` : '–'}`);
    lines.push('');

    // AI
    lines.push('🤖 *AI*');
    lines.push(`Provider: *${providerLabels[provider]}*`);
    lines.push(`GLM key: ${glmKeyMasked}`);
    lines.push(`OpenRouter key: ${openRouterKeyMasked}`);
    lines.push(`Models (effective): H \`${UIHelpers.escapeMarkdown(models.haiku)}\`  S \`${UIHelpers.escapeMarkdown(models.sonnet)}\`  O \`${UIHelpers.escapeMarkdown(models.opus)}\``);
    lines.push('');

    // Git
    lines.push('👤 *Git*');
    lines.push(`Name: \`${UIHelpers.escapeMarkdown(config.git?.userName || '–')}\``);
    lines.push(`Email: \`${UIHelpers.escapeMarkdown(config.git?.userEmail || '–')}\``);
    lines.push(`Default branch: \`${UIHelpers.escapeMarkdown(config.git?.defaultBranch || 'main')}\``);
    lines.push('');

    // Stack
    lines.push('🛠️ *Tech Stack*');
    lines.push(`TypeScript: \`${UIHelpers.escapeMarkdown(config.techStack?.typescript || 'bun')}\``);
    lines.push(`Python: \`${UIHelpers.escapeMarkdown(config.techStack?.python || 'uv')}\``);
    lines.push('');

    // Preferences
    lines.push('⚙️ *Preferences*');
    lines.push(`Notify on complete: \`${String(config.preferences?.notifyOnTaskComplete ?? true)}\``);
    lines.push('');

    // Limits
    lines.push('📊 *Limits*');
    lines.push(`Max concurrent tasks: \`${String(config.limits?.maxConcurrentTasks ?? 3)}\``);
    lines.push(`Task timeout: \`${timeoutStr}\``);
    lines.push('');

    // MCP
    lines.push('🔌 *MCP*');
    lines.push(`Current repo servers: \`${mcpServerCount}\``);
    lines.push('');

    // Other
    lines.push('🗂️ *Other*');
    lines.push(`CLAUDE.md template: ${config.claudeMdTemplate ? `set (\`${config.claudeMdTemplate.length} chars\`)` : '–'}`);
    lines.push(`Deleted repos remembered: \`${String(config.deletedRepositories?.length ?? 0)}\``);
    lines.push(`Updated: \`${config.updatedAt.toISOString()}\``);

    await this.bot.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔄 Reset', callback_data: 'config_reset_confirm' },
            { text: '🏠 Main Menu', callback_data: 'main_menu' }
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
        update.aiProvider = { [field]: value } as unknown as typeof update.aiProvider;
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
    const validProviders: AIProvider[] = ['anthropic', 'glm', 'openrouter'];

    if (field === 'provider') {
      if (!validProviders.includes(value as AIProvider)) {
        throw new Error(`Invalid AI provider: ${value}. Valid: ${validProviders.join(', ')}`);
      }
    } else if (field === 'glmApiKey' || field === 'openrouterApiKey') {
      // API key can be any non-empty string
      if (!value || value.trim() === '') {
        throw new Error('API key cannot be empty');
      }
    } else if (field === 'model' || field === 'haikuModel' || field === 'sonnetModel' || field === 'opusModel') {
      // Model can be any string (e.g., "openai/gpt-4o", "anthropic/claude-sonnet-4")
    } else {
      throw new Error(`Unknown aiProvider field: ${field}. Valid: provider, glmApiKey, openrouterApiKey, haikuModel, sonnetModel, opusModel`);
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
        case 'preset':
          await this.handleMcpPreset(msg, args.slice(1), currentRepo.id);
          break;
        case 'presets':
          await this.showMcpPresets(msg);
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

    const presetNames = Object.keys(MCP_PRESETS).join(', ');

    const message =
      `🔌 *MCP Servers* (current repo)\n\n` +
      `Configured servers: ${serverCount}\n\n` +
      `*Commands:*\n` +
      `/mcp preset <name> - Add from presets\n` +
      `/mcp presets - Show available presets\n` +
      `/mcp add <name> <cmd> [args...] - Add custom\n` +
      `/mcp remove <name> - Remove server\n` +
      `/mcp list - Show all servers\n` +
      `/mcp clear - Remove all servers\n\n` +
      `*Quick presets:* ${presetNames}\n\n` +
      `*Examples:*\n` +
      `\`/mcp preset playwright\` ← Browser automation\n` +
      `\`/mcp preset filesystem\` ← File access\n` +
      `\`/mcp add custom npx my-mcp-server\``;

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

  private async showMcpPresets(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    const presetLines = Object.entries(MCP_PRESETS).map(([name, { description }]) => {
      return `• \`${name}\` - ${description}`;
    });

    const message =
      `🎯 *Available MCP Presets*\n\n` +
      presetLines.join('\n') +
      `\n\n*Usage:* \`/mcp preset <name>\`\n` +
      `Example: \`/mcp preset playwright\``;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  private async handleMcpPreset(msg: Message, args: string[], repoId: string): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length < 1) {
      await this.showMcpPresets(msg);
      return;
    }

    const presetName = args[0].toLowerCase();
    const preset = MCP_PRESETS[presetName];

    if (!preset) {
      const availablePresets = Object.keys(MCP_PRESETS).join(', ');
      await this.bot.sendMessage(chatId,
        `❌ Unknown preset: \`${presetName}\`\n\n` +
        `Available presets: ${availablePresets}\n\n` +
        `Use \`/mcp presets\` to see descriptions.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Configuration manager not available');
      return;
    }

    const config = await this.userConfigManager.getConfig(userId);
    const mcpConfigs = config.mcpConfigs || {};
    const repoMcpConfig: McpConfig = mcpConfigs[repoId] || { mcpServers: {} };

    // Check if already exists
    if (repoMcpConfig.mcpServers[presetName]) {
      await this.bot.sendMessage(chatId,
        `⚠️ MCP server \`${presetName}\` already exists.\n\n` +
        `Use \`/mcp remove ${presetName}\` first to replace it.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    repoMcpConfig.mcpServers[presetName] = preset.server;
    mcpConfigs[repoId] = repoMcpConfig;

    await this.userConfigManager.updateConfig(userId, { mcpConfigs });

    const currentRepo = this.repoManager.getCurrentRepository(userId);
    if (currentRepo) {
      await this.repoManager.syncClaudeSettings(userId, currentRepo.path, repoId);
    }

    const argsStr = preset.server.args?.join(' ') || '';
    await this.bot.sendMessage(chatId,
      `✅ MCP preset added: \`${presetName}\`\n\n` +
      `${preset.description}\n\n` +
      `Command: \`${preset.server.command} ${argsStr}\``,
      { parse_mode: 'Markdown' }
    );

    logger.info('MCP preset added', { userId, repoId, presetName });
  }
}
