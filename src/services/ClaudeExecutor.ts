import { spawn, ChildProcess } from 'child_process';
import { ClaudeTask, ClaudeExecutionOptions, TaskStatus } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

// Task logs directory
const TASK_LOGS_DIR = path.join(process.cwd(), 'logs', 'tasks');

export class ClaudeExecutor {
  private activeTasks: Map<string, ChildProcess> = new Map();
  private taskHistory: Map<string, ClaudeTask> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();

  constructor() {
    // Ensure task logs directory exists
    if (!fs.existsSync(TASK_LOGS_DIR)) {
      fs.mkdirSync(TASK_LOGS_DIR, { recursive: true });
      logger.info('Created task logs directory', { path: TASK_LOGS_DIR });
    }
  }

  /**
   * Create a log file for a task
   */
  private createTaskLogFile(taskId: string): fs.WriteStream {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `task_${taskId.substring(0, 8)}_${timestamp}.log`;
    const logFilePath = path.join(TASK_LOGS_DIR, logFileName);

    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.taskLogFiles.set(taskId, logStream);

    logger.info('Created task log file', { taskId, logFilePath });
    return logStream;
  }

  /**
   * Get the log file path for a task
   */
  getTaskLogFilePath(taskId: string): string | null {
    const task = this.taskHistory.get(taskId);
    if (!task) return null;

    const timestamp = task.startTime.toISOString().replace(/[:.]/g, '-');
    const logFileName = `task_${taskId.substring(0, 8)}_${timestamp}.log`;
    const logFilePath = path.join(TASK_LOGS_DIR, logFileName);

    return fs.existsSync(logFilePath) ? logFilePath : null;
  }

  /**
   * Authenticate with GitHub CLI using GITHUB_TOKEN environment variable
   */
  private async authenticateGitHub(): Promise<void> {
    try {
      const githubToken = process.env.GITHUB_TOKEN;

      if (!githubToken) {
        logger.warn('GITHUB_TOKEN not found in environment variables, skipping GitHub authentication');
        return;
      }

      logger.info('Authenticating with GitHub CLI using GITHUB_TOKEN');

      // Check if gh is installed
      try {
        await execAsync('which gh');
      } catch (error) {
        logger.warn('GitHub CLI (gh) not installed, skipping GitHub authentication');
        return;
      }

      // Authenticate using the token
      const authCommand = `echo "${githubToken}" | gh auth login --with-token`;
      await execAsync(authCommand, {
        timeout: 10000 // 10 second timeout
      });

      logger.info('Successfully authenticated with GitHub CLI');
    } catch (error) {
      // Log but don't fail the task - GitHub auth is optional
      logger.error('Failed to authenticate with GitHub CLI', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Execute a Claude Code command
   */
  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: ClaudeExecutionOptions = {}
  ): Promise<ClaudeTask> {
    const {
      workingDir = config.workspacePath,
      dangerMode = true,
      additionalFlags = [],
      timeout = config.taskTimeoutMs
    } = options;

    // Create task
    const task: ClaudeTask = {
      id: uuidv4(),
      userId,
      chatId,
      prompt,
      workingDir,
      status: TaskStatus.PENDING,
      startTime: new Date(),
      output: '',
      errorOutput: ''
    };

    logger.info('Starting Claude task', {
      taskId: task.id,
      userId,
      prompt: prompt.substring(0, 100),
      workingDir
    });

    try {
      // Authenticate with GitHub before executing
      await this.authenticateGitHub();

      // Check if working directory exists
      const fs = require('fs');
      if (!fs.existsSync(workingDir)) {
        throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
      }

      // Check if running as root
      const isRoot = process.getuid && process.getuid() === 0;

      // Build command arguments
      // With IS_SANDBOX=1, we can try using --dangerously-skip-permissions even as root
      const args = [
        prompt,
        ...(dangerMode ? ['--dangerously-skip-permissions'] : []),
        ...additionalFlags
      ];

      if (isRoot) {
        logger.info('Running as root - using IS_SANDBOX=1 to enable permissions flag', {
          taskId: task.id,
          uid: process.getuid ? process.getuid() : 'unknown',
          dangerMode
        });
      }

      logger.info('Spawning Claude process', {
        taskId: task.id,
        command: 'claude',
        args: args.map(a => a.length > 50 ? a.substring(0, 50) + '...' : a),
        cwd: workingDir,
        hasApiKey: !!config.claudeApiKey
      });

      // Build environment variables
      // Claude CLI will use its own authentication if ANTHROPIC_API_KEY is not set
      const env = { ...process.env };
      if (config.claudeApiKey && !config.claudeApiKey.includes('your_claude_api_key_here')) {
        env.ANTHROPIC_API_KEY = config.claudeApiKey;
      }

      // For root users, set environment to auto-approve (if Claude supports it)
      if (isRoot) {
        env.IS_SANDBOX = '1'; // Tell Claude it's running in a sandbox
        env.CLAUDE_AUTO_APPROVE = '1';
        env.CI = 'true'; // Some CLIs respect CI mode

        logger.info('Running as root - setting sandbox environment', {
          taskId: task.id,
          IS_SANDBOX: '1',
          CI: 'true'
        });
      }

      // Spawn Claude Code process with explicit stdio configuration
      const claudeProcess = spawn('claude', args, {
        cwd: workingDir,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'], // stdin=pipe (for auto-yes), stdout=pipe, stderr=pipe
        detached: false
      });

      // For root users, auto-approve any prompts by piping 'y' to stdin
      if (isRoot && claudeProcess.stdin) {
        // Send 'y' repeatedly to auto-approve any prompts
        claudeProcess.stdin.write('y\n');
        claudeProcess.stdin.write('yes\n');
        claudeProcess.stdin.write('y\n');
        // Close stdin after a short delay
        setTimeout(() => {
          claudeProcess.stdin?.end();
        }, 100);
      } else {
        // Close stdin immediately for non-root
        claudeProcess.stdin?.end();
      }

      // Verify process spawned successfully
      if (!claudeProcess.pid) {
        throw new Error('Failed to spawn Claude process - no PID assigned');
      }

      // Log process started
      logger.info('Claude process spawned successfully', {
        taskId: task.id,
        pid: claudeProcess.pid,
        command: 'claude',
        args: args.slice(0, 2),
        cwd: workingDir,
        hasStdin: !!claudeProcess.stdin,
        hasStdout: !!claudeProcess.stdout,
        hasStderr: !!claudeProcess.stderr
      });

      // Check if process exits immediately (error case)
      let processExitedImmediately = false;
      const immediateExitCheck = setTimeout(() => {
        if (processExitedImmediately) {
          logger.error('Claude process exited immediately after spawn', {
            taskId: task.id,
            pid: claudeProcess.pid
          });
        }
      }, 1000);

      claudeProcess.on('exit', () => {
        processExitedImmediately = true;
        clearTimeout(immediateExitCheck);
      });

      // Track process
      this.activeTasks.set(task.id, claudeProcess);
      task.status = TaskStatus.RUNNING;
      this.taskHistory.set(task.id, task);

      // Create log file for this task
      const logStream = this.createTaskLogFile(task.id);
      logStream.write(`=== Task Execution Log ===\n`);
      logStream.write(`Task ID: ${task.id}\n`);
      logStream.write(`Started: ${task.startTime.toISOString()}\n`);
      logStream.write(`Prompt: ${prompt}\n`);
      logStream.write(`Working Directory: ${workingDir}\n`);
      logStream.write(`\n=== OUTPUT ===\n\n`);

      // Heartbeat-based timeout mechanism
      // Timeout resets whenever we receive output, preventing timeout for active tasks
      let timeoutHandle: NodeJS.Timeout | null = null;

      const killTask = () => {
        if (this.activeTasks.has(task.id)) {
          logger.warn('Task timeout - no output received for timeout duration', {
            taskId: task.id,
            timeoutMs: timeout,
            lastOutputTime: new Date().toISOString()
          });
          claudeProcess.kill('SIGTERM');
          task.status = TaskStatus.TIMEOUT;
        }
      };

      const resetTimeout = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        timeoutHandle = setTimeout(killTask, timeout);
      };

      // Start initial timeout
      resetTimeout();

      // Monitor for initial output within 5 seconds
      let hasReceivedOutput = false;
      const outputCheckTimer = setTimeout(() => {
        if (!hasReceivedOutput) {
          logger.warn('No output received from Claude after 5 seconds', {
            taskId: task.id,
            pid: claudeProcess.pid,
            killed: claudeProcess.killed,
            exitCode: claudeProcess.exitCode
          });
        }
      }, 5000);

      // Handle stdout
      claudeProcess.stdout?.on('data', (data: Buffer) => {
        hasReceivedOutput = true;
        clearTimeout(outputCheckTimer);

        // Reset timeout on activity (heartbeat)
        resetTimeout();

        const chunk = data.toString();
        task.output += chunk;

        // Write to log file
        const logStream = this.taskLogFiles.get(task.id);
        if (logStream) {
          logStream.write(chunk);
        }

        // Limit output size in memory
        if (task.output.length > config.maxOutputSize * 10) {
          task.output = task.output.slice(-config.maxOutputSize * 10);
        }

        logger.info('Task stdout received (timeout reset)', {
          taskId: task.id,
          pid: claudeProcess.pid,
          chunkSize: chunk.length,
          totalOutput: task.output.length,
          preview: chunk.substring(0, 200).replace(/\n/g, '\\n'),
          rawBytes: data.length
        });
      });

      // Handle stderr
      claudeProcess.stderr?.on('data', (data: Buffer) => {
        hasReceivedOutput = true;
        clearTimeout(outputCheckTimer);

        // Reset timeout on activity (heartbeat)
        resetTimeout();

        const chunk = data.toString();
        task.errorOutput += chunk;

        // Write to log file
        const logStream = this.taskLogFiles.get(task.id);
        if (logStream) {
          logStream.write(`[STDERR] ${chunk}`);
        }

        // Limit error output size in memory
        if (task.errorOutput.length > config.maxOutputSize * 10) {
          task.errorOutput = task.errorOutput.slice(-config.maxOutputSize * 10);
        }

        logger.info('Task stderr received (timeout reset)', {
          taskId: task.id,
          pid: claudeProcess.pid,
          chunkSize: chunk.length,
          totalError: task.errorOutput.length,
          preview: chunk.substring(0, 200).replace(/\n/g, '\\n'),
          rawBytes: data.length
        });
      });

      // Monitor stdout end
      claudeProcess.stdout?.on('end', () => {
        logger.info('Claude stdout stream ended', {
          taskId: task.id,
          totalOutput: task.output.length
        });
      });

      // Monitor stderr end
      claudeProcess.stderr?.on('end', () => {
        logger.info('Claude stderr stream ended', {
          taskId: task.id,
          totalError: task.errorOutput.length
        });
      });

      // Handle process completion
      claudeProcess.on('close', (code: number | null) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.activeTasks.delete(task.id);

        task.exitCode = code || 0;
        task.endTime = new Date();

        if (task.status !== TaskStatus.TIMEOUT && task.status !== TaskStatus.CANCELLED) {
          task.status = code === 0 ? TaskStatus.COMPLETED : TaskStatus.FAILED;
        }

        const executionTime = task.endTime.getTime() - task.startTime.getTime();

        // Close log file
        const logStream = this.taskLogFiles.get(task.id);
        if (logStream) {
          logStream.write(`\n\n=== Task Completed ===\n`);
          logStream.write(`Status: ${task.status}\n`);
          logStream.write(`Exit Code: ${code}\n`);
          logStream.write(`Execution Time: ${executionTime}ms\n`);
          logStream.write(`Ended: ${task.endTime.toISOString()}\n`);
          logStream.end();
          this.taskLogFiles.delete(task.id);
        }

        logger.info('Task completed', {
          taskId: task.id,
          status: task.status,
          exitCode: code,
          executionTime: `${executionTime}ms`
        });
      });

      // Handle process errors
      claudeProcess.on('error', (error: Error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.activeTasks.delete(task.id);

        task.status = TaskStatus.FAILED;

        // Provide helpful error messages
        if (error.message.includes('ENOENT') || error.message.includes('not found')) {
          task.errorOutput += `\n❌ Claude Code CLI not found!\n\n`;
          task.errorOutput += `Please install Claude Code first:\n`;
          task.errorOutput += `npm install -g @anthropic-ai/claude-code\n\n`;
          task.errorOutput += `Original error: ${error.message}`;
        } else {
          task.errorOutput += `\nProcess error: ${error.message}`;
        }

        task.endTime = new Date();

        // Close log file
        const logStream = this.taskLogFiles.get(task.id);
        if (logStream) {
          logStream.write(`\n\n=== Task Error ===\n`);
          logStream.write(`Error: ${error.message}\n`);
          logStream.write(`Ended: ${task.endTime.toISOString()}\n`);
          logStream.end();
          this.taskLogFiles.delete(task.id);
        }

        logger.error('Task process error', {
          taskId: task.id,
          error: error.message,
          errorCode: (error as any).code
        });
      });

      return task;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();

      logger.error('Failed to start task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ClaudeTask | undefined {
    return this.taskHistory.get(taskId);
  }

  /**
   * Get all active tasks
   */
  getActiveTasks(): ClaudeTask[] {
    return Array.from(this.taskHistory.values()).filter(
      task => task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING
    );
  }

  /**
   * Get active tasks for a specific user
   */
  getActiveTasksForUser(userId: number): ClaudeTask[] {
    return this.getActiveTasks().filter(task => task.userId === userId);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const process = this.activeTasks.get(taskId);
    const task = this.taskHistory.get(taskId);

    if (!process || !task) {
      return false;
    }

    try {
      process.kill('SIGTERM');
      task.status = TaskStatus.CANCELLED;
      task.endTime = new Date();
      this.activeTasks.delete(taskId);

      logger.info('Task cancelled', { taskId });
      return true;
    } catch (error) {
      logger.error('Failed to cancel task', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Cancel all tasks for a user
   */
  cancelAllTasksForUser(userId: number): number {
    const userTasks = this.getActiveTasksForUser(userId);
    let cancelledCount = 0;

    for (const task of userTasks) {
      if (this.cancelTask(task.id)) {
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  /**
   * Get task count
   */
  getTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Check if user has reached concurrent task limit
   */
  hasReachedConcurrentLimit(userId: number): boolean {
    const userActiveTasks = this.getActiveTasksForUser(userId);
    return userActiveTasks.length >= config.maxConcurrentTasks;
  }

  /**
   * Get task output (truncated to max size)
   */
  getTaskOutput(taskId: string): string {
    const task = this.taskHistory.get(taskId);
    if (!task) {
      return 'Task not found';
    }

    const output = task.output || task.errorOutput || 'No output';
    return output.slice(-config.maxOutputSize);
  }

  /**
   * Check if there are uncommitted changes in the working directory
   */
  async hasUncommittedChanges(workingDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git status --porcelain', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim().length > 0;
    } catch (error) {
      logger.warn('Failed to check git status', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Check if there are unpushed commits in the working directory
   */
  async hasUnpushedCommits(workingDir: string): Promise<boolean> {
    try {
      // Check if there's a remote configured
      const hasRemote = await this.hasRemoteRepository(workingDir);
      if (!hasRemote) {
        // If no remote, check if there are any commits at all
        try {
          await execAsync('git log -1', {
            cwd: workingDir,
            timeout: 5000
          });
          // There are commits but no remote
          return true;
        } catch {
          // No commits at all
          return false;
        }
      }

      // Check if current branch has upstream
      try {
        const { stdout: statusOutput } = await execAsync('git status -sb', {
          cwd: workingDir,
          timeout: 5000
        });

        // If status shows "ahead", there are unpushed commits
        if (statusOutput.includes('ahead')) {
          return true;
        }

        // If no upstream branch is set, check if there are local commits
        if (statusOutput.includes('no upstream')) {
          const { stdout: logOutput } = await execAsync('git log -1', {
            cwd: workingDir,
            timeout: 5000
          });
          return logOutput.trim().length > 0;
        }

        return false;
      } catch (error) {
        logger.warn('Failed to check for unpushed commits', {
          workingDir,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    } catch (error) {
      logger.warn('Failed to check for unpushed commits', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Ensure git identity is configured for the repository
   */
  private async ensureGitIdentity(workingDir: string): Promise<void> {
    try {
      // Check if user name is configured
      const { stdout: userName } = await execAsync('git config user.name', {
        cwd: workingDir,
        timeout: 5000
      });

      if (!userName.trim()) {
        throw new Error('No user name configured');
      }
    } catch {
      // Configure default bot identity
      await execAsync('git config user.name "Claude Telegram Bot"', {
        cwd: workingDir,
        timeout: 5000
      });
      await execAsync('git config user.email "bot@claude-telegram.local"', {
        cwd: workingDir,
        timeout: 5000
      });

      logger.info('Configured git identity for repository', { workingDir });
    }
  }

  /**
   * Auto-commit changes in the working directory
   * Returns commit hash if successful, null otherwise
   */
  async autoCommitChanges(workingDir: string, taskPrompt: string): Promise<string | null> {
    try {
      // Check if there are changes to commit
      const hasChanges = await this.hasUncommittedChanges(workingDir);
      if (!hasChanges) {
        logger.info('No uncommitted changes to commit', { workingDir });
        return null;
      }

      // Ensure git identity is configured
      await this.ensureGitIdentity(workingDir);

      // Stage all changes
      await execAsync('git add .', {
        cwd: workingDir,
        timeout: 10000
      });

      // Generate appropriate commit message using Claude
      const commitMessage = await this.generateCommitMessage(taskPrompt, workingDir);

      // Commit changes (escape double quotes in message)
      const escapedMessage = commitMessage.replace(/"/g, '\\"');
      await execAsync(`git commit -m "${escapedMessage}"`, {
        cwd: workingDir,
        timeout: 10000
      });

      // Get the commit hash
      const { stdout: commitHash } = await execAsync('git rev-parse HEAD', {
        cwd: workingDir,
        timeout: 5000
      });

      const hash = commitHash.trim();

      logger.info('Auto-committed changes', {
        workingDir,
        commitMessage,
        commitHash: hash
      });

      return hash;
    } catch (error) {
      logger.error('Failed to auto-commit changes', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Generate an appropriate commit message using Claude CLI
   */
  private async generateCommitMessage(taskPrompt: string, workingDir: string): Promise<string> {
    try {
      // Get the git diff of staged changes
      const { stdout: gitDiff } = await execAsync('git diff --cached', {
        cwd: workingDir,
        timeout: 10000
      });

      // Get file statistics
      const { stdout: gitStatus } = await execAsync('git status --short', {
        cwd: workingDir,
        timeout: 5000
      });

      // If diff is too large, truncate it
      const maxDiffSize = 8000;
      const diff = gitDiff.length > maxDiffSize
        ? gitDiff.substring(0, maxDiffSize) + '\n\n... (diff truncated)'
        : gitDiff;

      // Create prompt for Claude
      const prompt = `You are a helpful assistant that generates conventional commit messages.

Task that was executed: ${taskPrompt}

Files changed:
${gitStatus}

Git diff:
${diff}

Generate a concise, professional commit message following conventional commits format (type: description).
- Use one of these types: feat, fix, docs, style, refactor, test, chore
- Keep the description under 72 characters
- Be specific about what changed
- Do not add any markdown formatting or extra explanation
- Return ONLY the commit message, nothing else

Example format: "feat: Add user authentication system"`;

      // Use Claude CLI to generate commit message
      const { stdout: claudeResponse } = await execAsync(
        `claude "${prompt.replace(/"/g, '\\"')}"`,
        {
          cwd: workingDir,
          timeout: 30000,
          env: {
            ...process.env,
            ANTHROPIC_API_KEY: config.claudeApiKey || process.env.ANTHROPIC_API_KEY
          }
        }
      );

      const commitMessage = claudeResponse.trim().split('\n')[0] || `chore: ${taskPrompt.substring(0, 72)}`;

      logger.info('Generated commit message with Claude CLI', {
        commitMessage,
        taskPrompt: taskPrompt.substring(0, 50)
      });

      return commitMessage;
    } catch (error) {
      logger.error('Failed to generate commit message with Claude CLI, using fallback', {
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to simple message if Claude fails
      return `chore: ${taskPrompt.substring(0, 72)}`;
    }
  }

  /**
   * Check if remote repository exists
   */
  async hasRemoteRepository(workingDir: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync('git remote -v', {
        cwd: workingDir,
        timeout: 5000
      });
      return stdout.trim().length > 0;
    } catch (error) {
      logger.warn('Failed to check remote repository', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Auto-push changes to remote repository
   * Returns: 'success' | 'no_remote' | 'failed' | 'no_changes'
   */
  async autoPushChanges(workingDir: string): Promise<'success' | 'no_remote' | 'failed' | 'no_changes'> {
    try {
      // Check if remote exists
      const hasRemote = await this.hasRemoteRepository(workingDir);
      if (!hasRemote) {
        logger.info('No remote repository configured', { workingDir });
        return 'no_remote';
      }

      // Get current remote URL
      const { stdout: remoteUrl } = await execAsync('git config --get remote.origin.url', {
        cwd: workingDir,
        timeout: 5000
      });

      const currentRemoteUrl = remoteUrl.trim();
      logger.info('Current remote URL', {
        workingDir,
        hasAuth: currentRemoteUrl.includes('@github.com'),
        isHttps: currentRemoteUrl.startsWith('https://')
      });

      // Inject GitHub token if needed
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken && currentRemoteUrl.includes('github.com') && !currentRemoteUrl.includes('@github.com')) {
        logger.info('Injecting GitHub token into remote URL for push', { workingDir });

        // Convert to authenticated URL
        let authenticatedUrl = currentRemoteUrl;

        // Convert SSH to HTTPS if needed
        if (authenticatedUrl.startsWith('git@github.com:')) {
          authenticatedUrl = authenticatedUrl.replace('git@github.com:', 'https://github.com/');
        }

        // Inject token
        if (authenticatedUrl.startsWith('https://github.com/')) {
          authenticatedUrl = authenticatedUrl.replace(
            'https://github.com/',
            `https://x-access-token:${githubToken}@github.com/`
          );

          // Update remote URL temporarily
          await execAsync(`git remote set-url origin "${authenticatedUrl}"`, {
            cwd: workingDir,
            timeout: 5000
          });

          logger.info('Updated remote URL with authentication', { workingDir });
        }
      }

      // Get current branch
      const { stdout: branchOutput } = await execAsync('git branch --show-current', {
        cwd: workingDir,
        timeout: 5000
      });
      const currentBranch = branchOutput.trim();

      logger.info('Attempting to push changes', {
        workingDir,
        branch: currentBranch
      });

      // Check if there are commits to push
      try {
        const { stdout: statusOutput } = await execAsync('git status -sb', {
          cwd: workingDir,
          timeout: 5000
        });

        logger.info('Git status before push', {
          workingDir,
          status: statusOutput.trim()
        });

        // If status shows "ahead", there are commits to push
        if (!statusOutput.includes('ahead')) {
          logger.info('No commits to push', { workingDir });
          return 'no_changes';
        }
      } catch (statusError) {
        // Continue with push attempt even if status check fails
        logger.warn('Could not check git status', {
          workingDir,
          error: statusError instanceof Error ? statusError.message : String(statusError)
        });
      }

      // Try to push with upstream set (in case branch has no upstream)
      try {
        const { stdout: pushOutput, stderr: pushStderr } = await execAsync(
          `git push -u origin ${currentBranch}`,
          {
            cwd: workingDir,
            timeout: 30000,
            env: {
              ...process.env,
              GIT_TERMINAL_PROMPT: '0'
            }
          }
        );

        logger.info('Auto-pushed changes successfully', {
          workingDir,
          branch: currentBranch,
          stdout: pushOutput.trim(),
          stderr: pushStderr.trim()
        });

        return 'success';
      } catch (pushError: any) {
        const errorMessage = pushError.message || String(pushError);
        const stderr = pushError.stderr || '';

        logger.error('Push command failed', {
          workingDir,
          branch: currentBranch,
          error: errorMessage,
          stderr: stderr,
          stdout: pushError.stdout || ''
        });

        // Check for specific error cases
        if (errorMessage.includes('No configured push destination') ||
            errorMessage.includes('no upstream branch') ||
            stderr.includes('No configured push destination')) {
          return 'no_remote';
        }

        if (errorMessage.includes('Everything up-to-date') ||
            stderr.includes('Everything up-to-date')) {
          logger.info('Repository already up to date', { workingDir });
          return 'no_changes';
        }

        if (errorMessage.includes('403') || stderr.includes('403') ||
            errorMessage.includes('Permission denied') || stderr.includes('Permission denied')) {
          logger.error('Push failed due to authentication/permission', {
            workingDir,
            hasToken: !!process.env.GITHUB_TOKEN
          });
        }

        // Return failed for other errors (auth, network, etc.)
        return 'failed';
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      logger.error('Failed to auto-push changes', {
        workingDir,
        error: errorMessage
      });
      return 'failed';
    }
  }

  /**
   * Create GitHub repository using gh CLI
   * @param workingDir - Working directory path
   * @param isPrivate - Whether repository should be private
   * @param customRepoName - Optional custom repository name (defaults to directory basename)
   * @returns 'success' if created, 'already_exists' if repo exists, 'error' otherwise
   */
  async createGitHubRepository(workingDir: string, isPrivate: boolean = false, customRepoName?: string): Promise<'success' | 'already_exists' | 'error'> {
    try {
      // Get repository name from working directory or use custom name
      const path = require('path');
      const repoName = customRepoName || path.basename(workingDir);

      // Create repository using gh CLI
      const visibility = isPrivate ? '--private' : '--public';
      await execAsync(`gh repo create ${repoName} ${visibility} --source=. --remote=origin --push`, {
        cwd: workingDir,
        timeout: 30000
      });

      logger.info('Created GitHub repository', {
        workingDir,
        repoName,
        visibility
      });

      return 'success';
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if repository already exists
      if (errorMessage.includes('Name already exists on this account')) {
        logger.info('Repository name already exists on GitHub', {
          workingDir,
          attemptedName: customRepoName || require('path').basename(workingDir)
        });

        // Return 'already_exists' so the caller can prompt for a new name
        return 'already_exists';
      }

      logger.error('Failed to create GitHub repository', {
        workingDir,
        error: errorMessage
      });
      return 'error';
    }
  }

  /**
   * Clean up old completed tasks
   */
  cleanupOldTasks(maxAge: number = 3600000): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [taskId, task] of this.taskHistory.entries()) {
      if (
        task.status !== TaskStatus.RUNNING &&
        task.status !== TaskStatus.PENDING &&
        task.endTime &&
        now - task.endTime.getTime() > maxAge
      ) {
        this.taskHistory.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old tasks', { count: cleanedCount });
    }

    return cleanedCount;
  }
}

export default ClaudeExecutor;
