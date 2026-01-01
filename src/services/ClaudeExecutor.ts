import { spawn, ChildProcess } from 'child_process';
import { ClaudeTask, TaskStatus, AIProviderConfig, AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS } from '../types';
import { config, WORKSPACE_PATH } from '../config';
import { logger } from '../utils/logger';
import { gitService } from './GitService';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const TASK_LOGS_DIR = path.join(process.cwd(), 'logs', 'tasks');

export class ClaudeExecutor {
  private activeTasks: Map<string, ChildProcess> = new Map();
  private taskHistory: Map<string, ClaudeTask> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();

  constructor() {
    if (!fs.existsSync(TASK_LOGS_DIR)) {
      fs.mkdirSync(TASK_LOGS_DIR, { recursive: true });
    }
  }

  private createTaskLogFile(taskId: string): fs.WriteStream {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logFileName = `task_${taskId.substring(0, 8)}_${timestamp}.log`;
    const logFilePath = path.join(TASK_LOGS_DIR, logFileName);

    const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    this.taskLogFiles.set(taskId, logStream);
    return logStream;
  }

  getTaskLogFilePath(taskId: string): string | null {
    const task = this.taskHistory.get(taskId);
    if (!task) return null;

    const timestamp = task.startTime.toISOString().replace(/[:.]/g, '-');
    const logFileName = `task_${taskId.substring(0, 8)}_${timestamp}.log`;
    const logFilePath = path.join(TASK_LOGS_DIR, logFileName);

    return fs.existsSync(logFilePath) ? logFilePath : null;
  }

  private async authenticateGitHub(): Promise<void> {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) return;

    try {
      await execAsync('which gh');
      await execAsync(`echo "${githubToken}" | gh auth login --with-token`, { timeout: 10000 });
      logger.info('Authenticated with GitHub CLI');
    } catch {
      // GitHub auth is optional
    }
  }

  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: { workingDir?: string; dangerMode?: boolean; additionalFlags?: string[]; timeout?: number; aiProvider?: AIProviderConfig } = {}
  ): Promise<ClaudeTask> {
    const {
      workingDir = WORKSPACE_PATH,
      dangerMode = true,
      additionalFlags = [],
      timeout = config.taskTimeoutMs,
      aiProvider
    } = options;

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

    logger.info('Starting task', { taskId: task.id, userId, prompt: prompt.substring(0, 100) });

    try {
      await this.authenticateGitHub();

      if (!fs.existsSync(workingDir)) {
        throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
      }

      const isRoot = process.getuid && process.getuid() === 0;
      const args = [prompt, ...(dangerMode ? ['--dangerously-skip-permissions'] : []), ...additionalFlags];

      const env = { ...process.env };
      if (isRoot) {
        env.IS_SANDBOX = '1';
        env.CLAUDE_AUTO_APPROVE = '1';
        env.CI = 'true';
      }

      // Configure AI provider environment variables
      if (aiProvider?.provider && aiProvider.provider !== 'anthropic') {
        const baseUrl = AI_PROVIDER_ENDPOINTS[aiProvider.provider];
        if (baseUrl) {
          env.ANTHROPIC_BASE_URL = baseUrl;
          logger.info('Using AI provider', { provider: aiProvider.provider, baseUrl });
        }

        // Set GLM-specific configuration per Z.ai docs
        if (aiProvider.provider === 'glm') {
          // Z.ai uses ANTHROPIC_AUTH_TOKEN instead of ANTHROPIC_API_KEY
          if (aiProvider.apiKey) {
            env.ANTHROPIC_AUTH_TOKEN = aiProvider.apiKey;
          }
          // Set extended timeout for reliability
          env.API_TIMEOUT_MS = '3000000';
          // Set GLM model mappings for Claude Code's internal model slots
          env.ANTHROPIC_DEFAULT_HAIKU_MODEL = GLM_MODEL_MAPPINGS.haiku;
          env.ANTHROPIC_DEFAULT_SONNET_MODEL = GLM_MODEL_MAPPINGS.sonnet;
          env.ANTHROPIC_DEFAULT_OPUS_MODEL = GLM_MODEL_MAPPINGS.opus;
          logger.info('GLM configured', { baseUrl, models: GLM_MODEL_MAPPINGS });
        } else if (aiProvider.apiKey) {
          env.ANTHROPIC_API_KEY = aiProvider.apiKey;
        }
      } else {
        // Default to Anthropic with Opus model
        env.ANTHROPIC_MODEL = 'opus';
        logger.info('Using Anthropic provider', { model: 'opus' });
      }

      const claudeProcess = spawn('claude', args, {
        cwd: workingDir,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      if (isRoot && claudeProcess.stdin) {
        claudeProcess.stdin.write('y\n');
        claudeProcess.stdin.write('yes\n');
        claudeProcess.stdin.write('y\n');
        setTimeout(() => claudeProcess.stdin?.end(), 100);
      } else {
        claudeProcess.stdin?.end();
      }

      if (!claudeProcess.pid) {
        throw new Error('Failed to spawn Claude process');
      }

      this.activeTasks.set(task.id, claudeProcess);
      task.status = TaskStatus.RUNNING;
      this.taskHistory.set(task.id, task);

      const logStream = this.createTaskLogFile(task.id);
      logStream.write(`=== Task: ${task.id} | ${task.startTime.toISOString()} ===\n`);
      logStream.write(`Prompt: ${prompt}\nWorkingDir: ${workingDir}\n\n`);

      let timeoutHandle: NodeJS.Timeout | null = null;

      const resetTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          if (this.activeTasks.has(task.id)) {
            logger.warn('Task timeout', { taskId: task.id });
            claudeProcess.kill('SIGTERM');
            task.status = TaskStatus.TIMEOUT;
          }
        }, timeout);
      };

      resetTimeout();

      claudeProcess.stdout?.on('data', (data: Buffer) => {
        resetTimeout();
        const chunk = data.toString();
        task.output += chunk;
        this.taskLogFiles.get(task.id)?.write(chunk);

        if (task.output.length > config.maxOutputSize * 10) {
          task.output = task.output.slice(-config.maxOutputSize * 10);
        }
      });

      claudeProcess.stderr?.on('data', (data: Buffer) => {
        resetTimeout();
        const chunk = data.toString();
        task.errorOutput += chunk;
        this.taskLogFiles.get(task.id)?.write(`[STDERR] ${chunk}`);

        if (task.errorOutput.length > config.maxOutputSize * 10) {
          task.errorOutput = task.errorOutput.slice(-config.maxOutputSize * 10);
        }
      });

      claudeProcess.on('close', (code: number | null) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.activeTasks.delete(task.id);

        task.exitCode = code || 0;
        task.endTime = new Date();

        if (task.status !== TaskStatus.TIMEOUT && task.status !== TaskStatus.CANCELLED) {
          task.status = code === 0 ? TaskStatus.COMPLETED : TaskStatus.FAILED;
        }

        const logStream = this.taskLogFiles.get(task.id);
        if (logStream) {
          logStream.write(`\n=== Completed: ${task.status} | Code: ${code} ===\n`);
          logStream.end();
          this.taskLogFiles.delete(task.id);
        }

        logger.info('Task completed', { taskId: task.id, status: task.status, exitCode: code });
      });

      claudeProcess.on('error', (error: Error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.activeTasks.delete(task.id);

        task.status = TaskStatus.FAILED;
        task.errorOutput += error.message.includes('ENOENT')
          ? '\nClaude Code CLI not found! Install: npm install -g @anthropic-ai/claude-code'
          : `\nProcess error: ${error.message}`;
        task.endTime = new Date();

        this.taskLogFiles.get(task.id)?.end();
        this.taskLogFiles.delete(task.id);
      });

      return task;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();
      throw error;
    }
  }

  getTask(taskId: string): ClaudeTask | undefined {
    return this.taskHistory.get(taskId);
  }

  getActiveTasks(): ClaudeTask[] {
    return Array.from(this.taskHistory.values()).filter(
      task => task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING
    );
  }

  getActiveTasksForUser(userId: number): ClaudeTask[] {
    return this.getActiveTasks().filter(task => task.userId === userId);
  }

  cancelTask(taskId: string): boolean {
    const process = this.activeTasks.get(taskId);
    const task = this.taskHistory.get(taskId);

    if (!process || !task) return false;

    try {
      process.kill('SIGTERM');
      task.status = TaskStatus.CANCELLED;
      task.endTime = new Date();
      this.activeTasks.delete(taskId);
      logger.info('Task cancelled', { taskId });
      return true;
    } catch {
      return false;
    }
  }

  cancelAllTasksForUser(userId: number): number {
    return this.getActiveTasksForUser(userId)
      .filter(task => this.cancelTask(task.id))
      .length;
  }

  getTaskCount(): number {
    return this.activeTasks.size;
  }

  hasReachedConcurrentLimit(userId: number): boolean {
    return this.getActiveTasksForUser(userId).length >= config.maxConcurrentTasks;
  }

  getTaskOutput(taskId: string): string {
    const task = this.taskHistory.get(taskId);
    if (!task) return 'Task not found';
    return (task.output || task.errorOutput || '').slice(-config.maxOutputSize);
  }

  // Git operations delegated to GitService
  async hasUncommittedChanges(workingDir: string): Promise<boolean> {
    return gitService.hasUncommittedChanges(workingDir);
  }

  async hasUnpushedCommits(workingDir: string): Promise<boolean> {
    return gitService.hasUnpushedCommits(workingDir);
  }

  async hasRemoteRepository(workingDir: string): Promise<boolean> {
    return gitService.hasRemote(workingDir);
  }

  async autoCommitChanges(workingDir: string): Promise<string | null> {
    const message = await this.generateCommitMessage(workingDir);
    const result = await gitService.commit(workingDir, message);
    return result.success ? result.hash : null;
  }

  private async generateCommitMessage(workingDir: string): Promise<string> {
    try {
      const { stdout: gitDiff } = await execAsync('git diff HEAD', { cwd: workingDir, timeout: 10000 });
      const { stdout: gitStatus } = await execAsync('git status --short', { cwd: workingDir, timeout: 5000 });

      const diff = gitDiff.length > 8000 ? gitDiff.substring(0, 8000) + '\n...(truncated)' : gitDiff;

      const prompt = `Analyze changes and generate a conventional commit message (feat/fix/docs/etc). Files: ${gitStatus}\nDiff: ${diff}\n\nReturn ONLY the commit message.`;

      const { stdout } = await execAsync(`claude "${prompt.replace(/"/g, '\\"')}"`, {
        cwd: workingDir,
        timeout: 30000
      });

      return stdout.trim().split('\n')[0] || 'chore: Update code';
    } catch {
      return 'chore: Update code';
    }
  }

  async autoPushChanges(workingDir: string): Promise<'success' | 'no_remote' | 'failed' | 'no_changes'> {
    const result = await gitService.push(workingDir);
    return result.status;
  }

  async createGitHubRepository(
    workingDir: string,
    isPrivate: boolean = false,
    customRepoName?: string
  ): Promise<'success' | 'already_exists' | 'error'> {
    try {
      const repoName = customRepoName || path.basename(workingDir);
      const visibility = isPrivate ? '--private' : '--public';

      await execAsync(`gh repo create ${repoName} ${visibility} --source=. --remote=origin --push`, {
        cwd: workingDir,
        timeout: 30000
      });

      logger.info('Created GitHub repository', { repoName, visibility });
      return 'success';
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Name already exists')) return 'already_exists';
      logger.error('Failed to create GitHub repository', { error: errMsg });
      return 'error';
    }
  }

  cleanupOldTasks(maxAge: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [taskId, task] of this.taskHistory.entries()) {
      if (
        task.status !== TaskStatus.RUNNING &&
        task.status !== TaskStatus.PENDING &&
        task.endTime &&
        now - task.endTime.getTime() > maxAge
      ) {
        this.taskHistory.delete(taskId);
        cleaned++;
      }
    }

    if (cleaned > 0) logger.info('Cleaned old tasks', { count: cleaned });
    return cleaned;
  }
}

export default ClaudeExecutor;
