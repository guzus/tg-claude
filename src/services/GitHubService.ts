import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';

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
   * Uses stdin piping for secure token handling (avoids exposing token in process args)
   */
  async authenticate(): Promise<boolean> {
    if (!this.token) {
      logger.warn('GITHUB_TOKEN not configured, skipping GitHub authentication');
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

      // Use spawn with stdin piping for secure token handling
      // This avoids passing the token through shell where it could be logged
      await new Promise<void>((resolve, reject) => {
        const ghProcess = spawn('gh', ['auth', 'login', '--with-token'], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, GITHUB_TOKEN: undefined } // Unset to avoid conflicts
        });

        let stderr = '';
        ghProcess.stderr.on('data', (data) => { stderr += data.toString(); });

        ghProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`gh auth failed with code ${code}: ${stderr}`));
          }
        });

        ghProcess.on('error', reject);

        // Write token to stdin securely (not visible in process listing)
        ghProcess.stdin.write(this.token);
        ghProcess.stdin.end();
      });

      // Verify authentication
      const { stdout: statusOutput } = await execAsync('gh auth status');
      logger.info('GitHub authentication successful', {
        status: statusOutput.split('\n')[0]
      });

      this.isAuthenticated = true;
      return true;
    } catch (error) {
      logger.error('GitHub authentication failed', {
        error: error instanceof Error ? error.message : String(error)
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
    } catch (error) {
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
        error: error instanceof Error ? error.message : String(error)
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
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

