import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UserConfigManager } from '../services/UserConfigManager';
import { mcpManager } from '../services/MCPManager';
import { MCPServerConfig, MCP_SERVER_TEMPLATES, UserMCPConfig } from '../types';
import { logger } from '../utils/logger';

/**
 * Handlers for MCP (Model Context Protocol) server management commands
 */
export class MCPHandlers extends BaseHandler {
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
   * /mcp command - Manage MCP servers
   */
  async handleMCP(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    if (!subcommand) {
      await this.showMCPMenu(msg);
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'list':
          await this.listServers(msg);
          break;

        case 'templates':
          await this.listTemplates(msg);
          break;

        case 'add':
          await this.addServer(msg, args.slice(1));
          break;

        case 'remove':
        case 'rm':
          await this.removeServer(msg, args.slice(1));
          break;

        case 'enable':
          await this.setServerEnabled(msg, args[1], true);
          break;

        case 'disable':
          await this.setServerEnabled(msg, args[1], false);
          break;

        case 'env':
          await this.setEnvVar(msg, args.slice(1));
          break;

        case 'reset':
          await this.resetMCPConfig(msg);
          break;

        case 'show':
          await this.showMCPConfig(msg);
          break;

        default:
          await this.bot.sendMessage(
            chatId,
            `Unknown subcommand: ${subcommand}\nUse /mcp to see available commands.`
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `Error: ${errorMessage}`);
      logger.error('MCP command failed', {
        userId,
        subcommand,
        error: errorMessage
      });
    }
  }

  /**
   * Show MCP menu with available commands
   */
  private async showMCPMenu(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    // Get current MCP config
    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();
    const enabledCount = mcpConfig.servers.filter(s => s.enabled).length;

    const message =
      `*MCP Server Management*\n\n` +
      `MCP (Model Context Protocol) servers extend Claude's capabilities.\n\n` +
      `*Current Status:*\n` +
      `Servers configured: ${mcpConfig.servers.length}\n` +
      `Servers enabled: ${enabledCount}\n\n` +
      `*Commands:*\n` +
      `/mcp list - View configured servers\n` +
      `/mcp templates - View available templates\n` +
      `/mcp add <template> - Add server from template\n` +
      `/mcp add http <name> <url> - Add HTTP server\n` +
      `/mcp add stdio <name> <cmd> - Add stdio server\n` +
      `/mcp remove <name> - Remove a server\n` +
      `/mcp enable <name> - Enable a server\n` +
      `/mcp disable <name> - Disable a server\n` +
      `/mcp env <KEY> <value> - Set environment variable\n` +
      `/mcp show - Show full configuration\n` +
      `/mcp reset - Reset to defaults\n\n` +
      `*Examples:*\n` +
      `\`/mcp add github\` - Add GitHub MCP server\n` +
      `\`/mcp add http notion https://mcp.notion.com\`\n` +
      `\`/mcp env GITHUB_TOKEN ghp_xxx\``;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'View Servers', callback_data: 'mcp_list' },
            { text: 'Templates', callback_data: 'mcp_templates' }
          ],
          [
            { text: 'Quick Add GitHub', callback_data: 'mcp_add_github' },
            { text: 'Quick Add Fetch', callback_data: 'mcp_add_fetch' }
          ],
          [
            { text: 'Show Config', callback_data: 'mcp_show' },
            { text: 'Reset', callback_data: 'mcp_reset_confirm' }
          ],
          [
            { text: 'Back to Main Menu', callback_data: 'main_menu' }
          ]
        ]
      }
    });
  }

  /**
   * List configured MCP servers
   */
  private async listServers(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    if (mcpConfig.servers.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `*No MCP servers configured*\n\n` +
        `Use \`/mcp templates\` to see available templates.\n` +
        `Use \`/mcp add <template>\` to add a server.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let message = `*Configured MCP Servers*\n\n`;

    for (const server of mcpConfig.servers) {
      const status = server.enabled ? 'Enabled' : 'Disabled';
      message += `*${server.name}*\n`;
      message += `  Status: ${status}\n`;
      message += `  Transport: ${server.transport}\n`;
      if (server.url) message += `  URL: \`${server.url}\`\n`;
      if (server.command) message += `  Command: \`${server.command}\`\n`;
      if (server.description) message += `  _${server.description}_\n`;
      message += `\n`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * List available MCP server templates
   */
  private async listTemplates(msg: Message): Promise<void> {
    const chatId = msg.chat.id;

    const templates = mcpManager.getAvailableTemplates();

    let message = `*Available MCP Server Templates*\n\n`;

    for (const template of templates) {
      const templateInfo = MCP_SERVER_TEMPLATES[template.name];
      message += `*${template.name}*\n`;
      message += `  ${template.description}\n`;
      message += `  Transport: ${templateInfo.transport}\n`;
      if (templateInfo.env) {
        const envKeys = Object.keys(templateInfo.env);
        message += `  Required: ${envKeys.join(', ')}\n`;
      }
      message += `\n`;
    }

    message += `_Use \`/mcp add <template-name>\` to add a server_`;

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Add a new MCP server
   */
  private async addServer(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(
        chatId,
        `*Usage:*\n` +
        `/mcp add <template> - Add from template\n` +
        `/mcp add http <name> <url> - Add HTTP server\n` +
        `/mcp add stdio <name> <command> [args...] - Add stdio server\n\n` +
        `_Use \`/mcp templates\` to see available templates_`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let newServer: MCPServerConfig | null = null;

    // Check if first arg is a template name
    if (MCP_SERVER_TEMPLATES[args[0]]) {
      newServer = mcpManager.createFromTemplate(args[0]);
    }
    // Check if it's a transport type
    else if (args[0] === 'http' || args[0] === 'sse') {
      if (args.length < 3) {
        await this.bot.sendMessage(chatId, `Usage: /mcp add ${args[0]} <name> <url>`);
        return;
      }
      newServer = mcpManager.createHttpServer(args[1], args[2]);
    }
    else if (args[0] === 'stdio') {
      if (args.length < 3) {
        await this.bot.sendMessage(chatId, `Usage: /mcp add stdio <name> <command> [args...]`);
        return;
      }
      newServer = mcpManager.createStdioServer(args[1], args[2], {
        args: args.slice(3)
      });
    }
    else {
      await this.bot.sendMessage(
        chatId,
        `Unknown template or transport: ${args[0]}\n\n` +
        `Use \`/mcp templates\` to see available templates.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (!newServer) {
      await this.bot.sendMessage(chatId, `Failed to create server configuration`);
      return;
    }

    // Validate server config
    const validation = mcpManager.validateServerConfig(newServer);
    if (!validation.valid) {
      await this.bot.sendMessage(
        chatId,
        `Invalid server configuration:\n${validation.errors.join('\n')}`
      );
      return;
    }

    // Get current config and add server
    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    // Check if server with same name exists
    const existingIndex = mcpConfig.servers.findIndex(s => s.name === newServer!.name);
    if (existingIndex >= 0) {
      mcpConfig.servers[existingIndex] = newServer;
    } else {
      mcpConfig.servers.push(newServer);
    }

    // Save updated config
    await this.userConfigManager?.updateConfig(userId, { mcp: mcpConfig });

    await this.bot.sendMessage(
      chatId,
      `MCP server added!\n\n` +
      `*${newServer.name}*\n` +
      `Transport: ${newServer.transport}\n` +
      `Status: ${newServer.enabled ? 'Enabled' : 'Disabled'}\n\n` +
      `_The server will be available in your next task._`,
      { parse_mode: 'Markdown' }
    );

    logger.info('MCP server added', {
      userId,
      serverName: newServer.name,
      transport: newServer.transport
    });
  }

  /**
   * Remove an MCP server
   */
  private async removeServer(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, `Usage: /mcp remove <server-name>`);
      return;
    }

    const serverName = args[0];

    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    const serverIndex = mcpConfig.servers.findIndex(s => s.name === serverName);
    if (serverIndex < 0) {
      await this.bot.sendMessage(chatId, `Server not found: ${serverName}`);
      return;
    }

    mcpConfig.servers.splice(serverIndex, 1);
    await this.userConfigManager?.updateConfig(userId, { mcp: mcpConfig });

    await this.bot.sendMessage(chatId, `MCP server "${serverName}" removed.`);

    logger.info('MCP server removed', { userId, serverName });
  }

  /**
   * Enable or disable an MCP server
   */
  private async setServerEnabled(msg: Message, serverName: string | undefined, enabled: boolean): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!serverName) {
      await this.bot.sendMessage(chatId, `Usage: /mcp ${enabled ? 'enable' : 'disable'} <server-name>`);
      return;
    }

    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    const server = mcpConfig.servers.find(s => s.name === serverName);
    if (!server) {
      await this.bot.sendMessage(chatId, `Server not found: ${serverName}`);
      return;
    }

    server.enabled = enabled;
    await this.userConfigManager?.updateConfig(userId, { mcp: mcpConfig });

    await this.bot.sendMessage(
      chatId,
      `MCP server "${serverName}" ${enabled ? 'enabled' : 'disabled'}.`
    );

    logger.info('MCP server status changed', { userId, serverName, enabled });
  }

  /**
   * Set an environment variable for MCP servers
   */
  private async setEnvVar(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length < 2) {
      await this.bot.sendMessage(
        chatId,
        `*Usage:* /mcp env <KEY> <value>\n\n` +
        `Example:\n` +
        `\`/mcp env GITHUB_TOKEN ghp_xxxx\`\n` +
        `\`/mcp env DATABASE_URL postgres://...\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const key = args[0];
    const value = args.slice(1).join(' ');

    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    if (!mcpConfig.customEnv) {
      mcpConfig.customEnv = {};
    }

    mcpConfig.customEnv[key] = value;
    await this.userConfigManager?.updateConfig(userId, { mcp: mcpConfig });

    // Mask the value for display
    const maskedValue = value.length > 8
      ? value.substring(0, 4) + '****' + value.substring(value.length - 4)
      : '****';

    await this.bot.sendMessage(
      chatId,
      `Environment variable set:\n\`${key}\` = \`${maskedValue}\``,
      { parse_mode: 'Markdown' }
    );

    logger.info('MCP env var set', { userId, key });
  }

  /**
   * Reset MCP configuration to defaults
   */
  private async resetMCPConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const emptyConfig = mcpManager.createEmptyConfig();
    await this.userConfigManager?.updateConfig(userId, { mcp: emptyConfig });

    await this.bot.sendMessage(
      chatId,
      `MCP configuration reset.\nAll servers and environment variables have been removed.`
    );

    logger.info('MCP config reset', { userId });
  }

  /**
   * Show full MCP configuration (JSON format)
   */
  private async showMCPConfig(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const config = await this.userConfigManager?.getConfig(userId);
    const mcpConfig = config?.mcp || mcpManager.createEmptyConfig();

    // Mask sensitive env vars
    const safeConfig = { ...mcpConfig };
    if (safeConfig.customEnv) {
      safeConfig.customEnv = Object.fromEntries(
        Object.entries(safeConfig.customEnv).map(([k]) => [k, '****'])
      );
    }

    // Also mask env vars in servers
    safeConfig.servers = safeConfig.servers.map(s => ({
      ...s,
      env: s.env ? Object.fromEntries(Object.entries(s.env).map(([k, val]) => [k, val.includes('${') ? val : '****'])) : undefined
    }));

    const configJson = JSON.stringify(safeConfig, null, 2);

    await this.bot.sendMessage(
      chatId,
      `*MCP Configuration:*\n\`\`\`json\n${configJson}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * Get user's MCP config for task execution
   */
  async getUserMCPConfig(userId: number): Promise<UserMCPConfig | undefined> {
    const config = await this.userConfigManager?.getConfig(userId);
    return config?.mcp;
  }
}

export default MCPHandlers;
