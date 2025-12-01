import * as fs from 'fs';
import * as path from 'path';
import { MCPServerConfig, UserMCPConfig, MCP_SERVER_TEMPLATES } from '../types';
import { logger } from '../utils/logger';

/**
 * MCPManager - Manages MCP server configurations for Claude Code sessions
 *
 * This service handles:
 * - Writing .mcp.json configuration files to working directories
 * - Expanding environment variables in MCP configs
 * - Providing MCP server templates for easy setup
 */
export class MCPManager {
  /**
   * Expand environment variables in a string
   * Supports ${VAR} and ${VAR:-default} syntax
   */
  private expandEnvVars(value: string, customEnv?: Record<string, string>): string {
    return value.replace(/\$\{([^}]+)\}/g, (_match, expr) => {
      const [varName, defaultValue] = expr.split(':-');
      // Check custom env first, then process.env
      return customEnv?.[varName] || process.env[varName] || defaultValue || '';
    });
  }

  /**
   * Expand all environment variables in an MCP server config
   */
  private expandServerConfig(
    server: MCPServerConfig,
    customEnv?: Record<string, string>
  ): MCPServerConfig {
    const expanded = { ...server };

    if (expanded.url) {
      expanded.url = this.expandEnvVars(expanded.url, customEnv);
    }

    if (expanded.command) {
      expanded.command = this.expandEnvVars(expanded.command, customEnv);
    }

    if (expanded.args) {
      expanded.args = expanded.args.map(arg => this.expandEnvVars(arg, customEnv));
    }

    if (expanded.env) {
      expanded.env = Object.fromEntries(
        Object.entries(expanded.env).map(([key, value]) => [
          key,
          this.expandEnvVars(value, customEnv)
        ])
      );
    }

    return expanded;
  }

  /**
   * Build .mcp.json content from MCP configuration
   */
  buildMCPJsonContent(mcpConfig: UserMCPConfig): object {
    const mcpServers: Record<string, object> = {};

    for (const server of mcpConfig.servers) {
      if (!server.enabled) continue;

      const expanded = this.expandServerConfig(server, mcpConfig.customEnv);

      if (expanded.transport === 'http' || expanded.transport === 'sse') {
        mcpServers[expanded.name] = {
          url: expanded.url,
          ...(expanded.env && Object.keys(expanded.env).length > 0 && { env: expanded.env })
        };
      } else if (expanded.transport === 'stdio') {
        mcpServers[expanded.name] = {
          command: expanded.command,
          ...(expanded.args && expanded.args.length > 0 && { args: expanded.args }),
          ...(expanded.env && Object.keys(expanded.env).length > 0 && { env: expanded.env })
        };
      }
    }

    return { mcpServers };
  }

  /**
   * Write .mcp.json to a working directory
   */
  async writeMCPConfig(workingDir: string, mcpConfig: UserMCPConfig): Promise<string> {
    const mcpJsonPath = path.join(workingDir, '.mcp.json');
    const content = this.buildMCPJsonContent(mcpConfig);

    try {
      fs.writeFileSync(mcpJsonPath, JSON.stringify(content, null, 2));
      logger.info('Wrote MCP configuration', {
        path: mcpJsonPath,
        serverCount: mcpConfig.servers.filter(s => s.enabled).length
      });
      return mcpJsonPath;
    } catch (error) {
      logger.error('Failed to write MCP configuration', {
        path: mcpJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Remove .mcp.json from a working directory
   */
  async removeMCPConfig(workingDir: string): Promise<void> {
    const mcpJsonPath = path.join(workingDir, '.mcp.json');

    try {
      if (fs.existsSync(mcpJsonPath)) {
        fs.unlinkSync(mcpJsonPath);
        logger.info('Removed MCP configuration', { path: mcpJsonPath });
      }
    } catch (error) {
      logger.warn('Failed to remove MCP configuration', {
        path: mcpJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Read existing .mcp.json from a working directory
   */
  async readMCPConfig(workingDir: string): Promise<object | null> {
    const mcpJsonPath = path.join(workingDir, '.mcp.json');

    try {
      if (fs.existsSync(mcpJsonPath)) {
        const content = fs.readFileSync(mcpJsonPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      logger.warn('Failed to read MCP configuration', {
        path: mcpJsonPath,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return null;
  }

  /**
   * Create an MCP server config from a template
   */
  createFromTemplate(
    templateName: string,
    options?: { name?: string; enabled?: boolean }
  ): MCPServerConfig | null {
    const template = MCP_SERVER_TEMPLATES[templateName];
    if (!template) {
      return null;
    }

    return {
      name: options?.name || templateName,
      enabled: options?.enabled ?? true,
      ...template
    };
  }

  /**
   * Create a custom HTTP MCP server config
   */
  createHttpServer(name: string, url: string, options?: {
    env?: Record<string, string>;
    description?: string;
  }): MCPServerConfig {
    return {
      name,
      transport: 'http',
      url,
      env: options?.env,
      description: options?.description,
      enabled: true
    };
  }

  /**
   * Create a custom stdio MCP server config
   */
  createStdioServer(name: string, command: string, options?: {
    args?: string[];
    env?: Record<string, string>;
    description?: string;
  }): MCPServerConfig {
    return {
      name,
      transport: 'stdio',
      command,
      args: options?.args,
      env: options?.env,
      description: options?.description,
      enabled: true
    };
  }

  /**
   * Get list of available templates
   */
  getAvailableTemplates(): Array<{ name: string; description: string }> {
    return Object.entries(MCP_SERVER_TEMPLATES).map(([name, template]) => ({
      name,
      description: template.description || `${name} MCP server`
    }));
  }

  /**
   * Validate MCP server configuration
   */
  validateServerConfig(server: MCPServerConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!server.name || server.name.trim() === '') {
      errors.push('Server name is required');
    }

    if (!['http', 'stdio', 'sse'].includes(server.transport)) {
      errors.push(`Invalid transport: ${server.transport}`);
    }

    if (server.transport === 'http' || server.transport === 'sse') {
      if (!server.url) {
        errors.push(`URL is required for ${server.transport} transport`);
      }
    }

    if (server.transport === 'stdio') {
      if (!server.command) {
        errors.push('Command is required for stdio transport');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Merge MCP configurations (new config takes precedence)
   */
  mergeConfigs(base: UserMCPConfig, override: UserMCPConfig): UserMCPConfig {
    const serverMap = new Map<string, MCPServerConfig>();

    // Add base servers
    for (const server of base.servers) {
      serverMap.set(server.name, server);
    }

    // Override with new servers
    for (const server of override.servers) {
      serverMap.set(server.name, server);
    }

    return {
      servers: Array.from(serverMap.values()),
      activePreset: override.activePreset || base.activePreset,
      customEnv: { ...base.customEnv, ...override.customEnv }
    };
  }

  /**
   * Create empty MCP configuration
   */
  createEmptyConfig(): UserMCPConfig {
    return {
      servers: [],
      customEnv: {}
    };
  }

  /**
   * Create a default MCP configuration with common servers
   */
  createDefaultConfig(): UserMCPConfig {
    return {
      servers: [
        this.createFromTemplate('fetch')!,
        this.createFromTemplate('memory')!
      ],
      customEnv: {}
    };
  }
}

export const mcpManager = new MCPManager();
export default MCPManager;
