import { spawn, ChildProcess } from 'child_process';
import { TaskStatus, AIProviderConfig, StreamEvent, StreamAction, ClaudeTaskWithStreaming } from '../types';
import { config, WORKSPACE_PATH } from '../config';
import { logger } from '../utils/logger';
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
const TASK_LOGS_DIR = path.join(process.cwd(), 'logs', 'tasks');

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
  ): Promise<ClaudeTaskWithStreaming> {
    const {
      workingDir = WORKSPACE_PATH,
      dangerMode = true,
      additionalFlags = [],
      timeout = config.taskTimeoutMs,
      aiProvider
    } = options;

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

    logger.info('Starting task', { taskId: task.id, userId, prompt: prompt.substring(0, 100) });

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

      const isRoot = process.getuid && process.getuid() === 0;
      // Use --output-format stream-json for structured streaming output
      const args = [
        '-p',  // Print mode (non-interactive)
        '--output-format', 'stream-json',  // Enable JSON streaming
        '--verbose',  // Include detailed events
        ...(dangerMode ? ['--dangerously-skip-permissions'] : []),
        ...additionalFlags,
        '--',  // Separator before prompt
        prompt
      ];

      // Configure AI provider environment variables
      const provider = aiProvider?.provider || 'anthropic';
      const env = configureProviderEnv(provider, aiProvider?.apiKey);
      
      // Override for default Anthropic to use opus model
      if (provider === 'anthropic') {
        env.ANTHROPIC_MODEL = 'opus';
      }
      
      if (isRoot) {
        env.IS_SANDBOX = '1';
        env.CLAUDE_AUTO_APPROVE = '1';
        env.CI = 'true';
      }
      
      logger.info('Using AI provider', { provider });

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

      // Create streaming parser for this task
      const parser = new StreamingOutputParser();
      this.taskParsers.set(task.id, parser);

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

      return task;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();
      throw error;
    }
  }

  getTask(taskId: string): ClaudeTaskWithStreaming | undefined {
    return this.taskHistory.get(taskId);
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

  /**
   * Get commits made during task execution
   */
  async getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>> {
    const initialHead = this.taskInitialHeads.get(taskId);
    if (!initialHead) return [];

    try {
      // Get all commits since initial HEAD (excluding the initial HEAD itself)
      const { stdout } = await execAsync(
        `git log ${initialHead}..HEAD --format="%H|%s" --reverse`,
        { cwd: workingDir, timeout: 10000 }
      );

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
   * Clean up task initial HEAD tracking
   */
  cleanupTaskHead(taskId: string): void {
    this.taskInitialHeads.delete(taskId);
  }

  private async generateCommitMessage(workingDir: string): Promise<string> {
    try {
      const { stdout: gitStatus } = await execAsync('git status --short', { cwd: workingDir, timeout: 5000 });

      if (!gitStatus.trim()) {
        return 'chore: update code';
      }

      // Get detailed diff for context (limit to prevent overly long prompts)
      let diffContent = '';
      try {
        // Get diff for staged and unstaged changes
        const { stdout: stagedDiff } = await execAsync('git diff --cached', { cwd: workingDir, timeout: 10000 });
        const { stdout: unstagedDiff } = await execAsync('git diff', { cwd: workingDir, timeout: 10000 });
        diffContent = (stagedDiff + unstagedDiff).substring(0, 3000); // Limit diff size
      } catch {
        // Fallback to stat if full diff fails
        const { stdout: statDiff } = await execAsync('git diff HEAD --stat', { cwd: workingDir, timeout: 10000 });
        diffContent = statDiff;
      }

      // Parse file changes from git status properly
      // Format: "XY filename" or "XY old -> new" for renames
      const fileChanges = gitStatus.trim().split('\n').map(line => {
        const match = line.match(/^(.{1,2})\s+(.+)$/);
        if (!match) return line.trim();
        const [, status, filePath] = match;
        // Handle rename format "old -> new"
        const file = filePath.includes(' -> ') ? filePath.split(' -> ')[1] : filePath;
        const statusDesc = status.includes('A') ? 'added' :
                          status.includes('M') ? 'modified' :
                          status.includes('D') ? 'deleted' :
                          status.includes('R') ? 'renamed' :
                          status.includes('?') ? 'new' : 'changed';
        return `${file} (${statusDesc})`;
      }).join(', ');

      // Create a detailed prompt with actual diff content
      const prompt = `Analyze these git changes and generate a conventional commit message.

FILES CHANGED:
${fileChanges}

DIFF CONTENT:
${diffContent || 'No diff available'}

Generate ONE commit message following this format:
type(scope): brief description

Rules:
- Types: feat (new feature), fix (bug fix), refactor, docs, style, test, chore
- Scope is optional but helpful (e.g., api, ui, auth)
- Description should explain WHAT changed and WHY
- Keep under 72 characters total
- Be specific about the actual changes, not generic

Reply with ONLY the commit message, nothing else.`;

      // Use Claude Haiku with proper escaping
      const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      const { stdout } = await execAsync(
        `claude -p --model haiku $'${escapedPrompt}'`,
        {
          cwd: workingDir,
          timeout: 30000,
          env: { ...process.env },
          shell: '/bin/bash'
        }
      );

      // Parse output - handle JSON stream format if present
      let message = '';
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Try to parse as JSON (stream format)
        try {
          const json = JSON.parse(trimmed);
          if (json.type === 'result' && json.result) {
            message = json.result.trim();
            break;
          }
        } catch {
          // Not JSON, might be plain text output
          // Look for conventional commit pattern
          if (/^(feat|fix|refactor|docs|style|test|chore|build|ci|perf)(\(.+?\))?:/.test(trimmed)) {
            message = trimmed;
            break;
          }
        }
      }

      // If no valid message found, try last non-empty line
      if (!message) {
        message = lines.filter(l => l.trim()).pop() || '';
      }

      // Clean up the message
      message = message
        .replace(/^["'`]|["'`]$/g, '')  // Remove quotes
        .replace(/^\*\*|\*\*$/g, '')     // Remove markdown bold
        .trim();

      // Validate it looks like a commit message
      if (message.length < 5 || message.length > 100 || message.includes('\n')) {
        // Fallback: generate basic message from file names
        const firstLine = gitStatus.trim().split('\n')[0] || '';
        const fileMatch = firstLine.match(/^.{1,2}\s+(.+)$/);
        const firstFile = fileMatch ? fileMatch[1] : 'files';
        return `chore: update ${path.basename(firstFile)}`;
      }

      logger.debug('Generated commit message', { message });
      return message;
    } catch (error) {
      logger.debug('Commit message generation failed', { error: error instanceof Error ? error.message : String(error) });
      // Fallback with file context
      try {
        const { stdout: status } = await execAsync('git status --short', { cwd: workingDir, timeout: 5000 });
        const firstLine = status.trim().split('\n')[0] || '';
        const fileMatch = firstLine.match(/^.{1,2}\s+(.+)$/);
        const firstFile = fileMatch ? fileMatch[1] : 'files';
        return `chore: update ${path.basename(firstFile)}`;
      } catch {
        return 'chore: update code';
      }
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
