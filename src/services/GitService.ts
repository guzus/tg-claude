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
  private githubToken: string | undefined;
  private tokenValidationResult: { valid: boolean; reason?: string } | null = null;

  constructor() {
    const rawToken = process.env.GITHUB_PAT;

    // Trim whitespace (common copy-paste issue)
    this.githubToken = rawToken?.trim();

    // Validate and log token status on startup
    this.validateTokenFormat();
  }

  /**
   * Validate GitHub token format and log status
   * Valid formats: ghp_*, gho_*, ghs_*, ghr_*, github_pat_*
   */
  private validateTokenFormat(): void {
    if (!this.githubToken) {
      this.tokenValidationResult = { valid: false, reason: 'not_set' };
      logger.info('GitHub: GITHUB_PAT not configured - repo creation disabled');
      return;
    }

    // Check for common issues
    if (this.githubToken.includes(' ') || this.githubToken.includes('\n')) {
      this.tokenValidationResult = { valid: false, reason: 'contains_whitespace' };
      logger.error('GitHub: GITHUB_PAT contains whitespace - please check the value');
      return;
    }

    // Validate token format - be permissive but catch obvious errors
    // Classic PAT: ghp_, gho_, ghs_, ghr_ (40+ chars total)
    // Fine-grained: github_pat_ (80+ chars total)
    const isClassicPAT = /^gh[pors]_[a-zA-Z0-9_]+$/.test(this.githubToken) && this.githubToken.length >= 40;
    const isFineGrained = this.githubToken.startsWith('github_pat_') && this.githubToken.length >= 80;
    const looksLikeToken = isClassicPAT || isFineGrained || this.githubToken.length >= 30;

    if (!looksLikeToken) {
      this.tokenValidationResult = { valid: false, reason: 'invalid_format' };
      logger.warn('GitHub: GITHUB_PAT appears invalid (too short or wrong format)', {
        length: this.githubToken.length
      });
    } else if (!isClassicPAT && !isFineGrained) {
      // Unknown format but reasonable length - try it anyway
      this.tokenValidationResult = { valid: true, reason: 'unknown_format' };
      logger.info('GitHub: GITHUB_PAT configured (unknown format, will attempt)');
    } else {
      this.tokenValidationResult = { valid: true };
      const tokenType = isClassicPAT ? 'classic' : 'fine-grained';
      logger.info(`GitHub: GITHUB_PAT configured (${tokenType} token)`);
    }
  }

  /**
   * Check if GitHub token is configured and valid
   */
  hasValidToken(): boolean {
    return !!this.githubToken && this.tokenValidationResult?.valid !== false;
  }

  /**
   * Get token validation status for diagnostics
   */
  getTokenStatus(): { configured: boolean; valid: boolean; reason?: string } {
    return {
      configured: !!this.githubToken,
      valid: this.tokenValidationResult?.valid ?? false,
      reason: this.tokenValidationResult?.reason
    };
  }

  /**
   * Inject GitHub token into git URL for authentication
   */
  injectTokenIntoUrl(gitUrl: string): string {
    if (!this.githubToken || !gitUrl.includes('github.com')) {
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
        `https://x-access-token:${this.githubToken}@github.com/`
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
   */
  async ensureAuthRemote(workingDir: string): Promise<boolean> {
    if (!this.githubToken) return false;

    try {
      const remoteUrl = await this.getRemoteUrl(workingDir);
      if (!remoteUrl || !remoteUrl.includes('github.com')) return false;
      if (remoteUrl.includes('x-access-token:') || remoteUrl.includes('oauth2:')) return false;

      const authUrl = this.injectTokenIntoUrl(remoteUrl);
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
   */
  async push(workingDir: string): Promise<PushResult> {
    try {
      const hasRemote = await this.hasRemote(workingDir);
      if (!hasRemote) {
        return { status: 'no_remote' };
      }

      const remoteUrl = await this.getRemoteUrl(workingDir);
      if (remoteUrl && this.githubToken && remoteUrl.includes('github.com') && !remoteUrl.includes('@github.com')) {
        const authUrl = this.injectTokenIntoUrl(remoteUrl);
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
   * Check if gh CLI is installed (works on Alpine Linux and other systems)
   */
  async isGhInstalled(): Promise<boolean> {
    try {
      // Use 'gh --version' instead of 'which' for better cross-platform compatibility
      await execAsync('gh --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if GitHub CLI is authenticated
   * gh CLI uses GH_TOKEN env var, so we pass GITHUB_PAT as GH_TOKEN
   */
  async isGhAuthenticated(): Promise<boolean> {
    // If no token is set, we can't authenticate
    if (!this.githubToken) {
      return false;
    }

    try {
      await execAsync('gh auth status', {
        timeout: 5000,
        env: { ...process.env, GH_TOKEN: this.githubToken }
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create GitHub repository using gh CLI
   * Returns detailed result with error information
   */
  async createGitHubRepository(
    workingDir: string,
    isPrivate = false,
    customRepoName?: string
  ): Promise<{ status: 'success' | 'already_exists' | 'not_authenticated' | 'error'; error?: string }> {
    // Check if gh CLI is installed
    const ghInstalled = await this.isGhInstalled();
    if (!ghInstalled) {
      logger.warn('gh CLI not installed - cannot create repository');
      return {
        status: 'error',
        error: 'GitHub CLI (gh) not installed in container.'
      };
    }

    // Check token configuration with specific error messages
    const tokenStatus = this.getTokenStatus();
    if (!tokenStatus.configured) {
      return {
        status: 'not_authenticated',
        error: 'Set GITHUB_PAT in Railway environment variables.'
      };
    }

    if (tokenStatus.reason === 'contains_whitespace') {
      return {
        status: 'not_authenticated',
        error: 'GITHUB_PAT contains spaces or newlines. Remove extra whitespace.'
      };
    }

    if (tokenStatus.reason === 'invalid_format') {
      logger.warn('GitHub token format unrecognized, attempting anyway');
    }

    // Verify token works with gh CLI
    const isAuth = await this.isGhAuthenticated();
    if (!isAuth) {
      // Provide specific guidance based on what we know
      let errorMsg = 'GitHub authentication failed.';
      if (tokenStatus.reason === 'invalid_format') {
        errorMsg = 'GITHUB_PAT format invalid. Use a GitHub Personal Access Token (classic or fine-grained).';
      } else {
        errorMsg = 'GITHUB_PAT rejected by GitHub. Check token is valid and has "repo" scope.';
      }
      return {
        status: 'not_authenticated',
        error: errorMsg
      };
    }

    try {
      const repoName = customRepoName || path.basename(workingDir);
      const visibility = isPrivate ? '--private' : '--public';
      await execAsync(`gh repo create ${repoName} ${visibility} --source=. --remote=origin --push`, {
        cwd: workingDir,
        timeout: 30000,
        env: { ...process.env, GH_TOKEN: this.githubToken }
      });
      logger.info('Created GitHub repository', { repoName, visibility });
      return { status: 'success' };
    } catch (error) {
      const errMsg = getErrorMessage(error);
      if (errMsg.includes('Name already exists')) {
        return { status: 'already_exists', error: 'Repository name already exists on GitHub' };
      }
      logger.error('Failed to create GitHub repository', { error: errMsg });
      // Sanitize error message (remove tokens if any)
      const sanitizedError = errMsg
        .replace(/gh[opsr]_[a-zA-Z0-9_]+/g, '[REDACTED]')
        .replace(/github_pat_[a-zA-Z0-9_]+/g, '[REDACTED]')
        .replace(/x-access-token:[^@]+@/gi, 'x-access-token:***@');
      return { status: 'error', error: sanitizedError };
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
   */
  async clone(gitUrl: string, targetPath: string, branch?: string): Promise<void> {
    const authUrl = this.injectTokenIntoUrl(gitUrl);
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
