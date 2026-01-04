import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Repository, RepositoryType, UserSession } from '../types';
import { logger } from '../utils/logger';
import { WORKSPACE_PATH } from '../config';
import { gitService } from './GitService';
import { UserConfigManager } from './UserConfigManager';
import { ClaudeSettingsManager } from './ClaudeSettingsManager';

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

      logger.info('RepositoryManager initialized', {
        totalUsers: this.userSessions.size,
        totalRepos: this.getTotalRepositoryCount()
      });
    } catch (error) {
      logger.error('Failed to initialize RepositoryManager', {
        error: error instanceof Error ? error.message : String(error)
      });
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
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to restore current repositories', {
        error: error instanceof Error ? error.message : String(error)
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
        error: error instanceof Error ? error.message : String(error)
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

          const repoId = uuidv4();
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
        error: error instanceof Error ? error.message : String(error)
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
    const repoId = uuidv4();
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

      logger.info('Repository cloned', { repoId, repoName });
      return repository;
    } catch (error) {
      logger.error('Failed to clone repository', {
        userId,
        gitUrl,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async createRepository(userId: number, name: string, initGit: boolean = true): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repoId = uuidv4();
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

      logger.info('Repository created', { repoId, name });
      return repository;
    } catch (error) {
      logger.error('Failed to create repository', {
        userId,
        name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async addExistingRepository(userId: number, repoPath: string, name?: string): Promise<Repository> {
    const session = this.getUserSession(userId);

    if (!await this.directoryExists(repoPath)) {
      throw new Error(`Directory does not exist: ${repoPath}`);
    }

    const repoId = uuidv4();
    const repoName = name || path.basename(repoPath);
    const isGitRepo = await this.directoryExists(path.join(repoPath, '.git'));
    const gitUrl = isGitRepo ? await gitService.getRemoteUrl(repoPath) || undefined : undefined;

    if (await this.isRepositoryDeleted(userId, gitUrl, repoPath)) {
      throw new Error('This repository was previously deleted.');
    }

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
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (repository.type !== RepositoryType.EXISTING) {
      try {
        await fs.rm(repository.path, { recursive: true, force: true });
      } catch (error) {
        logger.warn('Failed to delete directory', { repositoryId, error: error instanceof Error ? error.message : String(error) });
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
      await this.userConfigManager.updateConfig(userId, { currentRepositoryId: repositoryId });
    } catch (error) {
      logger.warn('Failed to persist current repository', {
        userId,
        error: error instanceof Error ? error.message : String(error)
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
        error: error instanceof Error ? error.message : String(error)
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
}
