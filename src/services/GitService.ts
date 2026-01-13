import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const execAsync = promisify(exec);

interface GitStatus {
  hasUncommittedChanges: boolean;
  hasUnpushedCommits: boolean;
  hasRemote: boolean;
  currentBranch: string | null;
  remoteUrl: string | null;
}

interface CommitResult {
  success: boolean;
  hash: string | null;
  message: string;
}

interface PushResult {
  status: 'success' | 'no_remote' | 'no_changes' | 'failed';
  error?: string;
}

class GitService {
  private defaultGithubToken: string | undefined;

  constructor() {
    this.defaultGithubToken = process.env.GITHUB_PAT;
  }

  /**
   * Get the effective token to use (provided token or default)
   */
  private getEffectiveToken(token?: string): string | undefined {
    return token || this.defaultGithubToken;
  }

  /**
   * Inject GitHub token into git URL for authentication
   * @param gitUrl - The git URL to inject token into
   * @param token - Optional per-user token (falls back to environment variable)
   */
  injectTokenIntoUrl(gitUrl: string, token?: string): string {
    const effectiveToken = this.getEffectiveToken(token);
    if (!effectiveToken || !gitUrl.includes('github.com')) {
      return gitUrl;
    }

    let url = gitUrl.trim().replace(/\/+$/, '');

    // Convert SSH to HTTPS
    if (url.startsWith('git@github.com:')) {
      url = url.replace('git@github.com:', 'https://github.com/');
    }

    // Ensure .git suffix
    if (!url.endsWith('.git')) {
      url = url + '.git';
    }

    // Inject token
    if (url.startsWith('https://github.com/') || url.startsWith('https://www.github.com/')) {
      return url.replace(
        /^https:\/\/(www\.)?github\.com\//,
        `https://x-access-token:${effectiveToken}@github.com/`
      );
    }

    return url;
  }

  /**
   * Convert a git remote URL to a web URL
   */
  toWebUrl(gitUrl: string): string | null {
    if (!gitUrl) return null;

    let url = gitUrl.trim();
    if (url.startsWith('http://') || url.startsWith('https://')) {
      url = url.replace(/https?:\/\/[^@]+@/i, 'https://');
      return url.replace(/\.git$/, '');
    }

    const match = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (match) {
      return `https://${match[1]}/${match[2]}`;
    }

    return null;
  }

  /**
   * Normalize git URL for comparison
   */
  normalizeUrl(gitUrl: string): string {
    if (!gitUrl) return '';

    let normalized = gitUrl.trim().toLowerCase();
    normalized = normalized.replace(/https?:\/\/[^@]+@/, 'https://');
    normalized = normalized.replace(/^git@([^:]+):/, 'https://$1/');
    normalized = normalized.replace('://www.', '://');
    normalized = normalized.replace(/\/+$/, '');
    normalized = normalized.replace(/\.git$/, '');

    return normalized;
  }

  /**
   * Get comprehensive git status
   */
  async getStatus(workingDir: string): Promise<GitStatus> {
    const [hasUncommitted, hasUnpushed, hasRemote, branch, remoteUrl] = await Promise.all([
      this.hasUncommittedChanges(workingDir),
      this.hasUnpushedCommits(workingDir),
      this.hasRemote(workingDir),
      this.getCurrentBranch(workingDir),
      this.getRemoteUrl(workingDir)
    ]);

    return {
      hasUncommittedChanges: hasUncommitted,
      hasUnpushedCommits: hasUnpushed,
      hasRemote,
      currentBranch: branch,
      remoteUrl
    };
  }

  /**
   * Check for uncommitted changes
   */
  async hasUncommittedChanges(workingDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Check for unpushed commits
   */
  async hasUnpushedCommits(workingDir: string): Promise<boolean> {
    try {
      const hasRemote = await this.hasRemote(workingDir);
      if (!hasRemote) {
        try {
          await execAsync('git log -1', { cwd: workingDir, timeout: 5000 });
          return true;
        } catch {
          return false;
        }
      }

      const { stdout } = await execAsync('git status -sb', {
        cwd: workingDir,
        timeout: 5000
      });

      if (stdout.includes('ahead')) return true;
      if (stdout.includes('no upstream')) {
        const { stdout: logOutput } = await execAsync('git log -1', {
          cwd: workingDir,
          timeout: 5000
        });
        return logOutput.trim().length > 0;
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Check if remote exists
   */
  async hasRemote(workingDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git remote -v', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get remote URL
   */
  async getRemoteUrl(workingDir: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git config --get remote.origin.url', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Ensure GitHub remote uses token auth for non-interactive pushes
   * @param workingDir - Working directory
   * @param token - Optional per-user token (falls back to environment variable)
   */
  async ensureAuthRemote(workingDir: string, token?: string): Promise<boolean> {
    const effectiveToken = this.getEffectiveToken(token);
    if (!effectiveToken) return false;

    try {
      const remoteUrl = await this.getRemoteUrl(workingDir);
      if (!remoteUrl || !remoteUrl.includes('github.com')) return false;
      if (remoteUrl.includes('x-access-token:') || remoteUrl.includes('oauth2:')) return false;

      const authUrl = this.injectTokenIntoUrl(remoteUrl, effectiveToken);
      if (authUrl === remoteUrl) return false;

      await execAsync(`git remote set-url origin "${authUrl}"`, {
        cwd: workingDir,
        timeout: 5000
      });

      logger.info('Updated GitHub remote with token auth', { workingDir });
      return true;
    } catch (error) {
      const errMsg = this.maskGitHubToken(getErrorMessage(error));
      logger.debug('Failed to update GitHub remote auth', { workingDir, error: errMsg });
      return false;
    }
  }

  private maskGitHubToken(value: string): string {
    return value
      .replace(/x-access-token:[^@]+@/gi, 'x-access-token:***@')
      .replace(/oauth2:[^@]+@/gi, 'oauth2:***@');
  }

  /**
   * Get current branch
   */
  async getCurrentBranch(workingDir: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git branch --show-current', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Ensure git identity is configured
   */
  async ensureIdentity(workingDir: string, name?: string, email?: string): Promise<void> {
    try {
      const { stdout } = await execAsync('git config user.name', {
        cwd: workingDir,
        timeout: 5000
      });
      if (stdout.trim()) return;
    } catch {
      // Not configured, set defaults
    }

    const userName = name || 'tg-claude';
    const userEmail = email || 'claude-code@remote.machine';

    await execAsync(`git config user.name "${userName}"`, { cwd: workingDir, timeout: 5000 });
    await execAsync(`git config user.email "${userEmail}"`, { cwd: workingDir, timeout: 5000 });

    logger.info('Configured git identity', { workingDir, userName, userEmail });
  }

  /**
   * Commit all changes
   */
  async commit(workingDir: string, message: string): Promise<CommitResult> {
    try {
      const hasChanges = await this.hasUncommittedChanges(workingDir);
      if (!hasChanges) {
        return { success: false, hash: null, message: 'No changes to commit' };
      }

      await this.ensureIdentity(workingDir);
      await execAsync('git add .', { cwd: workingDir, timeout: 10000 });

      const escapedMessage = message.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${escapedMessage}"`, { cwd: workingDir, timeout: 10000 });

      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDir, timeout: 5000 });
      const hash = stdout.trim();

      logger.info('Committed changes', { workingDir, hash, message });
      return { success: true, hash, message };
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.error('Failed to commit', { workingDir, error: errMsg });
      return { success: false, hash: null, message: errMsg };
    }
  }

  /**
   * Push to remote
   * @param workingDir - Working directory
   * @param token - Optional per-user token (falls back to environment variable)
   */
  async push(workingDir: string, token?: string): Promise<PushResult> {
    try {
      const hasRemote = await this.hasRemote(workingDir);
      if (!hasRemote) {
        return { status: 'no_remote' };
      }

      const effectiveToken = this.getEffectiveToken(token);
      const remoteUrl = await this.getRemoteUrl(workingDir);
      if (remoteUrl && effectiveToken && remoteUrl.includes('github.com') && !remoteUrl.includes('@github.com')) {
        const authUrl = this.injectTokenIntoUrl(remoteUrl, effectiveToken);
        await execAsync(`git remote set-url origin "${authUrl}"`, { cwd: workingDir, timeout: 5000 });
      }

      const branch = await this.getCurrentBranch(workingDir);
      const { stdout: statusOutput } = await execAsync('git status -sb', { cwd: workingDir, timeout: 5000 });

      if (!statusOutput.includes('ahead')) {
        return { status: 'no_changes' };
      }

      await execAsync(`git push -u origin ${branch}`, {
        cwd: workingDir,
        timeout: 30000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });

      logger.info('Pushed changes', { workingDir, branch });
      return { status: 'success' };
    } catch (error) {
      const errMsg = getErrorMessage(error);

      if (errMsg.includes('Everything up-to-date')) {
        return { status: 'no_changes' };
      }

      logger.error('Failed to push', { workingDir, error: errMsg });
      return { status: 'failed', error: errMsg };
    }
  }

  /**
   * Create GitHub repository using gh CLI
   */
  async createGitHubRepository(
    workingDir: string,
    isPrivate = false,
    customRepoName?: string
  ): Promise<'success' | 'already_exists' | 'error'> {
    try {
      const repoName = customRepoName || path.basename(workingDir);
      const visibility = isPrivate ? '--private' : '--public';
      await execAsync(`gh repo create ${repoName} ${visibility} --source=. --remote=origin --push`, {
        cwd: workingDir,
        timeout: 30000,
      });
      logger.info('Created GitHub repository', { repoName, visibility });
      return 'success';
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (errMsg.includes('Name already exists')) return 'already_exists';
      logger.error('Failed to create GitHub repository', { error: errMsg });
      return 'error';
    }
  }

  /**
   * Auto-commit changes with generated message
   */
  async autoCommit(workingDir: string): Promise<string | null> {
    try {
      const hasChanges = await this.hasUncommittedChanges(workingDir);
      if (!hasChanges) return null;

      const message = await this.generateCommitMessage(workingDir);
      const result = await this.commit(workingDir, message);

      if (result.success) {
        logger.info('Auto-committed changes', { workingDir, hash: result.hash, message });
        return result.hash;
      }
      return null;
    } catch (error) {
      logger.error('Auto-commit error', { workingDir, error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Generate a simple commit message based on changed files
   */
  private async generateCommitMessage(workingDir: string): Promise<string> {
    try {
      const { stdout: gitStatus } = await execAsync('git status --short', { cwd: workingDir, timeout: 5000 });
      if (!gitStatus.trim()) return 'chore: update code';

      const fileChanges = gitStatus.trim().split('\n').map(line => {
        const match = line.match(/^(.{1,2})\s+(.+)$/);
        if (!match) return line.trim();
        const [, status, filePath] = match;
        const file = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;
        const statusDesc = status.includes('A') ? 'added' :
                          status.includes('M') ? 'modified' :
                          status.includes('D') ? 'deleted' :
                          status.includes('R') ? 'renamed' :
                          status.includes('?') ? 'new' : 'changed';
        return `${path.basename(file)} (${statusDesc})`;
      });

      const firstFile = fileChanges[0] || 'files';
      const fileCount = fileChanges.length;

      if (fileCount === 1) return `chore: update ${firstFile}`;
      return `chore: update ${fileCount} files`;
    } catch {
      return 'chore: update code';
    }
  }

  /**
   * Get commits since a specific hash
   */
  async getCommitsSince(workingDir: string, sinceHash: string): Promise<Array<{ hash: string; message: string }>> {
    try {
      const { stdout } = await execAsync(`git log ${sinceHash}..HEAD --format="%H|%s" --reverse`, {
        cwd: workingDir,
        timeout: 10000,
      });
      if (!stdout.trim()) return [];
      return stdout.trim().split('\n').map(line => {
        const [hash, ...messageParts] = line.split('|');
        return { hash, message: messageParts.join('|') };
      });
    } catch {
      return [];
    }
  }

  /**
   * Clone repository
   * @param gitUrl - Git URL to clone
   * @param targetPath - Target path to clone to
   * @param branch - Optional branch to checkout
   * @param token - Optional per-user token (falls back to environment variable)
   */
  async clone(gitUrl: string, targetPath: string, branch?: string, token?: string): Promise<void> {
    const authUrl = this.injectTokenIntoUrl(gitUrl, token);
    const args = ['clone', authUrl, ...(branch ? ['-b', branch] : []), targetPath];

    await this.execGit(args);
    logger.info('Cloned repository', { targetPath, branch });
  }

  /**
   * Initialize git repository
   */
  async init(workingDir: string): Promise<void> {
    await this.execGit(['init'], workingDir);
    logger.info('Initialized git repository', { workingDir });
  }

  /**
   * Execute git command
   */
  private execGit(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

      const gitProcess = spawn('git', args, { cwd, env });
      let stdout = '';
      let stderr = '';

      gitProcess.stdout?.on('data', (data) => { stdout += data.toString(); });
      gitProcess.stderr?.on('data', (data) => { stderr += data.toString(); });

      gitProcess.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(stderr || `Git command failed with code ${code}`));
        }
      });

      gitProcess.on('error', reject);
    });
  }
}

export const gitService = new GitService();
