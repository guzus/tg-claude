import { exec } from 'child_process';
import { promisify } from 'util';
import { PullRequest, CIStatus, CICheck } from '../types';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

/**
 * Service for managing Pull Requests via GitHub CLI
 */
export class PRService {
  private defaultTimeout = 30000; // 30 seconds

  /**
   * List open PRs for the current repository
   */
  async listPRs(workingDir: string): Promise<PullRequest[]> {
    try {
      const { stdout } = await execAsync(
        'gh pr list --json number,title,url,state,author,headRefName,baseRefName,createdAt,updatedAt --limit 20',
        { cwd: workingDir, timeout: this.defaultTimeout }
      );

      const prs = JSON.parse(stdout || '[]');

      return Promise.all(prs.map(async (pr: any) => {
        const checks = await this.getPRChecks(workingDir, pr.number);
        const ciStatus = this.determineCIStatus(checks);

        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state.toLowerCase(),
          author: pr.author?.login || 'unknown',
          branch: pr.headRefName,
          baseBranch: pr.baseRefName,
          ciStatus,
          checks,
          createdAt: new Date(pr.createdAt),
          updatedAt: new Date(pr.updatedAt)
        } as PullRequest;
      }));
    } catch (error) {
      logger.error('Failed to list PRs', {
        error: error instanceof Error ? error.message : String(error),
        workingDir
      });
      return [];
    }
  }

  /**
   * Get PR details by number
   */
  async getPR(workingDir: string, prNumber: number): Promise<PullRequest | null> {
    try {
      const { stdout } = await execAsync(
        `gh pr view ${prNumber} --json number,title,url,state,author,headRefName,baseRefName,createdAt,updatedAt`,
        { cwd: workingDir, timeout: this.defaultTimeout }
      );

      const pr = JSON.parse(stdout);
      const checks = await this.getPRChecks(workingDir, prNumber);
      const ciStatus = this.determineCIStatus(checks);

      return {
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state.toLowerCase(),
        author: pr.author?.login || 'unknown',
        branch: pr.headRefName,
        baseBranch: pr.baseRefName,
        ciStatus,
        checks,
        createdAt: new Date(pr.createdAt),
        updatedAt: new Date(pr.updatedAt)
      };
    } catch (error) {
      logger.error('Failed to get PR', {
        error: error instanceof Error ? error.message : String(error),
        prNumber,
        workingDir
      });
      return null;
    }
  }

  /**
   * Get CI checks for a PR
   */
  async getPRChecks(workingDir: string, prNumber: number): Promise<CICheck[]> {
    try {
      const { stdout } = await execAsync(
        `gh pr checks ${prNumber} --json name,status,conclusion,detailsUrl`,
        { cwd: workingDir, timeout: this.defaultTimeout }
      );

      const checks = JSON.parse(stdout || '[]');

      return checks.map((check: any) => ({
        name: check.name,
        status: this.mapCheckStatus(check.status, check.conclusion),
        conclusion: check.conclusion,
        url: check.detailsUrl
      }));
    } catch (error) {
      // PR might not have any checks
      logger.debug('Failed to get PR checks', {
        error: error instanceof Error ? error.message : String(error),
        prNumber
      });
      return [];
    }
  }

  /**
   * Map GitHub check status to our status enum
   */
  private mapCheckStatus(status: string, conclusion?: string): CICheck['status'] {
    if (status === 'COMPLETED' || status === 'completed') {
      if (conclusion === 'SUCCESS' || conclusion === 'success') return 'success';
      if (conclusion === 'FAILURE' || conclusion === 'failure') return 'failure';
      if (conclusion === 'CANCELLED' || conclusion === 'cancelled') return 'cancelled';
      if (conclusion === 'SKIPPED' || conclusion === 'skipped') return 'skipped';
      return 'failure';
    }
    return 'pending';
  }

  /**
   * Determine overall CI status from checks
   */
  private determineCIStatus(checks: CICheck[]): CIStatus {
    if (checks.length === 0) return CIStatus.UNKNOWN;

    const hasPending = checks.some(c => c.status === 'pending');
    const hasFailing = checks.some(c => c.status === 'failure');
    const allPassing = checks.every(c => c.status === 'success' || c.status === 'skipped');

    if (hasFailing) return CIStatus.FAILING;
    if (hasPending) return CIStatus.PENDING;
    if (allPassing) return CIStatus.PASSING;
    return CIStatus.UNKNOWN;
  }

  /**
   * Merge a PR using squash merge
   */
  async mergePR(
    workingDir: string,
    prNumber: number,
    commitMessage?: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      // First check if CI is passing
      const checks = await this.getPRChecks(workingDir, prNumber);
      const ciStatus = this.determineCIStatus(checks);

      if (ciStatus === CIStatus.PENDING) {
        return {
          success: false,
          message: 'CI checks are still running. Please wait for them to complete.'
        };
      }

      if (ciStatus === CIStatus.FAILING) {
        const failingChecks = checks.filter(c => c.status === 'failure').map(c => c.name);
        return {
          success: false,
          message: `CI checks are failing: ${failingChecks.join(', ')}`
        };
      }

      // Build merge command
      let mergeCmd = `gh pr merge ${prNumber} --squash --delete-branch`;
      if (commitMessage) {
        // Escape the commit message for shell
        const escapedMsg = commitMessage.replace(/'/g, "'\\''");
        mergeCmd += ` --body '${escapedMsg}'`;
      }

      await execAsync(mergeCmd, {
        cwd: workingDir,
        timeout: 60000 // 60 seconds for merge
      });

      logger.info('PR merged successfully', { prNumber, workingDir });

      return {
        success: true,
        message: `PR #${prNumber} merged successfully using squash merge.`
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to merge PR', {
        error: errorMsg,
        prNumber,
        workingDir
      });

      // Parse common error messages
      if (errorMsg.includes('not mergeable')) {
        return { success: false, message: 'PR has merge conflicts that need to be resolved.' };
      }
      if (errorMsg.includes('required status check')) {
        return { success: false, message: 'Required status checks have not passed.' };
      }
      if (errorMsg.includes('review is required')) {
        return { success: false, message: 'PR requires review approval before merging.' };
      }

      return { success: false, message: `Failed to merge: ${errorMsg}` };
    }
  }

  /**
   * Wait for CI checks to complete
   */
  async waitForCI(
    workingDir: string,
    prNumber: number,
    timeoutMs: number = 300000 // 5 minutes default
  ): Promise<{ status: CIStatus; checks: CICheck[] }> {
    const startTime = Date.now();
    const pollInterval = 10000; // 10 seconds

    while (Date.now() - startTime < timeoutMs) {
      const checks = await this.getPRChecks(workingDir, prNumber);
      const status = this.determineCIStatus(checks);

      if (status !== CIStatus.PENDING) {
        return { status, checks };
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    // Timeout reached
    const finalChecks = await this.getPRChecks(workingDir, prNumber);
    return {
      status: this.determineCIStatus(finalChecks),
      checks: finalChecks
    };
  }

  /**
   * Get PRs created by a specific user (for checking own PRs)
   */
  async getMyPRs(workingDir: string, author?: string): Promise<PullRequest[]> {
    try {
      const authorFilter = author ? `--author ${author}` : '--author @me';
      const { stdout } = await execAsync(
        `gh pr list ${authorFilter} --json number,title,url,state,author,headRefName,baseRefName,createdAt,updatedAt --limit 10`,
        { cwd: workingDir, timeout: this.defaultTimeout }
      );

      const prs = JSON.parse(stdout || '[]');

      return Promise.all(prs.map(async (pr: any) => {
        const checks = await this.getPRChecks(workingDir, pr.number);
        const ciStatus = this.determineCIStatus(checks);

        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state.toLowerCase(),
          author: pr.author?.login || 'unknown',
          branch: pr.headRefName,
          baseBranch: pr.baseRefName,
          ciStatus,
          checks,
          createdAt: new Date(pr.createdAt),
          updatedAt: new Date(pr.updatedAt)
        } as PullRequest;
      }));
    } catch (error) {
      logger.error('Failed to get my PRs', {
        error: error instanceof Error ? error.message : String(error),
        workingDir
      });
      return [];
    }
  }

  /**
   * Check if gh CLI is available
   */
  async checkGhCli(): Promise<boolean> {
    try {
      await execAsync('gh --version', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if authenticated with GitHub
   */
  async checkAuth(): Promise<boolean> {
    try {
      await execAsync('gh auth status', { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}

export default PRService;
