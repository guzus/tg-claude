import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Repository, RepositoryType, UserSession } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export class RepositoryManager {
  private userSessions: Map<number, UserSession> = new Map();
  private baseWorkspacePath: string;

  constructor(baseWorkspacePath?: string) {
    this.baseWorkspacePath = baseWorkspacePath || config.workspacePath;
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

    logger.info('Cloning repository', { userId, gitUrl, repoPath });

    try {
      // Create user directory if it doesn't exist
      await fs.mkdir(path.dirname(repoPath), { recursive: true });

      // Check if directory already exists
      const exists = await this.directoryExists(repoPath);
      if (exists) {
        throw new Error(`Repository directory already exists: ${repoName}`);
      }

      // Clone the repository
      await this.executeGitCommand('clone', [
        gitUrl,
        ...(branch ? ['-b', branch] : []),
        repoPath
      ]);

      // Create repository record
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

      // Store in session
      session.repositories.set(repoId, repository);
      session.currentRepositoryId = repoId;

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

    const repository: Repository = {
      id: repoId,
      name: repoName,
      path: repoPath,
      type: RepositoryType.EXISTING,
      createdAt: new Date(),
      lastUsed: new Date()
    };

    // If it's a git repo, try to get the remote URL
    if (isGitRepo) {
      try {
        const remoteUrl = await this.getGitRemoteUrl(repoPath);
        if (remoteUrl) {
          repository.gitUrl = remoteUrl;
        }
      } catch (error) {
        // Ignore if we can't get remote URL
      }
    }

    session.repositories.set(repoId, repository);
    session.currentRepositoryId = repoId;

    logger.info('Existing repository added', { repoId, repoName, repoPath });
    return repository;
  }

  /**
   * Switch to a different repository
   */
  switchRepository(userId: number, repositoryId: string): Repository {
    const session = this.getUserSession(userId);
    const repository = session.repositories.get(repositoryId);

    if (!repository) {
      throw new Error('Repository not found');
    }

    session.currentRepositoryId = repositoryId;
    repository.lastUsed = new Date();

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
  listRepositories(userId: number): Repository[] {
    const session = this.getUserSession(userId);
    return Array.from(session.repositories.values()).sort(
      (a, b) => b.lastUsed.getTime() - a.lastUsed.getTime()
    );
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
      const gitProcess = spawn('git', [command, ...args], {
        cwd: cwd || this.baseWorkspacePath
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
