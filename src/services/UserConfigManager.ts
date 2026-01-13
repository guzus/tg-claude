import { promises as fs } from 'fs';
import path from 'path';
import { UserConfig, GitHubAppConnection } from '../types';
import { logger } from '../utils/logger';
import { CONFIG_PATH } from '../config';
import { getErrorMessage } from '../utils/errors';

const DEFAULT_CLAUDE_MD = `# Guidelines for Claude

1. The codebase should be focused, clean, and easy to understand.

2. Purge unnecessary code and files.

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
    this.configPath = configPath || path.join(CONFIG_PATH, 'users');
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
        error: getErrorMessage(error)
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
        error: getErrorMessage(error)
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

      // Convert GitHubAppConnection date fields
      if (config.github) {
        config.github.accessTokenExpiresAt = new Date(config.github.accessTokenExpiresAt);
        config.github.connectedAt = new Date(config.github.connectedAt);
      }

      this.configs.set(userId, config);

      logger.debug('Loaded user config', { userId });
    } catch (error) {
      logger.debug('Failed to load user config', {
        userId,
        error: getErrorMessage(error)
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
        userName: 'tg-claude',
        userEmail: 'noreply@github.com',
        defaultBranch: 'main'
      },
      preferences: {
        notifyOnTaskComplete: true
      },
      techStack: {
        typescript: 'bun',
        python: 'uv'
      },
      aiProvider: {
        provider: 'anthropic'
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
    if (updates.aiProvider) {
      config.aiProvider = { ...config.aiProvider, ...updates.aiProvider };
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
    if (updates.currentRepositoryId !== undefined) {
      config.currentRepositoryId = updates.currentRepositoryId;
    }
    if (updates.currentRepositoryPath !== undefined) {
      config.currentRepositoryPath = updates.currentRepositoryPath;
    }
    if (updates.deletedRepositories !== undefined) {
      config.deletedRepositories = updates.deletedRepositories;
    }
    if (updates.enabledPlugins !== undefined) {
      config.enabledPlugins = updates.enabledPlugins;
    }
    if (updates.githubPat !== undefined) {
      config.githubPat = updates.githubPat;
    }
    if (updates.github !== undefined) {
      config.github = updates.github;
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
        error: getErrorMessage(error)
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
        error: getErrorMessage(error)
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

  // ==================== GitHub Credential Methods ====================

  /**
   * Set GitHub Personal Access Token for a user
   */
  async setGitHubPat(userId: number, pat: string): Promise<void> {
    await this.updateConfig(userId, { githubPat: pat });
    logger.info('Set GitHub PAT for user', { userId });
  }

  /**
   * Clear GitHub Personal Access Token for a user
   */
  async clearGitHubPat(userId: number): Promise<void> {
    const config = await this.getConfig(userId);
    delete config.githubPat;
    config.updatedAt = new Date();
    await this.saveConfig(config);
    logger.info('Cleared GitHub PAT for user', { userId });
  }

  /**
   * Set GitHub App connection for a user
   */
  async setGitHubConnection(userId: number, connection: GitHubAppConnection): Promise<void> {
    await this.updateConfig(userId, { github: connection });
    logger.info('Set GitHub App connection for user', { userId, login: connection.login });
  }

  /**
   * Update GitHub App access token (for token refresh)
   */
  async updateGitHubAccessToken(
    userId: number,
    accessToken: string,
    expiresAt: Date
  ): Promise<void> {
    const config = await this.getConfig(userId);
    if (config.github) {
      config.github.accessToken = accessToken;
      config.github.accessTokenExpiresAt = expiresAt;
      config.updatedAt = new Date();
      await this.saveConfig(config);
      logger.info('Updated GitHub access token for user', { userId });
    }
  }

  /**
   * Clear GitHub App connection for a user
   */
  async clearGitHubConnection(userId: number): Promise<void> {
    const config = await this.getConfig(userId);
    delete config.github;
    config.updatedAt = new Date();
    await this.saveConfig(config);
    logger.info('Cleared GitHub App connection for user', { userId });
  }

  /**
   * Get the best available GitHub token for a user
   * Priority: GitHub App token (if valid) > PAT
   * Returns null if no token available
   */
  async getGitHubToken(userId: number): Promise<string | null> {
    const config = await this.getConfig(userId);

    // Check GitHub App connection first (preferred)
    if (config.github?.accessToken) {
      // Check if token is still valid (with 5 min buffer)
      const bufferMs = 5 * 60 * 1000;
      const isExpired = new Date(config.github.accessTokenExpiresAt).getTime() < Date.now() + bufferMs;

      if (!isExpired) {
        return config.github.accessToken;
      }
      // Token expired - will need refresh (handled by GitHubAppService)
      logger.debug('GitHub App token expired, falling back to PAT', { userId });
    }

    // Fall back to PAT
    if (config.githubPat) {
      return config.githubPat;
    }

    return null;
  }

  /**
   * Check if user has any GitHub authentication configured
   */
  async hasGitHubAuth(userId: number): Promise<boolean> {
    const config = await this.getConfig(userId);
    return !!(config.github?.accessToken || config.githubPat);
  }

  /**
   * Get GitHub authentication status for a user
   */
  async getGitHubAuthStatus(userId: number): Promise<{
    hasAuth: boolean;
    method: 'app' | 'pat' | 'none';
    login?: string;
    expiresAt?: Date;
  }> {
    const config = await this.getConfig(userId);

    if (config.github?.accessToken) {
      return {
        hasAuth: true,
        method: 'app',
        login: config.github.login,
        expiresAt: config.github.accessTokenExpiresAt
      };
    }

    if (config.githubPat) {
      return {
        hasAuth: true,
        method: 'pat'
      };
    }

    return {
      hasAuth: false,
      method: 'none'
    };
  }
}
