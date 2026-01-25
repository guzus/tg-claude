import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const execAsync = promisify(exec);

/**
 * Sanitize error messages to remove any tokens
 */
function sanitizeError(error: unknown): string {
  const msg = getErrorMessage(error);
  // Redact GitHub PAT tokens (ghp_..., gho_..., ghs_..., ghr_...)
  return msg.replace(/gh[opsr]_[a-zA-Z0-9]+/g, '[REDACTED]');
}

/**
 * Run gh auth login with token via stdin (not command line)
 */
function ghAuthLogin(token: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('gh', ['auth', 'login', '--with-token'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`gh auth login failed with exit code ${code}: ${stderr}`));
      }
    });

    proc.on('error', reject);

    // Write token to stdin and close
    proc.stdin.write(token);
    proc.stdin.end();
  });
}

/**
 * Service for handling GitHub CLI operations
 */
export class GitHubService {
  private token: string;
  private isAuthenticated: boolean = false;

  constructor(token: string) {
    // Trim whitespace (common copy-paste issue)
    this.token = token?.trim() || '';
  }

  /**
   * Authenticate with GitHub CLI using token
   */
  async authenticate(): Promise<boolean> {
    if (!this.token) {
      logger.warn('GITHUB_PAT not configured, skipping GitHub authentication');
      return false;
    }

    try {
      logger.info('Authenticating with GitHub CLI...');

      // First check if already authenticated (GITHUB_PAT env var might be in use)
      const isAlreadyAuth = await this.checkAuthStatus();
      if (isAlreadyAuth) {
        logger.info('GitHub CLI already authenticated via environment variable');
        this.isAuthenticated = true;
        return true;
      }

      // Use stdin to pass token (not command line args) to prevent leakage
      const { stderr } = await ghAuthLogin(this.token);

      if (stderr && !stderr.includes('Logged in')) {
        logger.warn('GitHub authentication warning', { stderr });
      }

      // Verify authentication
      const { stdout: statusOutput } = await execAsync('gh auth status', {
        env: { ...process.env, GH_TOKEN: this.token }
      });
      logger.info('GitHub authentication successful', {
        status: statusOutput.split('\n')[0]
      });

      this.isAuthenticated = true;
      return true;
    } catch (error) {
      // Sanitize error message to prevent token leakage in logs
      logger.error('GitHub authentication failed', {
        error: sanitizeError(error)
      });
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Check if GitHub CLI is authenticated
   * Pass GH_TOKEN env var so gh CLI can use it
   */
  async checkAuthStatus(): Promise<boolean> {
    try {
      await execAsync('gh auth status', {
        env: { ...process.env, GH_TOKEN: this.token }
      });
      this.isAuthenticated = true;
      return true;
    } catch {
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Get current authentication status
   */
  getAuthStatus(): boolean {
    return this.isAuthenticated;
  }

  /**
   * Execute a GitHub CLI command
   * Pass GH_TOKEN env var so gh CLI can use it
   */
  async executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.isAuthenticated) {
      throw new Error('GitHub CLI is not authenticated');
    }

    try {
      const result = await execAsync(command, {
        env: { ...process.env, GH_TOKEN: this.token }
      });
      return result;
    } catch (error) {
      logger.error('GitHub CLI command failed', {
        command,
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Logout from GitHub CLI
   */
  async logout(): Promise<void> {
    try {
      await execAsync('gh auth logout --hostname github.com');
      this.isAuthenticated = false;
      logger.info('Logged out from GitHub CLI');
    } catch (error) {
      logger.error('GitHub logout failed', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }
}
