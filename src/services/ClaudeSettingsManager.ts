import { promises as fs } from 'fs';
import path from 'path';
import { TechStackPreferences, McpConfig } from '../types';
import { logger } from '../utils/logger';

interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  settings?: {
    model?: string;
    customInstructions?: string;
  };
}

export class ClaudeSettingsManager {
  private generateInstructions(techStack: TechStackPreferences): string {
    const instructions: string[] = [];

    if (techStack.typescript) {
      const tool = techStack.typescript;
      instructions.push(`For TypeScript/JavaScript projects, use ${tool} as the package manager and runtime.`);
      
      if (tool === 'bun') {
        instructions.push('Use `bun install` for dependencies, `bun run` for scripts, `bun test` for testing.');
      } else if (tool === 'pnpm') {
        instructions.push('Use `pnpm install` for dependencies, `pnpm run` for scripts.');
      } else if (tool === 'yarn') {
        instructions.push('Use `yarn` for dependencies, `yarn run` for scripts.');
      } else {
        instructions.push('Use `npm install` for dependencies, `npm run` for scripts.');
      }
    }

    if (techStack.python) {
      const tool = techStack.python;
      instructions.push(`For Python projects, use ${tool} as the package manager.`);
      
      if (tool === 'uv') {
        instructions.push('Use `uv pip install` for dependencies, `uv run` for running scripts, `uv venv` for virtual environments.');
      } else if (tool === 'poetry') {
        instructions.push('Use `poetry install` for dependencies, `poetry run` for running scripts.');
      } else if (tool === 'pipenv') {
        instructions.push('Use `pipenv install` for dependencies, `pipenv run` for running scripts.');
      } else {
        instructions.push('Use `pip install` for dependencies.');
      }
    }

    return instructions.join('\n');
  }

  buildSettings(techStack: TechStackPreferences): ClaudeSettings {
    const customInstructions = this.generateInstructions(techStack);
    
    return {
      settings: {
        customInstructions: customInstructions || undefined
      }
    };
  }

  async syncToRepository(repoPath: string, techStack: TechStackPreferences): Promise<void> {
    const claudeDir = path.join(repoPath, '.claude');
    const settingsPath = path.join(claudeDir, 'settings.json');

    try {
      await fs.mkdir(claudeDir, { recursive: true });

      const settings = this.buildSettings(techStack);
      
      if (settings.settings?.customInstructions) {
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        logger.info('Synced Claude settings to repository', { repoPath });
      }
    } catch (error) {
      logger.error('Failed to sync Claude settings', {
        repoPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async readFromRepository(repoPath: string): Promise<ClaudeSettings | null> {
    const settingsPath = path.join(repoPath, '.claude', 'settings.json');

    try {
      const data = await fs.readFile(settingsPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async existsInRepository(repoPath: string): Promise<boolean> {
    const settingsPath = path.join(repoPath, '.claude', 'settings.json');

    try {
      await fs.access(settingsPath);
      return true;
    } catch {
      return false;
    }
  }

  async syncMcpToRepository(repoPath: string, mcpConfig: McpConfig | undefined): Promise<void> {
    const mcpPath = path.join(repoPath, '.mcp.json');

    try {
      if (!mcpConfig || Object.keys(mcpConfig.mcpServers).length === 0) {
        await fs.unlink(mcpPath).catch(() => {});
        return;
      }

      await fs.writeFile(mcpPath, JSON.stringify(mcpConfig, null, 2), 'utf-8');
      logger.info('Synced MCP config to repository', { repoPath, serverCount: Object.keys(mcpConfig.mcpServers).length });
    } catch (error) {
      logger.error('Failed to sync MCP config', {
        repoPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async readMcpFromRepository(repoPath: string): Promise<McpConfig | null> {
    const mcpPath = path.join(repoPath, '.mcp.json');

    try {
      const data = await fs.readFile(mcpPath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
}
