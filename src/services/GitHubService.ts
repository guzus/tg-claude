import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const execAsync = promisify(exec);

/**
 * Service for handling GitHub CLI operations
 */
export class GitHubService {
  private token: string;
  private isAuthenticated: boolean = false;

  constructor(token: string) {
    this.token = token;
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

      // First check if already authenticated (GITHUB_TOKEN env var might be in use)
      const isAlreadyAuth = await this.checkAuthStatus();
      if (isAlreadyAuth) {
        logger.info('GitHub CLI already authenticated via environment variable');
        this.isAuthenticated = true;
        return true;
      }

      // Unset GITHUB_TOKEN temporarily to allow gh auth login --with-token
      // The gh CLI prioritizes env vars over stdin, which causes conflicts
      const { stderr } = await execAsync(
        `unset GITHUB_TOKEN && echo "${this.token}" | gh auth login --with-token`,
        { shell: '/bin/bash' }
      );

      if (stderr && !stderr.includes('Logged in')) {
        logger.warn('GitHub authentication warning', { stderr });
      }

      // Verify authentication
      const { stdout: statusOutput } = await execAsync('gh auth status');
      logger.info('GitHub authentication successful', {
        status: statusOutput.split('\n')[0]
      });

      this.isAuthenticated = true;
      return true;
    } catch (error) {
      logger.error('GitHub authentication failed', {
        error: getErrorMessage(error)
      });
      this.isAuthenticated = false;
      return false;
    }
  }

  /**
   * Check if GitHub CLI is authenticated
   */
  async checkAuthStatus(): Promise<boolean> {
    try {
      await execAsync('gh auth status');
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
   */
  async executeCommand(command: string): Promise<{ stdout: string; stderr: string }> {
    if (!this.isAuthenticated) {
      throw new Error('GitHub CLI is not authenticated');
    }

    try {
      const result = await execAsync(command);
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
