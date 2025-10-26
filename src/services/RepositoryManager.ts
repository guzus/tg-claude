import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Repository, RepositoryType, UserSession } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';
import { UserConfigManager } from './UserConfigManager';

export class RepositoryManager {
  private userSessions: Map<number, UserSession> = new Map();
  private baseWorkspacePath: string;
  private githubToken: string | undefined;
  private userConfigManager: UserConfigManager | undefined;

  constructor(baseWorkspacePath?: string, userConfigManager?: UserConfigManager) {
    this.baseWorkspacePath = baseWorkspacePath || config.workspacePath;
    this.githubToken = process.env.GITHUB_TOKEN;
    this.userConfigManager = userConfigManager;

    if (this.githubToken) {
      logger.info('GitHub token found - will use for git operations', {
        tokenLength: this.githubToken.length,
        tokenPrefix: this.githubToken.substring(0, 4)
      });
    } else {
      logger.warn('GITHUB_TOKEN not set - git operations may require manual authentication');
    }
  }

  /**
   * Inject GitHub token into git URL for authentication
   */
  private injectTokenIntoUrl(gitUrl: string): string {
    if (!this.githubToken) {
      logger.debug('No GitHub token available, using original URL');
      return gitUrl;
    }

    // Only modify GitHub URLs
    if (!gitUrl.includes('github.com')) {
      logger.debug('Not a GitHub URL, skipping token injection', { gitUrl });
      return gitUrl;
    }

    try {
      // Clean up URL - remove trailing slashes and ensure .git suffix is consistent
      gitUrl = gitUrl.trim().replace(/\/+$/, ''); // Remove trailing slashes

      // Convert SSH to HTTPS if needed
      if (gitUrl.startsWith('git@github.com:')) {
        gitUrl = gitUrl.replace('git@github.com:', 'https://github.com/');
        logger.debug('Converted SSH URL to HTTPS', { gitUrl });
      }

      // Ensure .git suffix for consistency
      if (!gitUrl.endsWith('.git')) {
        gitUrl = gitUrl + '.git';
      }

      // If it's already HTTPS, inject the token
      if (gitUrl.startsWith('https://github.com/') || gitUrl.startsWith('https://www.github.com/')) {
        // GitHub expects: https://x-access-token:TOKEN@github.com/...
        // Or simply: https://TOKEN@github.com/...
        // Using x-access-token format which is the recommended approach
        const authenticatedUrl = gitUrl.replace(
          /^https:\/\/(www\.)?github\.com\//,
          `https://x-access-token:${this.githubToken}@github.com/`
        );
        logger.info('Injected token into URL', {
          hasToken: authenticatedUrl.includes('@github.com'),
          originalUrlLength: gitUrl.length,
          endsWithGit: authenticatedUrl.endsWith('.git')
        });
        return authenticatedUrl;
      }

      logger.warn('URL format not recognized for token injection', { gitUrl });
      return gitUrl;
    } catch (error) {
      logger.error('Failed to inject token into URL', {
        error: error instanceof Error ? error.message : String(error)
      });
      return gitUrl;
    }
  }

  /**
   * Initialize and discover existing repositories
   */
  async initialize(): Promise<void> {
    logger.info('Initializing RepositoryManager', { baseWorkspacePath: this.baseWorkspacePath });

    try {
      // Create base workspace if it doesn't exist
      const fs = require('fs').promises;
      await fs.mkdir(this.baseWorkspacePath, { recursive: true });

      // Scan for existing repositories
      await this.discoverRepositories();

      // Restore currentRepositoryId from UserConfig for all users
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

  /**
   * Restore current repository IDs from UserConfig
   */
  private async restoreCurrentRepositories(): Promise<void> {
    if (!this.userConfigManager) return;

    try {
      const userIds = this.userConfigManager.getUserIds();

      for (const userId of userIds) {
        const userConfig = await this.userConfigManager.getConfig(userId);

        if (userConfig.currentRepositoryId) {
          const session = this.getUserSession(userId);

          // Check if the repository exists in the session
          if (session.repositories.has(userConfig.currentRepositoryId)) {
            session.currentRepositoryId = userConfig.currentRepositoryId;
            logger.info('Restored current repository from config', {
              userId,
              repositoryId: userConfig.currentRepositoryId
            });
          } else {
            logger.debug('Current repository not found in session', {
              userId,
              repositoryId: userConfig.currentRepositoryId
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to restore current repositories', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Discover existing repositories in workspace
   */
  private async discoverRepositories(): Promise<void> {
    try {
      const fs = require('fs').promises;
      const path = require('path');

      // Read base workspace directory
      const entries = await fs.readdir(this.baseWorkspacePath, { withFileTypes: true });

      for (const entry of entries) {
        // Look for user directories (format: user_<userId>)
        if (entry.isDirectory() && entry.name.startsWith('user_')) {
          const userId = parseInt(entry.name.replace('user_', ''));
          if (isNaN(userId)) continue;

          const userDir = path.join(this.baseWorkspacePath, entry.name);
          await this.discoverUserRepositories(userId, userDir);
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

  /**
   * Discover repositories for a specific user
   */
  private async discoverUserRepositories(userId: number, userDir: string): Promise<void> {
    try {
      const fs = require('fs').promises;
      const path = require('path');

      const entries = await fs.readdir(userDir, { withFileTypes: true });
      let reposFound = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const repoPath = path.join(userDir, entry.name);

        // Check if it's a git repository
        const gitPath = path.join(repoPath, '.git');
        try {
          await fs.access(gitPath);

          // It's a git repo, add it
          const repoId = uuidv4();
          const session = this.getUserSession(userId);

          // Get git remote URL if available
          let gitUrl: string | undefined;
          try {
            const url = await this.getGitRemoteUrl(repoPath);
            gitUrl = url || undefined;
          } catch {
            // No remote URL
            gitUrl = undefined;
          }

          // Check if this repository was previously deleted
          const wasDeleted = await this.isRepositoryDeleted(userId, gitUrl, repoPath);
          if (wasDeleted) {
            logger.debug('Skipping deleted repository during discovery', {
              userId,
              repoPath,
              gitUrl
            });
            continue;
          }

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

          // Set as current if it's the only one
          if (!session.currentRepositoryId) {
            session.currentRepositoryId = repoId;
          }

          reposFound++;

          logger.debug('Discovered repository', {
            userId,
            repoName: entry.name,
            repoPath,
            hasRemote: !!gitUrl
          });
        } catch {
          // Not a git repository, skip
        }
      }

      if (reposFound > 0) {
        logger.info('User repositories discovered', {
          userId,
          reposFound
        });
      }
    } catch (error) {
      logger.warn('Error discovering user repositories', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get or create user session
   */
  private getUserSession(userId: number): UserSession {
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, {
        userId,
        repositories: new Map()
      });
    }
    return this.userSessions.get(userId)!;
  }

  /**
   * Clone a repository
   */
  async cloneRepository(
    userId: number,
    gitUrl: string,
    name?: string,
    branch?: string
  ): Promise<Repository> {
    const session = this.getUserSession(userId);

    // Extract repo name from URL if not provided
    const repoName = name || this.extractRepoNameFromUrl(gitUrl);
    const repoId = uuidv4();
    const repoPath = path.join(this.baseWorkspacePath, `user_${userId}`, repoName);

    // Check if this repository was previously deleted
    const wasDeleted = await this.isRepositoryDeleted(userId, gitUrl, repoPath);
    if (wasDeleted) {
      throw new Error(
        'This repository was previously deleted. If you want to clone it again, please use a different name or contact support to undelete it.'
      );
    }

    // Store original URL for display purposes
    const originalGitUrl = gitUrl;

    // Inject token for authentication
    const authenticatedUrl = this.injectTokenIntoUrl(gitUrl);

    logger.info('Cloning repository', {
      userId,
      gitUrl: originalGitUrl, // Log original URL (without token)
      repoPath,
      usingToken: authenticatedUrl !== originalGitUrl
    });

    try {
      // Create user directory if it doesn't exist
      await fs.mkdir(path.dirname(repoPath), { recursive: true });

      // Check if directory already exists
      const exists = await this.directoryExists(repoPath);
      if (exists) {
        throw new Error(`Repository directory already exists: ${repoName}`);
      }

      // Clone the repository with authenticated URL
      await this.executeGitCommand('clone', [
        authenticatedUrl,
        ...(branch ? ['-b', branch] : []),
        repoPath
      ]);

      // Configure git to use the token for authentication
      if (this.githubToken && authenticatedUrl !== originalGitUrl) {
        try {
          // The authenticated URL with token is already set as the remote origin
          // This ensures all future git operations (push/pull/fetch) will use the token
          logger.info('Repository configured with GitHub token authentication', {
            repoPath,
            tokenLength: this.githubToken.length,
            hasToken: true
          });

          // Verify the remote URL is set correctly
          const remoteUrl = await this.getGitRemoteUrl(repoPath);
          logger.debug('Verified git remote URL', {
            hasAuth: remoteUrl?.includes('@github.com') || false,
            repoPath
          });
        } catch (error) {
          logger.warn('Failed to verify git credentials', {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Create repository record
      const repository: Repository = {
        id: repoId,
        name: repoName,
        path: repoPath,
        type: RepositoryType.CLONED,
        gitUrl: originalGitUrl,
        branch,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      // Store in session
      session.repositories.set(repoId, repository);
      session.currentRepositoryId = repoId;

      // Persist to UserConfig
      if (this.userConfigManager) {
        try {
          await this.userConfigManager.updateConfig(userId, {
            currentRepositoryId: repoId
          });
        } catch (error) {
          logger.warn('Failed to persist current repository to config', {
            userId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      logger.info('Repository cloned successfully', { repoId, repoName });
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

  /**
   * Create a new empty repository
   */
  async createRepository(
    userId: number,
    name: string,
    initGit: boolean = true
  ): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repoId = uuidv4();
    const repoPath = path.join(this.baseWorkspacePath, `user_${userId}`, name);

    // Check if this repository path was previously deleted
    const wasDeleted = await this.isRepositoryDeleted(userId, undefined, repoPath);
    if (wasDeleted) {
      throw new Error(
        'A repository at this path was previously deleted. Please use a different name.'
      );
    }

    logger.info('Creating new repository', { userId, name, repoPath });

    try {
      // Create directory
      await fs.mkdir(repoPath, { recursive: true });

      // Initialize git if requested
      if (initGit) {
        await this.executeGitCommand('init', [], repoPath);
      }

      // Create repository record
      const repository: Repository = {
        id: repoId,
        name,
        path: repoPath,
        type: RepositoryType.NEW,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      // Store in session
      session.repositories.set(repoId, repository);
      session.currentRepositoryId = repoId;

      // Persist to UserConfig
      if (this.userConfigManager) {
        try {
          await this.userConfigManager.updateConfig(userId, {
            currentRepositoryId: repoId
          });
        } catch (error) {
          logger.warn('Failed to persist current repository to config', {
            userId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      logger.info('Repository created successfully', { repoId, name });
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

  /**
   * Add an existing repository to the user's session
   */
  async addExistingRepository(
    userId: number,
    repoPath: string,
    name?: string
  ): Promise<Repository> {
    const session = this.getUserSession(userId);

    // Validate path exists
    const exists = await this.directoryExists(repoPath);
    if (!exists) {
      throw new Error(`Directory does not exist: ${repoPath}`);
    }

    const repoId = uuidv4();
    const repoName = name || path.basename(repoPath);

    // Check if it's a git repository
    const isGitRepo = await this.directoryExists(path.join(repoPath, '.git'));

    let gitUrl: string | undefined;

    // If it's a git repo, try to get the remote URL
    if (isGitRepo) {
      try {
        const remoteUrl = await this.getGitRemoteUrl(repoPath);
        if (remoteUrl) {
          gitUrl = remoteUrl;
        }
      } catch (error) {
        // Ignore if we can't get remote URL
      }
    }

    // Check if this repository was previously deleted
    const wasDeleted = await this.isRepositoryDeleted(userId, gitUrl, repoPath);
    if (wasDeleted) {
      throw new Error(
        'This repository was previously deleted. If you want to add it again, please contact support to undelete it.'
      );
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

    // Persist to UserConfig
    if (this.userConfigManager) {
      try {
        await this.userConfigManager.updateConfig(userId, {
          currentRepositoryId: repoId
        });
      } catch (error) {
        logger.warn('Failed to persist current repository to config', {
          userId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('Existing repository added', { repoId, repoName, repoPath });
    return repository;
  }

  /**
   * Switch to a different repository
   */
  async switchRepository(userId: number, repositoryId: string): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    session.currentRepositoryId = repositoryId;
    repository.lastUsed = new Date();

    // Persist to UserConfig
    if (this.userConfigManager) {
      try {
        await this.userConfigManager.updateConfig(userId, {
          currentRepositoryId: repositoryId
        });
        logger.debug('Persisted current repository to config', { userId, repositoryId });
      } catch (error) {
        logger.warn('Failed to persist current repository to config', {
          userId,
          repositoryId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    logger.info('Switched repository', { userId, repositoryId, name: repository.name });
    return repository;
  }

  /**
   * Get current repository for user
   */
  getCurrentRepository(userId: number): Repository | undefined {
    const session = this.getUserSession(userId);
    if (!session.currentRepositoryId) {
      return undefined;
    }
    return session.repositories.get(session.currentRepositoryId);
  }

  /**
   * List all repositories for a user
   */
  async listRepositories(userId: number): Promise<Repository[]> {
    const session = this.getUserSession(userId);
    const allRepos = Array.from(session.repositories.values());

    // Filter out deleted repositories (without modifying the session)
    const activeRepos: Repository[] = [];
    for (const repo of allRepos) {
      const isDeleted = await this.isRepositoryDeleted(userId, repo.gitUrl, repo.path);
      if (!isDeleted) {
        activeRepos.push(repo);
      } else {
        // Log but don't remove from session here to avoid unexpected state changes
        logger.debug('Filtered out deleted repository from list (still in session)', {
          repositoryId: repo.id,
          name: repo.name,
          path: repo.path,
          gitUrl: repo.gitUrl
        });
      }
    }

    return activeRepos.sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime());
  }

  /**
   * Refresh repository info (updates git URL, branch, etc.)
   */
  async refreshRepository(userId: number, repositoryId: string): Promise<Repository> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    // Update git remote URL
    try {
      const remoteUrl = await this.getGitRemoteUrl(repository.path);
      if (remoteUrl) {
        repository.gitUrl = remoteUrl;
      }
    } catch (error) {
      logger.debug('Could not fetch remote URL during refresh', {
        repositoryId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Update branch info
    try {
      const branch = await this.getCurrentBranch(repository.path);
      if (branch) {
        repository.branch = branch;
      }
    } catch (error) {
      logger.debug('Could not fetch branch during refresh', {
        repositoryId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Update last used time
    repository.lastUsed = new Date();

    return repository;
  }

  /**
   * Delete a repository
   */
  async deleteRepository(userId: number, repositoryId: string): Promise<void> {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    // Save to deleted repositories list in user config
    if (this.userConfigManager) {
      try {
        const userConfig = await this.userConfigManager.getConfig(userId);
        const deletedRepos = userConfig.deletedRepositories || [];

        // Add this repository to the deleted list
        deletedRepos.push({
          gitUrl: repository.gitUrl,
          path: repository.path,
          deletedAt: new Date()
        });

        await this.userConfigManager.updateConfig(userId, {
          deletedRepositories: deletedRepos
        });

        logger.info('Repository marked as deleted in user config', {
          repositoryId,
          gitUrl: repository.gitUrl,
          path: repository.path
        });
      } catch (error) {
        logger.warn('Failed to save deleted repository to user config', {
          repositoryId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    // Only delete directories we created (not existing ones)
    if (repository.type !== RepositoryType.EXISTING) {
      try {
        await fs.rm(repository.path, { recursive: true, force: true });
      } catch (error) {
        logger.warn('Failed to delete repository directory', {
          repositoryId,
          path: repository.path,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    session.repositories.delete(repositoryId);

    // If this was the current repo, clear it
    if (session.currentRepositoryId === repositoryId) {
      session.currentRepositoryId = undefined;
    }

    logger.info('Repository deleted', { repositoryId, name: repository.name });
  }

  /**
   * Normalize a git URL for comparison by removing authentication, protocol variations, and .git suffix
   */
  private normalizeGitUrl(gitUrl: string): string {
    if (!gitUrl) return '';

    let normalized = gitUrl.trim().toLowerCase();

    // Remove authentication tokens (https://token@github.com or https://user:token@github.com)
    normalized = normalized.replace(/https?:\/\/[^@]+@/, 'https://');

    // Convert SSH to HTTPS (git@github.com:user/repo -> https://github.com/user/repo)
    normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');

    // Remove www. prefix
    normalized = normalized.replace('://www.', '://');

    // Remove trailing slashes
    normalized = normalized.replace(/\/+$/, '');

    // Remove .git suffix
    normalized = normalized.replace(/\.git$/, '');

    return normalized;
  }

  /**
   * Check if a repository is in the deleted list
   */
  private async isRepositoryDeleted(
    userId: number,
    gitUrl?: string,
    repoPath?: string
  ): Promise<boolean> {
    if (!this.userConfigManager) {
      return false;
    }

    try {
      const userConfig = await this.userConfigManager.getConfig(userId);
      const deletedRepos = userConfig.deletedRepositories || [];

      return deletedRepos.some((deleted) => {
        // Match by git URL if both are available (using normalized URLs)
        if (gitUrl && deleted.gitUrl) {
          const normalizedGitUrl = this.normalizeGitUrl(gitUrl);
          const normalizedDeletedUrl = this.normalizeGitUrl(deleted.gitUrl);
          if (normalizedGitUrl && normalizedDeletedUrl && normalizedGitUrl === normalizedDeletedUrl) {
            return true;
          }
        }
        // Match by path if available
        if (repoPath && deleted.path === repoPath) {
          return true;
        }
        return false;
      });
    } catch (error) {
      logger.warn('Failed to check deleted repositories', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Get repository info
   */
  getRepository(userId: number, repositoryId: string): Repository | undefined {
    const session = this.getUserSession(userId);
    return session.repositories.get(repositoryId);
  }

  /**
   * Extract repository name from Git URL
   */
  private extractRepoNameFromUrl(gitUrl: string): string {
    const match = gitUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : 'repository';
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(dirPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(dirPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Execute a git command
   */
  private executeGitCommand(
    command: string,
    args: string[],
    cwd?: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      // Set up environment variables for git
      const env = { ...process.env };

      // Disable interactive prompts
      env.GIT_TERMINAL_PROMPT = '0';

      // Add GitHub token as environment variable if available
      if (this.githubToken) {
        env.GITHUB_TOKEN = this.githubToken;
        // Some git operations may use GIT_ASKPASS
        env.GIT_ASKPASS = '/bin/echo';
      }

      const gitProcess = spawn('git', [command, ...args], {
        cwd: cwd || this.baseWorkspacePath,
        env
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Git command failed with code ${code}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * Get git remote URL
   */
  private async getGitRemoteUrl(repoPath: string): Promise<string | null> {
    try {
      const url = await this.executeGitCommand('config', ['--get', 'remote.origin.url'], repoPath);
      return url || null;
    } catch {
      return null;
    }
  }

  /**
   * Get current git branch
   */
  private async getCurrentBranch(repoPath: string): Promise<string | null> {
    try {
      const branch = await this.executeGitCommand('branch', ['--show-current'], repoPath);
      return branch?.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Re-scan for new repositories (manual refresh)
   */
  async rescan(): Promise<{ usersFound: number; reposFound: number }> {
    logger.info('Manual repository rescan initiated');

    const beforeCount = this.getTotalRepositoryCount();
    await this.discoverRepositories();
    const afterCount = this.getTotalRepositoryCount();

    const newRepos = afterCount - beforeCount;

    logger.info('Manual rescan complete', {
      reposBefore: beforeCount,
      reposAfter: afterCount,
      newReposFound: newRepos
    });

    return {
      usersFound: this.userSessions.size,
      reposFound: newRepos
    };
  }

  /**
   * Get total repository count across all users
   */
  private getTotalRepositoryCount(): number {
    let count = 0;
    for (const session of this.userSessions.values()) {
      count += session.repositories.size;
    }
    return count;
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalUsers: number;
    totalRepositories: number;
    repositoriesByType: Record<RepositoryType, number>;
  } {
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

    return {
      totalUsers: this.userSessions.size,
      totalRepositories,
      repositoriesByType
    };
  }
}

export default RepositoryManager;
