import { unstable_v2_createSession, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import {
  TaskStatus,
  AIProviderConfig,
  StreamEvent,
  StreamAction,
  ClaudeTaskWithStreaming,
} from '../types';
import { config, WORKSPACE_PATH, LOGS_PATH } from '../config';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { gitService } from './GitService';

const execAsync = promisify(exec);
const TASK_LOGS_DIR = path.join(LOGS_PATH, 'tasks');

// Type guards for SDK message types
interface SDKAssistantMessage {
  type: 'assistant';
  uuid: string;
  session_id: string;
  message: {
    content: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
}

interface SDKResultMessage {
  type: 'result';
  subtype: string;
  session_id: string;
  duration_ms: number;
  is_error: boolean;
  num_turns: number;
  result?: string;
  total_cost_usd?: number;
  errors?: string[];
}

interface SDKSystemMessage {
  type: 'system';
  subtype: string;
  session_id: string;
  tools?: string[];
  model?: string;
}

function isAssistantMessage(msg: SDKMessage): msg is SDKAssistantMessage {
  return msg.type === 'assistant';
}

function isResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result';
}

function isSystemMessage(msg: SDKMessage): msg is SDKSystemMessage {
  return msg.type === 'system';
}

export class AnthropicSdkExecutor extends EventEmitter {
  private activeTasks: Map<string, AbortController> = new Map();
  private taskHistory: Map<string, ClaudeTaskWithStreaming> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();
  private taskInitialHeads: Map<string, string> = new Map();
  private actionCounter = 0;

  constructor(_apiKey?: string) {
    super();
    // The Claude Agent SDK uses Claude Code CLI authentication automatically
    // or ANTHROPIC_API_KEY environment variable
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

  /**
   * Get the model name based on provider config
   */
  private getModel(aiProvider?: AIProviderConfig): string {
    const provider = aiProvider?.provider || 'anthropic';
    if (provider === 'openrouter') {
      return aiProvider?.sonnetModel || 'anthropic/claude-sonnet-4-20250514';
    }
    if (provider === 'glm') {
      return aiProvider?.sonnetModel || 'GLM-4.7';
    }
    return 'claude-sonnet-4-20250514';
  }

  private createAction(kind: string, detail: Record<string, unknown>): StreamAction {
    this.actionCounter++;
    const mappedKind = this.mapToolToKind(kind);
    const title = this.generateActionTitle(kind, detail);
    return {
      id: `action-${this.actionCounter}`,
      kind: mappedKind,
      title,
      detail,
    };
  }

  private mapToolToKind(toolName: string): 'command' | 'tool' | 'file_change' | 'web_search' | 'note' | 'turn' | 'warning' | 'telemetry' {
    const lowerName = toolName.toLowerCase();
    if (lowerName === 'bash' || lowerName === 'command') return 'command';
    if (['write', 'edit', 'write_file', 'edit_file'].includes(lowerName)) return 'file_change';
    if (['read', 'glob', 'grep', 'read_file', 'list_directory'].includes(lowerName)) return 'tool';
    if (lowerName === 'web_search') return 'web_search';
    return 'tool';
  }

  private generateActionTitle(toolName: string, input: Record<string, unknown>): string {
    const lowerName = toolName.toLowerCase();
    switch (lowerName) {
      case 'bash':
      case 'command': {
        const cmd = String(input.command || '').substring(0, 60);
        return `$ ${cmd}${String(input.command || '').length > 60 ? '...' : ''}`;
      }
      case 'read':
      case 'read_file':
        return `Read ${input.file_path || input.path || ''}`;
      case 'write':
      case 'write_file':
        return `Write ${input.file_path || input.path || ''}`;
      case 'edit':
      case 'edit_file':
        return `Edit ${input.file_path || input.path || ''}`;
      case 'glob':
        return `Find ${input.pattern || ''}`;
      case 'grep':
        return `Search "${input.pattern || ''}"`;
      case 'list_directory':
        return `List ${input.path || ''}`;
      default:
        return toolName;
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
      timeout = config.taskTimeoutMs,
      aiProvider,
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
      events: [],
    };

    logger.info('Starting Agent SDK task', { taskId: task.id, userId, prompt: prompt.substring(0, 100) });

    try {
      if (!fs.existsSync(workingDir)) {
        throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
      }

      // Store initial HEAD for tracking commits
      try {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDir, timeout: 5000 });
        this.taskInitialHeads.set(task.id, stdout.trim());
      } catch {
        // Not a git repo - ignore
      }

      const model = this.getModel(aiProvider);
      const abortController = new AbortController();
      this.activeTasks.set(task.id, abortController);
      task.status = TaskStatus.RUNNING;
      this.taskHistory.set(task.id, task);

      const logStream = this.createTaskLogFile(task.id);
      logStream.write(`=== Task: ${task.id} | ${task.startTime.toISOString()} ===\n`);
      logStream.write(`Prompt: ${prompt}\nWorkingDir: ${workingDir}\nModel: ${model}\n\n`);

      // Emit started event
      const sessionId = task.id;
      task.sessionId = sessionId;
      this.emit('streamEvent', task.id, {
        type: 'started',
        sessionId,
        title: 'Task started',
      } as StreamEvent);

      // Create session with Claude Agent SDK v2
      const session = unstable_v2_createSession({
        model,
        cwd: workingDir,
        permissionMode: 'bypassPermissions',
      });

      let finalAnswer = '';
      let totalCost = 0;
      const startTime = Date.now();

      // Set up timeout
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeout);

      try {
        // Send the prompt
        await session.send(prompt);

        // Process messages from the session
        for await (const msg of session.receive()) {
          // Check if cancelled
          if (abortController.signal.aborted) {
            task.status = TaskStatus.CANCELLED;
            break;
          }

          logStream.write(`\n--- Message: ${msg.type} ---\n${JSON.stringify(msg, null, 2)}\n`);

          if (isSystemMessage(msg)) {
            // System init message - log available tools
            if (msg.subtype === 'init') {
              logger.debug('Session initialized', {
                taskId: task.id,
                tools: msg.tools,
                model: msg.model,
              });
            }
          } else if (isAssistantMessage(msg)) {
            // Process assistant message content
            for (const block of msg.message.content) {
              if (block.type === 'text' && block.text) {
                finalAnswer = block.text;
                task.output += block.text + '\n';

                // Emit note action for text
                const noteAction = this.createAction('note', { text: block.text });
                task.actions.push(noteAction);
                this.emit('streamEvent', task.id, {
                  type: 'action',
                  action: noteAction,
                  phase: 'completed',
                  ok: true,
                  message: block.text.substring(0, 200),
                } as StreamEvent);
              } else if (block.type === 'tool_use' && block.name) {
                // Emit action for tool use
                const toolAction = this.createAction(block.name, (block.input as Record<string, unknown>) || {});
                task.actions.push(toolAction);
                task.currentAction = toolAction;

                this.emit('streamEvent', task.id, {
                  type: 'action',
                  action: toolAction,
                  phase: 'started',
                } as StreamEvent);
              }
            }
          } else if (isResultMessage(msg)) {
            // Final result message
            totalCost = msg.total_cost_usd || 0;

            if (msg.subtype === 'success') {
              if (msg.result) {
                finalAnswer = msg.result;
              }
            } else if (msg.is_error) {
              task.errorOutput = msg.errors?.join('\n') || 'Unknown error';
              task.status = TaskStatus.FAILED;
            }

            logger.info('Task result received', {
              taskId: task.id,
              subtype: msg.subtype,
              numTurns: msg.num_turns,
              durationMs: msg.duration_ms,
              cost: totalCost,
            });
          }
        }
      } finally {
        clearTimeout(timeoutId);
        // Close session
        session.close();
      }

      // Finalize task
      task.endTime = new Date();
      task.costUsd = totalCost;
      task.currentAction = undefined;

      if (task.status === TaskStatus.RUNNING) {
        task.status = TaskStatus.COMPLETED;
      }

      // Emit completion event
      this.emit('streamEvent', task.id, {
        type: 'completed',
        ok: task.status === TaskStatus.COMPLETED,
        answer: finalAnswer,
        sessionId: task.sessionId,
        costUsd: totalCost,
        durationMs: Date.now() - startTime,
      } as StreamEvent);

      logStream.write(`\n=== Completed: ${task.status} | Cost: $${totalCost.toFixed(4)} ===\n`);
      logStream.end();
      this.taskLogFiles.delete(task.id);
      this.activeTasks.delete(task.id);

      this.emit('taskComplete', task.id, task);

      logger.info('Agent SDK task completed', {
        taskId: task.id,
        status: task.status,
        actionsCount: task.actions.length,
        costUsd: task.costUsd,
      });

      return task;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = getErrorMessage(error);
      task.endTime = new Date();

      this.emit('taskError', task.id, error);
      this.activeTasks.delete(task.id);

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

  getCurrentAction(taskId: string): StreamAction | undefined {
    return this.taskHistory.get(taskId)?.currentAction;
  }

  getTaskActions(taskId: string): StreamAction[] {
    return this.taskHistory.get(taskId)?.actions || [];
  }

  getRecentEvents(taskId: string, limit = 10): StreamEvent[] {
    const task = this.taskHistory.get(taskId);
    if (!task) return [];
    return task.events.slice(-limit);
  }

  cancelTask(taskId: string): boolean {
    const controller = this.activeTasks.get(taskId);
    const task = this.taskHistory.get(taskId);
    if (!controller || !task) return false;

    try {
      controller.abort();
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
    return this.getActiveTasksForUser(userId).filter(task => this.cancelTask(task.id)).length;
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
    try {
      const hasChanges = await gitService.hasUncommittedChanges(workingDir);
      if (!hasChanges) {
        return null;
      }
      const message = await this.generateCommitMessage(workingDir);
      const result = await gitService.commit(workingDir, message);
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

  async getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>> {
    const initialHead = this.taskInitialHeads.get(taskId);
    if (!initialHead) return [];
    try {
      const { stdout } = await execAsync(`git log ${initialHead}..HEAD --format="%H|%s" --reverse`, {
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

  cleanupTaskHead(taskId: string): void {
    this.taskInitialHeads.delete(taskId);
  }

  private async generateCommitMessage(workingDir: string): Promise<string> {
    try {
      const { stdout: gitStatus } = await execAsync('git status --short', { cwd: workingDir, timeout: 5000 });
      if (!gitStatus.trim()) return 'chore: update code';

      // Generate a simple commit message based on changed files
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

      // Simple heuristic-based commit message
      const firstFile = fileChanges[0] || 'files';
      const fileCount = fileChanges.length;

      if (fileCount === 1) {
        return `chore: update ${firstFile}`;
      }
      return `chore: update ${fileCount} files`;
    } catch (error) {
      logger.debug('Commit message generation failed', { error: getErrorMessage(error) });
      return 'chore: update code';
    }
  }

  async autoPushChanges(workingDir: string): Promise<'success' | 'no_remote' | 'failed' | 'no_changes'> {
    const result = await gitService.push(workingDir);
    return result.status;
  }

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

  cleanupOldTasks(maxAge = 3600000): number {
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
