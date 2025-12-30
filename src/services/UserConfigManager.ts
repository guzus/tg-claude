import { promises as fs } from 'fs';
import path from 'path';
import { UserConfig } from '../types';
import { logger } from '../utils/logger';

const DEFAULT_CLAUDE_MD = `# Guidelines for Claude

1. The codebase should be focused, clean, and easy to understand.

2. DO NOT create a new document. Purge unnecessary code and files.

3. Only use UV to install dependencies and run the python application.

4. Single Source of Truth: DO NOT place many variables in .env file. Place them in the code instead.

5. Run and Debug yourself PROACTIVELY.
`;

/**
 * Manages per-user configuration files
 */
export class UserConfigManager {
  private configPath: string;
  private configs: Map<number, UserConfig> = new Map();

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), 'config', 'users');
  }

  /**
   * Initialize the config manager
   */
  async initialize(): Promise<void> {
    try {
      // Create config directory if it doesn't exist
      await fs.mkdir(this.configPath, { recursive: true });

      // Load existing configs
      await this.loadAllConfigs();

      logger.info('UserConfigManager initialized', {
        configPath: this.configPath,
        loadedConfigs: this.configs.size
      });
    } catch (error) {
      logger.error('Failed to initialize UserConfigManager', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Load all user configs from disk
   */
  private async loadAllConfigs(): Promise<void> {
    try {
      const files = await fs.readdir(this.configPath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = parseInt(file.replace('user_', '').replace('.json', ''));
          if (!isNaN(userId)) {
            await this.loadConfig(userId);
          }
        }
      }
    } catch (error) {
      // Directory might not exist yet
      logger.debug('No existing configs found', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Load config for a specific user
   */
  private async loadConfig(userId: number): Promise<void> {
    try {
      const filePath = this.getConfigFilePath(userId);
      const data = await fs.readFile(filePath, 'utf-8');
      const config = JSON.parse(data);

      // Convert date strings back to Date objects
      config.createdAt = new Date(config.createdAt);
      config.updatedAt = new Date(config.updatedAt);

      this.configs.set(userId, config);

      logger.debug('Loaded user config', { userId });
    } catch (error) {
      logger.debug('Failed to load user config', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get config file path for a user
   */
  private getConfigFilePath(userId: number): string {
    return path.join(this.configPath, `user_${userId}.json`);
  }

  /**
   * Get config for a user (creates default if doesn't exist)
   */
  async getConfig(userId: number): Promise<UserConfig> {
    let config = this.configs.get(userId);

    if (!config) {
      config = this.createDefaultConfig(userId);
      await this.saveConfig(config);
    }

    return config;
  }

  private createDefaultConfig(userId: number): UserConfig {
    const now = new Date();
    return {
      userId,
      git: {
        userName: 'Claude Telegram Bot',
        userEmail: 'bot@claude-telegram.local',
        defaultBranch: 'main'
      },
      preferences: {
        autoCommit: false,
        autoPush: false,
        notifyOnTaskComplete: true,
        dangerModeEnabled: false
      },
      techStack: {
        typescript: 'bun',
        python: 'uv'
      },
      claudeMdTemplate: DEFAULT_CLAUDE_MD,
      limits: {
        maxConcurrentTasks: 3,
        taskTimeoutMs: 1800000
      },
      createdAt: now,
      updatedAt: now
    };
  }

  async updateConfig(userId: number, updates: Partial<UserConfig>): Promise<UserConfig> {
    const config = await this.getConfig(userId);

    if (updates.git) {
      config.git = { ...config.git, ...updates.git };
    }
    if (updates.preferences) {
      config.preferences = { ...config.preferences, ...updates.preferences };
    }
    if (updates.techStack) {
      config.techStack = { ...config.techStack, ...updates.techStack };
    }
    if (updates.claudeMdTemplate !== undefined) {
      config.claudeMdTemplate = updates.claudeMdTemplate;
    }
    if (updates.mcpConfigs !== undefined) {
      config.mcpConfigs = updates.mcpConfigs;
    }
    if (updates.limits) {
      config.limits = { ...config.limits, ...updates.limits };
    }

    config.updatedAt = new Date();

    await this.saveConfig(config);

    logger.info('Updated user config', { userId });

    return config;
  }

  /**
   * Save config to disk
   */
  private async saveConfig(config: UserConfig): Promise<void> {
    try {
      const filePath = this.getConfigFilePath(config.userId);
      await fs.writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');

      this.configs.set(config.userId, config);

      logger.debug('Saved user config', { userId: config.userId });
    } catch (error) {
      logger.error('Failed to save user config', {
        userId: config.userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Delete user config
   */
  async deleteConfig(userId: number): Promise<void> {
    try {
      const filePath = this.getConfigFilePath(userId);
      await fs.unlink(filePath);

      this.configs.delete(userId);

      logger.info('Deleted user config', { userId });
    } catch (error) {
      logger.error('Failed to delete user config', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Reset user config to defaults
   */
  async resetConfig(userId: number): Promise<UserConfig> {
    const config = this.createDefaultConfig(userId);
    await this.saveConfig(config);

    logger.info('Reset user config to defaults', { userId });

    return config;
  }

  /**
   * Get all user IDs with configs
   */
  getUserIds(): number[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Check if user has a config
   */
  hasConfig(userId: number): boolean {
    return this.configs.has(userId);
  }
}

export default UserConfigManager;
