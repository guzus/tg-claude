import { spawn, ChildProcess } from 'child_process';
import { TaskStatus, AIProviderConfig, StreamEvent, StreamAction, ClaudeTaskWithStreaming, McpServer, ImageContent } from '../types';
import { config, WORKSPACE_PATH, LOGS_PATH } from '../config';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { configureProviderEnv } from '../utils/ClaudeRunner';
import { gitService } from './GitService';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { StreamingOutputParser } from './StreamingOutputParser';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);
const TASK_LOGS_DIR = path.join(LOGS_PATH, 'tasks');

/**
 * @deprecated CLI mode is not maintained. Use AnthropicSdkExecutor (SDK mode) instead.
 * Set EXECUTOR_TYPE=sdk in your environment to use the SDK executor.
 */
export class ClaudeExecutor extends EventEmitter {
  private activeTasks: Map<string, ChildProcess> = new Map();
  private taskHistory: Map<string, ClaudeTaskWithStreaming> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();
  private taskParsers: Map<string, StreamingOutputParser> = new Map();
  private taskInitialHeads: Map<string, string> = new Map();  // Store initial HEAD per task

  constructor() {
    super();
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
      await execAsync('gh auth setup-git', { timeout: 10000 });
      logger.info('Authenticated with GitHub CLI');
    } catch {
      // GitHub auth is optional
    }
  }

  private createTask(
    userId: number,
    chatId: number,
    prompt: string,
    workingDir: string
  ): ClaudeTaskWithStreaming {
    const task: ClaudeTaskWithStreaming = {
      id: uuidv4(),
      userId,
      chatId,
      prompt,
      workingDir,
      status: TaskStatus.PENDING,
      startTime: new Date(),
      output: '',
      errorOutput: '',
      actions: [],
      events: []
    };

    this.taskHistory.set(task.id, task);
    return task;
  }

  startTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: { workingDir?: string; dangerMode?: boolean; additionalFlags?: string[]; timeout?: number; aiProvider?: AIProviderConfig; mcpServers?: Record<string, McpServer>; images?: ImageContent[] } = {}
  ): ClaudeTaskWithStreaming {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);

    // CLI mode doesn't support images - log warning if images were provided
    if (options.images && options.images.length > 0) {
      logger.warn('CLI executor does not support image inputs. Use SDK executor (EXECUTOR_TYPE=sdk) for image support.', { taskId: task.id });
    }

    void this.runTask(task, options).catch((error) => {
      logger.error('Task execution failed', { taskId: task.id, error: getErrorMessage(error) });
    });

    return task;
  }

  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: { workingDir?: string; dangerMode?: boolean; additionalFlags?: string[]; timeout?: number; aiProvider?: AIProviderConfig; mcpServers?: Record<string, McpServer>; images?: ImageContent[] } = {}
  ): Promise<ClaudeTaskWithStreaming> {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);
    await this.runTask(task, options);
    return task;
  }

  private async runTask(
    task: ClaudeTaskWithStreaming,
    options: { workingDir?: string; dangerMode?: boolean; additionalFlags?: string[]; timeout?: number; aiProvider?: AIProviderConfig; mcpServers?: Record<string, McpServer> }
  ): Promise<void> {
    const {
      workingDir = task.workingDir,
      dangerMode = true,
      additionalFlags = [],
      timeout = config.taskTimeoutMs,
      aiProvider
    } = options;

    logger.info('Starting task', { taskId: task.id, userId: task.userId, prompt: task.prompt.substring(0, 100) });

    try {
      await this.authenticateGitHub();

      if (!fs.existsSync(workingDir)) {
        throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
      }

      // Store initial HEAD to track commits made during task
      try {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDir, timeout: 5000 });
        this.taskInitialHeads.set(task.id, stdout.trim());
      } catch {
        // Not a git repo or no commits yet - ignore
      }

      // Configure AI provider environment variables (pass full config for custom models)
      const provider = aiProvider?.provider || 'anthropic';
      const env = configureProviderEnv(provider, aiProvider);

      // Use --output-format stream-json for structured streaming output
      const args = [
        '-p',  // Print mode (non-interactive)
        '--output-format', 'stream-json',  // Enable JSON streaming
        '--verbose',  // Include detailed events
        ...(dangerMode ? ['--dangerously-skip-permissions'] : []),
        ...additionalFlags,
        '--',  // Separator before prompt
        task.prompt
      ];

      logger.info('Using AI provider', { provider });

      const claudeProcess = spawn('claude', args, {
        cwd: workingDir,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false
      });

      claudeProcess.stdin?.end();

      if (!claudeProcess.pid) {
        throw new Error('Failed to spawn Claude process');
      }

      this.activeTasks.set(task.id, claudeProcess);
      task.status = TaskStatus.RUNNING;

      // Create streaming parser for this task
      const parser = new StreamingOutputParser();
      this.taskParsers.set(task.id, parser);

      const logStream = this.createTaskLogFile(task.id);
      logStream.write(`=== Task: ${task.id} | ${task.startTime.toISOString()} ===\n`);
      logStream.write(`Prompt: ${task.prompt}\nWorkingDir: ${workingDir}\n\n`);

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

        // Parse streaming JSON events
        const taskParser = this.taskParsers.get(task.id);
        if (taskParser) {
          const events = taskParser.processChunk(chunk);
          for (const event of events) {
            task.events.push(event);

            // Update task metadata based on events
            if (event.type === 'started') {
              task.sessionId = event.sessionId;
            } else if (event.type === 'action') {
              if (event.phase === 'started') {
                task.currentAction = event.action;
                task.actions.push(event.action);
              } else if (event.phase === 'completed') {
                task.currentAction = undefined;
              }
            } else if (event.type === 'completed') {
              task.costUsd = event.costUsd;
            }

            // Emit event for real-time listeners
            this.emit('streamEvent', task.id, event);
          }
        }

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
        this.taskParsers.delete(task.id);

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

        // Emit completion event
        this.emit('taskComplete', task.id, task);

        logger.info('Task completed', {
          taskId: task.id,
          status: task.status,
          exitCode: code,
          actionsCount: task.actions.length,
          costUsd: task.costUsd
        });
      });

      claudeProcess.on('error', (error: Error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.activeTasks.delete(task.id);
        this.taskParsers.delete(task.id);

        task.status = TaskStatus.FAILED;
        task.errorOutput += error.message.includes('ENOENT')
          ? '\nClaude Code CLI not found! Install: npm install -g @anthropic-ai/claude-code'
          : `\nProcess error: ${error.message}`;
        task.endTime = new Date();

        this.taskLogFiles.get(task.id)?.end();
        this.taskLogFiles.delete(task.id);

        // Emit error event
        this.emit('taskError', task.id, error);
      });

    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = getErrorMessage(error);
      task.endTime = new Date();
      throw error;
    }
  }

  getTask(taskId: string): ClaudeTaskWithStreaming | undefined {
    return this.taskHistory.get(taskId);
  }

  setTaskMessageId(taskId: string, messageId: number): void {
    const task = this.taskHistory.get(taskId);
    if (!task) return;
    task.messageId = messageId;
  }

  getActiveTasks(): ClaudeTaskWithStreaming[] {
    return Array.from(this.taskHistory.values()).filter(
      task => task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING
    );
  }

  getActiveTasksForUser(userId: number): ClaudeTaskWithStreaming[] {
    return this.getActiveTasks().filter(task => task.userId === userId);
  }

  /**
   * Get current action being executed for a task
   */
  getCurrentAction(taskId: string): StreamAction | undefined {
    const task = this.taskHistory.get(taskId);
    return task?.currentAction;
  }

  /**
   * Get all actions completed for a task
   */
  getTaskActions(taskId: string): StreamAction[] {
    const task = this.taskHistory.get(taskId);
    return task?.actions || [];
  }

  /**
   * Get recent events for a task
   */
  getRecentEvents(taskId: string, limit: number = 10): StreamEvent[] {
    const task = this.taskHistory.get(taskId);
    if (!task) return [];
    return task.events.slice(-limit);
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

  // Task-specific git tracking
  async getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>> {
    const initialHead = this.taskInitialHeads.get(taskId);
    if (!initialHead) return [];
    return gitService.getCommitsSince(workingDir, initialHead);
  }

  cleanupTaskHead(taskId: string): void {
    this.taskInitialHeads.delete(taskId);
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

  // Session management stubs (CLI mode doesn't support session resumption)
  clearChatSession(_chatId: number): boolean {
    return false;
  }

  getChatSessionId(_chatId: number): string | undefined {
    return undefined;
  }
}
