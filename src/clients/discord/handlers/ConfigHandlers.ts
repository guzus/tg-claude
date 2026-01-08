import { ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { ConversationManager } from '../../../services/ConversationManager';
import { McpConfig, McpServer, AIProvider } from '../../../types';
import { MCP_PRESETS, PLUGIN_PRESETS } from '../../../presets';
import { ensureDefaultPluginMarketplaces } from '../../../services/ClaudePluginMarketplace';
import { getErrorMessage } from '../../../utils/errors';
import { getProviderLabel } from '../../../utils/providers';
import { toSafeDiscordId } from '../utils/ids';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

type ChannelContext = {
  channelId: string;
  channelKey: number;
  channelName: string;
  workingDir: string;
  repoId: string;
};

export class ConfigHandlers extends BaseHandler {
  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    private repositoryManager: RepositoryManager,
    private userConfigManager: UserConfigManager,
    conversationManager?: ConversationManager
  ) {
    super(executor, rateLimiter, auditLogger, conversationManager);
  }

  async handleRepo(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const context = this.getChannelContext(interaction);
    const action = interaction.options.getString('action') || 'status';

    try {
      switch (action) {
        case 'path': {
          await interaction.reply({
            content: `Workspace: \`${context.workingDir}\`\nRepo key: \`${context.repoId}\``,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'remotes': {
          const output = await this.execGit(['remote', '-v'], context.workingDir);
          await interaction.reply({
            content: output.trim() ? `\`\`\`\n${output.trim()}\n\`\`\`` : 'No remotes configured.',
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'status':
        default: {
          const output = await this.execGit(['status', '-sb'], context.workingDir);
          await interaction.reply({
            content: output.trim() ? `\`\`\`\n${output.trim()}\n\`\`\`` : 'No git status available.',
            flags: this.ephemeralFlags()
          });
        }
      }
    } catch (error) {
      await interaction.reply({
        content: `Failed to read repo info: ${getErrorMessage(error)}`,
        flags: this.ephemeralFlags()
      });
    }
  }

  async handleRepoNew(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const name = interaction.options.getString('name', true);
    const visibility = interaction.options.getString('visibility') || 'private';
    const isPrivate = visibility !== 'public';
    const context = this.getChannelContext(interaction);

    try {
      const isRepo = await this.isGitRepo(context.workingDir);
      if (!isRepo) {
        await this.execGit(['init'], context.workingDir);
        await this.execGit(['add', '.'], context.workingDir);
        await this.execGit(['commit', '-m', 'Initial commit', '--allow-empty'], context.workingDir);
      }

      const result = await this.executor.createGitHubRepository(
        context.workingDir,
        isPrivate,
        name
      );

      if (result === 'success') {
        await interaction.reply({
          content: `Created GitHub repo \`${name}\` (${visibility}).`,
          flags: this.ephemeralFlags()
        });
        return;
      }

      const message = result === 'already_exists'
        ? `Repo \`${name}\` already exists on GitHub.`
        : `Failed to create GitHub repo \`${name}\`.`;

      await interaction.reply({ content: message, flags: this.ephemeralFlags() });
    } catch (error) {
      await interaction.reply({
        content: `Repo creation failed: ${getErrorMessage(error)}`,
        flags: this.ephemeralFlags()
      });
    }
  }

  async handleWhoAmI(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const context = this.getChannelContext(interaction);
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const allowed = '✅ Allowed';

    await interaction.reply({
      content: [
        `User: \`${username}\` (${userId})`,
        `Channel: \`${context.channelName}\` (${context.channelId})`,
        `Access: ${allowed}`,
        `Workspace: \`${context.workingDir}\``
      ].join('\n'),
      flags: this.ephemeralFlags()
    });
  }

  async handleConfig(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const context = this.getChannelContext(interaction);
    const config = await this.userConfigManager.getConfig(context.channelKey);
    const provider = config.aiProvider?.provider || 'anthropic';
    const providerLabel = getProviderLabel(provider);
    const mcpCount = config.mcpConfigs?.[context.repoId]
      ? Object.keys(config.mcpConfigs[context.repoId].mcpServers).length
      : 0;

    const lines = [
      `Provider: **${providerLabel}**`,
      `MCP servers: ${mcpCount}`,
      `Workspace: \`${context.workingDir}\``
    ];

    await interaction.reply({
      content: lines.join('\n'),
      flags: this.ephemeralFlags()
    });
  }

  async handleAi(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const provider = interaction.options.getString('provider', true) as AIProvider;
    const context = this.getChannelContext(interaction);
    const config = await this.userConfigManager.getConfig(context.channelKey);
    const updated = await this.userConfigManager.updateConfig(context.channelKey, {
      aiProvider: { ...config.aiProvider, provider }
    });

    await interaction.reply({
      content: `AI provider set to **${getProviderLabel(updated.aiProvider?.provider || provider)}**.`,
      flags: this.ephemeralFlags()
    });
  }

  async handleModel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const slot = interaction.options.getString('slot', true) as 'haiku' | 'sonnet' | 'opus';
    const model = interaction.options.getString('model', true);

    const context = this.getChannelContext(interaction);
    const config = await this.userConfigManager.getConfig(context.channelKey);
    const current = config.aiProvider || { provider: 'anthropic' as AIProvider };
    const updated = {
      ...current,
      provider: current.provider || 'anthropic',
      [`${slot}Model`]: model
    } as typeof current;

    await this.userConfigManager.updateConfig(context.channelKey, { aiProvider: updated });

    await interaction.reply({
      content: `Set **${slot}** model to \`${model}\`.`,
      flags: this.ephemeralFlags()
    });
  }

  async handleMcp(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const action = interaction.options.getString('action') || 'list';
    const name = interaction.options.getString('name') || '';
    const command = interaction.options.getString('command') || '';
    const context = this.getChannelContext(interaction);

    const config = await this.userConfigManager.getConfig(context.channelKey);
    const mcpConfigs = config.mcpConfigs || {};
    const repoMcpConfig: McpConfig = mcpConfigs[context.repoId] || { mcpServers: {} };

    try {
      switch (action) {
        case 'list':
        case 'show': {
          const servers = Object.entries(repoMcpConfig.mcpServers);
          if (servers.length === 0) {
            await interaction.reply({
              content: 'No MCP servers configured for this channel.',
              flags: this.ephemeralFlags()
            });
            return;
          }
          const lines = servers.map(([serverName, server]) => {
            const argsStr = server.args?.join(' ') || '';
            return `• \`${serverName}\`: ${server.command} ${argsStr}`.trim();
          });
          await interaction.reply({
            content: `**MCP Servers**\n${lines.join('\n')}`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'clear': {
          delete mcpConfigs[context.repoId];
          await this.userConfigManager.updateConfig(context.channelKey, { mcpConfigs });
          await this.repositoryManager.syncClaudeSettings(context.channelKey, context.workingDir, context.repoId);
          await interaction.reply({ content: 'Cleared MCP servers for this channel.', flags: this.ephemeralFlags() });
          return;
        }
        case 'presets': {
          const lines = Object.entries(MCP_PRESETS).map(([presetName, preset]) => {
            return `• \`${presetName}\` - ${preset.description}`;
          });
          await interaction.reply({
            content: `**Available MCP Presets**\n${lines.join('\n')}`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'preset': {
          const presetName = name.toLowerCase();
          const preset = MCP_PRESETS[presetName];
          if (!preset) {
            await interaction.reply({
              content: `Unknown preset: \`${presetName}\`. Use \`/mcp action:presets\` to list.`,
              flags: this.ephemeralFlags()
            });
            return;
          }
          if (repoMcpConfig.mcpServers[presetName]) {
            await interaction.reply({
              content: `Preset \`${presetName}\` already exists. Remove it first.`,
              flags: this.ephemeralFlags()
            });
            return;
          }
          repoMcpConfig.mcpServers[presetName] = preset.server;
          mcpConfigs[context.repoId] = repoMcpConfig;
          await this.userConfigManager.updateConfig(context.channelKey, { mcpConfigs });
          await this.repositoryManager.syncClaudeSettings(context.channelKey, context.workingDir, context.repoId);
          await interaction.reply({
            content: `Added MCP preset \`${presetName}\`.`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'add': {
          if (!name || !command) {
            await interaction.reply({
              content: 'Usage: /mcp action:add name:<server> command:<cmd args...>',
              flags: this.ephemeralFlags()
            });
            return;
          }
          const [cmd, ...cmdArgs] = command.split(/\s+/);
          const server: McpServer = { command: cmd };
          if (cmdArgs.length > 0) server.args = cmdArgs;
          repoMcpConfig.mcpServers[name] = server;
          mcpConfigs[context.repoId] = repoMcpConfig;
          await this.userConfigManager.updateConfig(context.channelKey, { mcpConfigs });
          await this.repositoryManager.syncClaudeSettings(context.channelKey, context.workingDir, context.repoId);
          await interaction.reply({
            content: `Added MCP server \`${name}\`: \`${command}\``,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'remove':
        case 'rm': {
          if (!name) {
            await interaction.reply({
              content: 'Usage: /mcp action:remove name:<server>',
              flags: this.ephemeralFlags()
            });
            return;
          }
          if (!repoMcpConfig.mcpServers[name]) {
            await interaction.reply({
              content: `MCP server not found: \`${name}\``,
              flags: this.ephemeralFlags()
            });
            return;
          }
          delete repoMcpConfig.mcpServers[name];
          mcpConfigs[context.repoId] = repoMcpConfig;
          await this.userConfigManager.updateConfig(context.channelKey, { mcpConfigs });
          await this.repositoryManager.syncClaudeSettings(context.channelKey, context.workingDir, context.repoId);
          await interaction.reply({
            content: `Removed MCP server \`${name}\`.`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        default:
          await interaction.reply({
            content: 'Unknown MCP action.',
            flags: this.ephemeralFlags()
          });
      }
    } catch (error) {
      await interaction.reply({
        content: `MCP command failed: ${getErrorMessage(error)}`,
        flags: this.ephemeralFlags()
      });
    }
  }

  async handlePlugin(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const action = interaction.options.getString('action') || 'list';
    const spec = interaction.options.getString('spec') || '';
    const context = this.getChannelContext(interaction);

    ensureDefaultPluginMarketplaces(context.workingDir);

    try {
      switch (action) {
        case 'list':
        case 'show': {
          const output = await this.execClaudePlugin(['plugin', 'list'], context.workingDir);
          await interaction.reply({
            content: output.trim() ? `\`\`\`\n${output.trim()}\n\`\`\`` : 'No plugins installed.',
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'presets': {
          const lines = Object.entries(PLUGIN_PRESETS).map(([name, preset]) => {
            const defaultTag = preset.isDefault ? ' (default)' : '';
            return `• ${name} - ${preset.description}${defaultTag}`;
          });
          await interaction.reply({
            content: `**Plugin Presets**\n${lines.join('\n')}`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'preset': {
          if (!spec) {
            await interaction.reply({
              content: 'Usage: /plugin action:preset spec:<name>',
              flags: this.ephemeralFlags()
            });
            return;
          }
          const preset = PLUGIN_PRESETS[spec.toLowerCase()];
          if (!preset) {
            await interaction.reply({
              content: `Unknown preset: \`${spec}\`. Use /plugin action:presets.`,
              flags: this.ephemeralFlags()
            });
            return;
          }
          const pluginSpec = `${preset.name}@${preset.registry}`;
          await this.execClaudePlugin(['plugin', 'install', pluginSpec], context.workingDir);
          await interaction.reply({
            content: `Installed preset \`${spec}\` (${pluginSpec}).`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'install': {
          if (!spec || !spec.includes('@')) {
            await interaction.reply({
              content: 'Usage: /plugin action:install spec:<name@registry>',
              flags: this.ephemeralFlags()
            });
            return;
          }
          await this.execClaudePlugin(['plugin', 'install', spec], context.workingDir);
          await interaction.reply({
            content: `Installed plugin \`${spec}\`.`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        case 'remove':
        case 'rm':
        case 'uninstall': {
          if (!spec) {
            await interaction.reply({
              content: 'Usage: /plugin action:remove spec:<name>',
              flags: this.ephemeralFlags()
            });
            return;
          }
          await this.execClaudePlugin(['plugin', 'uninstall', spec], context.workingDir);
          await interaction.reply({
            content: `Removed plugin \`${spec}\`.`,
            flags: this.ephemeralFlags()
          });
          return;
        }
        default:
          await interaction.reply({ content: 'Unknown plugin action.', flags: this.ephemeralFlags() });
      }
    } catch (error) {
      await interaction.reply({
        content: `Plugin command failed: ${getErrorMessage(error)}`,
        flags: this.ephemeralFlags()
      });
    }
  }

  private getChannelContext(interaction: ChatInputCommandInteraction): ChannelContext {
    const channelId = interaction.channelId;
    const channel = interaction.channel;
    const channelName = channel && 'name' in channel ? channel.name : 'channel';
    const workingDir = this.getChannelWorkspace(channelId, channelName);
    return {
      channelId,
      channelKey: toSafeDiscordId(channelId),
      channelName,
      workingDir,
      repoId: `discord_${channelId}`
    };
  }

  private async execGit(args: string[], cwd: string): Promise<string> {
    const result = await execFileAsync('git', args, { cwd });
    return result.stdout?.toString() || '';
  }

  private async isGitRepo(cwd: string): Promise<boolean> {
    try {
      const output = await this.execGit(['rev-parse', '--is-inside-work-tree'], cwd);
      return output.trim() === 'true';
    } catch {
      return false;
    }
  }

  private async execClaudePlugin(args: string[], cwd: string): Promise<string> {
    const result = await execFileAsync('claude', args, { cwd });
    return result.stdout?.toString() || '';
  }

  private ephemeralFlags(): MessageFlags {
    return MessageFlags.Ephemeral;
  }
}
