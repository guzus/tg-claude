import type { McpServer } from '../types';

// MCP Server Presets - popular MCP servers that can be easily added
export const MCP_PRESETS: Record<string, { server: McpServer; description: string }> = {
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
  fetch: {
    server: { command: 'npx', args: ['-y', '@anthropic/mcp-fetch'] },
    description: 'HTTP fetch capabilities'
  }
};

// Claude Plugin Presets - official and community plugins
export interface PluginPreset {
  name: string;
  registry: string;
  description: string;
  isDefault?: boolean;
}

export const PLUGIN_PRESETS: Record<string, PluginPreset> = {
  'ralph-wiggum': {
    name: 'ralph-wiggum',
    registry: 'claude-plugins-official',
    description: 'Autonomous loop that keeps working until task completion',
    isDefault: true
  }
};


