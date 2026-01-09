import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';

const execAsync = promisify(exec);
import { Repository, RepositoryType, UserSession } from '../types';
import { logger } from '../utils/logger';
import { WORKSPACE_PATH } from '../config';
import { gitService } from './GitService';
import { UserConfigManager } from './UserConfigManager';
import { ClaudeSettingsManager } from './ClaudeSettingsManager';
import { PLUGIN_PRESETS } from '../presets';
import { ensureDefaultPluginMarketplaces } from './ClaudePluginMarketplace';
import { getErrorMessage } from '../utils/errors';

export class RepositoryManager {
  private userSessions: Map<number, UserSession> = new Map();
  private baseWorkspacePath: string;
  private userConfigManager: UserConfigManager | undefined;
  private claudeSettingsManager: ClaudeSettingsManager;

  constructor(baseWorkspacePath?: string, userConfigManager?: UserConfigManager) {
    this.baseWorkspacePath = baseWorkspacePath || WORKSPACE_PATH;
    this.userConfigManager = userConfigManager;
    this.claudeSettingsManager = new ClaudeSettingsManager();
  }

  async initialize(): Promise<void> {
    logger.info('Initializing RepositoryManager', { baseWorkspacePath: this.baseWorkspacePath });

    try {
      await fs.mkdir(this.baseWorkspacePath, { recursive: true });
      await this.discoverRepositories();

      if (this.userConfigManager) {
        await this.restoreCurrentRepositories();
      }

      // Install default plugins for all discovered repositories
      await this.installDefaultPluginsForAllRepos();

      logger.info('RepositoryManager initialized', {
        totalUsers: this.userSessions.size,
        totalRepos: this.getTotalRepositoryCount()
      });
    } catch (error) {
      logger.error('Failed to initialize RepositoryManager', {
        error: getErrorMessage(error)
      });
    }
  }

  /**
   * Install default plugins for all existing repositories at startup
   */
  private async installDefaultPluginsForAllRepos(): Promise<void> {
    const allRepoPaths = new Set<string>();

    for (const session of this.userSessions.values()) {
      for (const repo of session.repositories.values()) {
        allRepoPaths.add(repo.path);
      }
    }

    if (allRepoPaths.size === 0) return;

    logger.info('Installing default plugins for repositories', { count: allRepoPaths.size });

    for (const repoPath of allRepoPaths) {
      try {
        await this.installDefaultPlugins(repoPath);
      } catch (error) {
        logger.warn('Failed to install default plugins for repository', {
          repoPath,
          error: getErrorMessage(error)
        });
      }
    }
  }

  private async restoreCurrentRepositories(): Promise<void> {
    if (!this.userConfigManager) return;

    try {
      for (const userId of this.userConfigManager.getUserIds()) {
        const userConfig = await this.userConfigManager.getConfig(userId);

        if (userConfig.currentRepositoryId) {
          const session = this.getUserSession(userId);

          if (session.repositories.has(userConfig.currentRepositoryId)) {
            session.currentRepositoryId = userConfig.currentRepositoryId;
            logger.info('Restored current repository', { userId, repositoryId: userConfig.currentRepositoryId });
            continue;
          }
        }

        if (userConfig.currentRepositoryPath) {
          const session = this.getUserSession(userId);
          const repoId = this.findRepoIdByPath(userId, userConfig.currentRepositoryPath);
          if (repoId) {
            session.currentRepositoryId = repoId;
            await this.persistCurrentRepository(userId, repoId);
            logger.info('Restored current repository by path', {
              userId,
              repositoryId: repoId,
              repositoryPath: userConfig.currentRepositoryPath
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to restore current repositories', {
        error: getErrorMessage(error)
      });
    }
  }

  private async discoverRepositories(): Promise<void> {
    try {
      const entries = await fs.readdir(this.baseWorkspacePath, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('user_')) {
          const userId = parseInt(entry.name.replace('user_', ''));
          if (!isNaN(userId)) {
            await this.discoverUserRepositories(userId, path.join(this.baseWorkspacePath, entry.name));
          }
        }
      }

      logger.info('Repository discovery complete', {
        usersFound: this.userSessions.size,
        totalRepos: this.getTotalRepositoryCount()
      });
    } catch (error) {
      logger.warn('Error during repository discovery', {
        error: getErrorMessage(error)
      });
    }
  }

  private async discoverUserRepositories(userId: number, userDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(userDir, { withFileTypes: true });
      let reposFound = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const repoPath = path.join(userDir, entry.name);
        const gitPath = path.join(repoPath, '.git');

        try {
          await fs.access(gitPath);

          const gitUrl = await gitService.getRemoteUrl(repoPath) || undefined;

          if (await this.isRepositoryDeleted(userId, gitUrl, repoPath)) continue;

          const repoId = this.buildRepositoryId(repoPath, gitUrl);
          const session = this.getUserSession(userId);

          const repository: Repository = {
            id: repoId,
            name: entry.name,
            path: repoPath,
            type: RepositoryType.EXISTING,
            gitUrl,
            createdAt: new Date(),
            lastUsed: new Date()
          };

          session.repositories.set(repoId, repository);
          if (!session.currentRepositoryId) {
            session.currentRepositoryId = repoId;
          }

          reposFound++;
        } catch {
          // Not a git repository
        }
      }

      if (reposFound > 0) {
        logger.info('User repositories discovered', { userId, reposFound });
      }
    } catch (error) {
      logger.warn('Error discovering user repositories', {
        userId,
        error: getErrorMessage(error)
      });
    }
  }

  private getUserSession(userId: number): UserSession {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, { userId, repositories: new Map() });
    }
    return this.userSessions.get(userId)!;
  }

  async cloneRepository(userId: number, gitUrl: string, name?: string, branch?: string): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repoName = name || this.extractRepoNameFromUrl(gitUrl);
    const repoPath = path.join(this.baseWorkspacePath, `user_${userId}`, repoName);

    if (await this.isRepositoryDeleted(userId, gitUrl, repoPath)) {
      throw new Error('This repository was previously deleted. Use a different name.');
    }

    logger.info('Cloning repository', { userId, gitUrl, repoPath });

    try {
      await fs.mkdir(path.dirname(repoPath), { recursive: true });

      if (await this.directoryExists(repoPath)) {
        throw new Error(`Repository directory already exists: ${repoName}`);
      }

      await gitService.clone(gitUrl, repoPath, branch);

      const repoId = this.buildRepositoryId(repoPath, gitUrl);
      const repository: Repository = {
        id: repoId,
        name: repoName,
        path: repoPath,
        type: RepositoryType.CLONED,
        gitUrl,
        branch,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      session.repositories.set(repoId, repository);
      session.currentRepositoryId = repoId;

      await this.persistCurrentRepository(userId, repoId);
      await this.syncClaudeSettings(userId, repoPath, repoId);
      await this.installDefaultPlugins(repoPath);

      logger.info('Repository cloned', { repoId, repoName });
      return repository;
    } catch (error) {
      logger.error('Failed to clone repository', {
        userId,
        gitUrl,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async createRepository(userId: number, name: string, initGit: boolean = true): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repoPath = path.join(this.baseWorkspacePath, `user_${userId}`, name);

    if (await this.isRepositoryDeleted(userId, undefined, repoPath)) {
      throw new Error('A repository at this path was previously deleted. Use a different name.');
    }

    logger.info('Creating new repository', { userId, name, repoPath });

    try {
      await fs.mkdir(repoPath, { recursive: true });

      if (initGit) {
        await gitService.init(repoPath);
      }

      if (this.userConfigManager) {
        const userConfig = await this.userConfigManager.getConfig(userId);
        if (userConfig.claudeMdTemplate) {
          await fs.writeFile(path.join(repoPath, 'CLAUDE.md'), userConfig.claudeMdTemplate, 'utf-8');
        }
      }

      const repoId = this.buildRepositoryId(repoPath);
      const repository: Repository = {
        id: repoId,
        name,
        path: repoPath,
        type: RepositoryType.NEW,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      session.repositories.set(repoId, repository);
      session.currentRepositoryId = repoId;

      await this.persistCurrentRepository(userId, repoId);
      await this.syncClaudeSettings(userId, repoPath, repoId);
      await this.installDefaultPlugins(repoPath);

      logger.info('Repository created', { repoId, name });
      return repository;
    } catch (error) {
      logger.error('Failed to create repository', {
        userId,
        name,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  async addExistingRepository(userId: number, repoPath: string, name?: string): Promise<Repository> {
    const session = this.getUserSession(userId);

    if (!await this.directoryExists(repoPath)) {
      throw new Error(`Directory does not exist: ${repoPath}`);
    }

    const repoName = name || path.basename(repoPath);
    const isGitRepo = await this.directoryExists(path.join(repoPath, '.git'));
    const gitUrl = isGitRepo ? await gitService.getRemoteUrl(repoPath) || undefined : undefined;

    if (await this.isRepositoryDeleted(userId, gitUrl, repoPath)) {
      throw new Error('This repository was previously deleted.');
    }

    const repoId = this.buildRepositoryId(repoPath, gitUrl);
    const repository: Repository = {
      id: repoId,
      name: repoName,
      path: repoPath,
      type: RepositoryType.EXISTING,
      gitUrl,
      createdAt: new Date(),
      lastUsed: new Date()
    };

    session.repositories.set(repoId, repository);
    session.currentRepositoryId = repoId;

    await this.persistCurrentRepository(userId, repoId);
    await this.syncClaudeSettings(userId, repoPath, repoId);

    logger.info('Existing repository added', { repoId, repoName, repoPath });
    return repository;
  }

  async switchRepository(userId: number, repositoryId: string): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    session.currentRepositoryId = repositoryId;
    repository.lastUsed = new Date();

    await this.persistCurrentRepository(userId, repositoryId);
    await this.syncClaudeSettings(userId, repository.path, repositoryId);

    logger.info('Switched repository', { userId, repositoryId, name: repository.name });
    return repository;
  }

  getCurrentRepository(userId: number): Repository | undefined {
    const session = this.getUserSession(userId);
    return session.currentRepositoryId
      ? session.repositories.get(session.currentRepositoryId)
      : undefined;
  }

  async listRepositories(userId: number): Promise<Repository[]> {
    const session = this.getUserSession(userId);
    const activeRepos: Repository[] = [];

    for (const repo of session.repositories.values()) {
      if (!await this.isRepositoryDeleted(userId, repo.gitUrl, repo.path)) {
        activeRepos.push(repo);
      }
    }

    return activeRepos.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
  }

  async refreshRepository(userId: number, repositoryId: string): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    const [remoteUrl, branch] = await Promise.all([
      gitService.getRemoteUrl(repository.path),
      gitService.getCurrentBranch(repository.path)
    ]);

    if (remoteUrl) repository.gitUrl = remoteUrl;
    if (branch) repository.branch = branch;
    repository.lastUsed = new Date();

    return repository;
  }

  async deleteRepository(userId: number, repositoryId: string): Promise<void> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    if (this.userConfigManager) {
      try {
        const userConfig = await this.userConfigManager.getConfig(userId);
        const deletedRepos = userConfig.deletedRepositories || [];

        deletedRepos.push({
          gitUrl: repository.gitUrl,
          path: repository.path,
          deletedAt: new Date()
        });

        await this.userConfigManager.updateConfig(userId, { deletedRepositories: deletedRepos });
      } catch (error) {
        logger.warn('Failed to save deleted repository', {
          repositoryId,
          error: getErrorMessage(error)
        });
      }
    }

    if (repository.type !== RepositoryType.EXISTING) {
      try {
        await fs.rm(repository.path, { recursive: true, force: true });
      } catch (error) {
        logger.warn('Failed to delete directory', { repositoryId, error: getErrorMessage(error) });
      }
    }

    session.repositories.delete(repositoryId);

    if (session.currentRepositoryId === repositoryId) {
      session.currentRepositoryId = undefined;
    }

    logger.info('Repository deleted', { repositoryId, name: repository.name });
  }

  getRepository(userId: number, repositoryId: string): Repository | undefined {
    return this.getUserSession(userId).repositories.get(repositoryId);
  }

  async rescan(): Promise<{ usersFound: number; reposFound: number }> {
    const beforeCount = this.getTotalRepositoryCount();
    await this.discoverRepositories();
    const afterCount = this.getTotalRepositoryCount();

    return {
      usersFound: this.userSessions.size,
      reposFound: afterCount - beforeCount
    };
  }

  getStats(): { totalUsers: number; totalRepositories: number; repositoriesByType: Record<RepositoryType, number> } {
    let totalRepositories = 0;
    const repositoriesByType: Record<RepositoryType, number> = {
      [RepositoryType.CLONED]: 0,
      [RepositoryType.NEW]: 0,
      [RepositoryType.EXISTING]: 0
    };

    for (const session of this.userSessions.values()) {
      for (const repo of session.repositories.values()) {
        totalRepositories++;
        repositoriesByType[repo.type]++;
      }
    }

    return { totalUsers: this.userSessions.size, totalRepositories, repositoriesByType };
  }

  private async persistCurrentRepository(userId: number, repositoryId: string): Promise<void> {
    if (!this.userConfigManager) return;

    try {
      const session = this.userSessions.get(userId);
      const repository = session?.repositories.get(repositoryId);
      await this.userConfigManager.updateConfig(userId, {
        currentRepositoryId: repositoryId,
        currentRepositoryPath: repository?.path
      });
    } catch (error) {
      logger.warn('Failed to persist current repository', {
        userId,
        error: getErrorMessage(error)
      });
    }
  }

  async syncClaudeSettings(userId: number, repoPath: string, repoId?: string): Promise<void> {
    if (!this.userConfigManager) return;

    try {
      const userConfig = await this.userConfigManager.getConfig(userId);
      
      if (userConfig.techStack) {
        await this.claudeSettingsManager.syncToRepository(repoPath, userConfig.techStack);
      }
      
      const mcpConfigKey = repoId || this.findRepoIdByPath(userId, repoPath);
      if (mcpConfigKey && userConfig.mcpConfigs?.[mcpConfigKey]) {
        await this.claudeSettingsManager.syncMcpToRepository(repoPath, userConfig.mcpConfigs[mcpConfigKey]);
      }
    } catch (error) {
      logger.warn('Failed to sync Claude settings', {
        userId,
        repoPath,
        error: getErrorMessage(error)
      });
    }
  }

  private findRepoIdByPath(userId: number, repoPath: string): string | undefined {
    const session = this.userSessions.get(userId);
    if (!session) return undefined;
    
    for (const [id, repo] of session.repositories) {
      if (repo.path === repoPath) return id;
    }
    return undefined;
  }

  private buildRepositoryId(repoPath: string, gitUrl?: string): string {
    const normalizedPath = path.resolve(repoPath);
    const seed = `${gitUrl || 'local'}|${normalizedPath}`;
    return createHash('sha1').update(seed).digest('hex');
  }

  private async isRepositoryDeleted(userId: number, gitUrl?: string, repoPath?: string): Promise<boolean> {
    if (!this.userConfigManager) return false;

    try {
      const userConfig = await this.userConfigManager.getConfig(userId);
      const deletedRepos = userConfig.deletedRepositories || [];

      return deletedRepos.some((deleted) => {
        if (gitUrl && deleted.gitUrl) {
          const normalizedGitUrl = gitService.normalizeUrl(gitUrl);
          const normalizedDeletedUrl = gitService.normalizeUrl(deleted.gitUrl);
          if (normalizedGitUrl && normalizedDeletedUrl && normalizedGitUrl === normalizedDeletedUrl) {
            return true;
          }
        }
        return repoPath && deleted.path === repoPath;
      });
    } catch {
      return false;
    }
  }

  private extractRepoNameFromUrl(gitUrl: string): string {
    const match = gitUrl.match(/\/([^/]+?)(?:\.git)?$/);
    return match ? match[1] : 'repository';
  }

  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  private getTotalRepositoryCount(): number {
    let count = 0;
    for (const session of this.userSessions.values()) {
      count += session.repositories.size;
    }
    return count;
  }

  /**
   * Install default Claude plugins for a repository
   * Called automatically when a repository is created/cloned
   */
  async installDefaultPlugins(repoPath: string): Promise<void> {
    // Ensure default plugin marketplaces exist before trying to install presets
    ensureDefaultPluginMarketplaces(repoPath);

    const defaultPlugins = Object.entries(PLUGIN_PRESETS)
      .filter(([, preset]) => preset.isDefault)
      .map(([, preset]) => `${preset.name}@${preset.registry}`);

    // Install plugins in parallel for faster setup
    await Promise.all(defaultPlugins.map(async (pluginSpec) => {
      try {
        await execAsync(`claude plugin install ${pluginSpec}`, {
          cwd: repoPath,
          timeout: 60000,
        });
        logger.info('Default plugin installed', { pluginSpec, repoPath });
      } catch (error) {
        // Don't fail repo creation if plugin install fails
        logger.warn('Failed to install default plugin', {
          pluginSpec,
          repoPath,
          error: getErrorMessage(error)
        });
      }
    }));
  }
}
