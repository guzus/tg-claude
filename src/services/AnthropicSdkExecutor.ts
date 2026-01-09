import { query, SDKMessage, HookCallback } from '@anthropic-ai/claude-agent-sdk';
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
import { PLUGIN_PRESETS } from '../presets';
import { buildRalphLoopPrompt } from '../utils/ralphPrompt';
import { getInstalledPluginPath } from './ClaudePluginMarketplace';

const execAsync = promisify(exec);
const TASK_LOGS_DIR = path.join(LOGS_PATH, 'tasks');

// Type guards for SDK message types
function isAssistantMessage(msg: SDKMessage): msg is Extract<SDKMessage, { type: 'assistant' }> {
  return msg.type === 'assistant';
}

function isResultMessage(msg: SDKMessage): msg is Extract<SDKMessage, { type: 'result' }> {
  return msg.type === 'result';
}

function isSystemMessage(msg: SDKMessage): msg is Extract<SDKMessage, { type: 'system' }> {
  return msg.type === 'system';
}

// Detect Claude Code CLI path for Docker environment
function getClaudeCodePath(): string | undefined {
  // Check common installation paths
  const paths = [
    '/opt/bun/bin/claude',           // Docker: bun global install
    '/usr/local/bin/claude',         // System install
    process.env.HOME ? `${process.env.HOME}/.bun/bin/claude` : null, // User bun install
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

export class AnthropicSdkExecutor extends EventEmitter {
  private activeTasks: Map<string, AbortController> = new Map();
  private taskHistory: Map<string, ClaudeTaskWithStreaming> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();
  private taskInitialHeads: Map<string, string> = new Map();
  private actionCounter = 0;
  private claudeCodePath: string | undefined;

  constructor(_apiKey?: string) {
    super();
    // The Claude Agent SDK uses Claude Code CLI authentication automatically
    // or ANTHROPIC_API_KEY environment variable
    this.claudeCodePath = getClaudeCodePath();
    if (this.claudeCodePath) {
      logger.info('Claude Code CLI found', { path: this.claudeCodePath });
    }

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
      events: [],
    };

    this.taskHistory.set(task.id, task);
    return task;
  }

  startTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: {
      workingDir?: string;
      dangerMode?: boolean;
      additionalFlags?: string[];
      timeout?: number;
      aiProvider?: AIProviderConfig;
      ralphLoop?: { completionPromise: string; maxIterations: number };
    } = {}
  ): ClaudeTaskWithStreaming {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);

    void this.runTask(task, options).catch((error) => {
      logger.error('Agent SDK task failed', { taskId: task.id, error: getErrorMessage(error) });
    });

    return task;
  }

  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: {
      workingDir?: string;
      dangerMode?: boolean;
      additionalFlags?: string[];
      timeout?: number;
      aiProvider?: AIProviderConfig;
      ralphLoop?: { completionPromise: string; maxIterations: number };
    } = {}
  ): Promise<ClaudeTaskWithStreaming> {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);
    await this.runTask(task, options);
    return task;
  }

  private async runTask(
    task: ClaudeTaskWithStreaming,
    options: {
      workingDir?: string;
      dangerMode?: boolean;
      additionalFlags?: string[];
      timeout?: number;
      aiProvider?: AIProviderConfig;
      ralphLoop?: { completionPromise: string; maxIterations: number };
    }
  ): Promise<void> {
    const {
      workingDir = task.workingDir,
      timeout = config.taskTimeoutMs,
      aiProvider,
      ralphLoop,
    } = options;

    logger.info('Starting Agent SDK task', { taskId: task.id, userId: task.userId, prompt: task.prompt.substring(0, 100) });

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

      const logStream = this.createTaskLogFile(task.id);
      logStream.write(`=== Task: ${task.id} | ${task.startTime.toISOString()} ===\n`);
      logStream.write(`Prompt: ${task.prompt}\nWorkingDir: ${workingDir}\nModel: ${model}\n\n`);

      // Emit started event
      const sessionId = task.id;
      task.sessionId = sessionId;
      const startedEvent: StreamEvent = {
        type: 'started',
        sessionId,
        title: 'Task started',
      };
      task.events.push(startedEvent);
      this.emit('streamEvent', task.id, startedEvent);

      let finalAnswer = '';
      let totalCost = 0;
      const startTime = Date.now();

      // Set up timeout
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeout);

      try {
        // Build ralph loop Stop hook if enabled
        let ralphIterations = 0;
        const stopHook: HookCallback | undefined = ralphLoop ? async (input, _toolUseID, options) => {
          // Check if aborted
          if (options.signal.aborted) {
            logger.info('Ralph loop aborted', { taskId: task.id });
            return { continue: false, stopReason: 'Aborted' };
          }

          ralphIterations++;
          logger.info('Ralph loop Stop hook called', {
            taskId: task.id,
            iteration: ralphIterations,
            hookEvent: input.hook_event_name,
            outputLength: task.output.length,
          });

          // Check if we've reached max iterations
          if (ralphIterations >= ralphLoop.maxIterations) {
            logger.info('Ralph loop max iterations reached', { taskId: task.id, iterations: ralphIterations });
            return { continue: false, stopReason: `Max iterations (${ralphLoop.maxIterations}) reached` };
          }

          // Check if completion promise is in the output
          if (task.output.includes(ralphLoop.completionPromise)) {
            logger.info('Ralph loop completion promise found', { taskId: task.id, iterations: ralphIterations });
            return { continue: false, stopReason: 'Completion promise found' };
          }

          // Continue the loop
          logger.info('Ralph loop continuing', { taskId: task.id, iteration: ralphIterations });
          return { continue: true };
        } : undefined;

        // Build the final prompt - add ralph loop instructions if enabled
        let finalPrompt = task.prompt;
        const plugins: Array<{ type: 'local'; path: string }> = [];
        if (ralphLoop) {
          finalPrompt = buildRalphLoopPrompt({
            request: task.prompt,
            maxIterations: ralphLoop.maxIterations,
            completionPromise: ralphLoop.completionPromise,
          });

          const preset = PLUGIN_PRESETS['ralph-loop'];
          const pluginSpec = preset ? `${preset.name}@${preset.registry}` : 'ralph-loop@claude-plugins-official';
          const pluginPath = getInstalledPluginPath(pluginSpec);
          if (pluginPath) {
            plugins.push({ type: 'local', path: pluginPath });
          } else {
            logger.warn('Ralph loop plugin path not found for SDK session', { pluginSpec });
          }
        }

        // Use the v1 query API which supports cwd and bypassPermissions
        const q = query({
          prompt: finalPrompt,
          options: {
            model,
            cwd: workingDir,
            permissionMode: 'bypassPermissions',
            abortController,
            pathToClaudeCodeExecutable: this.claudeCodePath,
            // Use bun as the runtime since we're in a bun environment
            executable: 'bun',
            // Load local project settings
            settingSources: ['local'],
            // Add plugins and Stop hook for ralph loop if enabled
            ...(plugins.length > 0 && { plugins }),
            ...(stopHook && {
              hooks: {
                Stop: [{ hooks: [stopHook] }],
              },
            }),
          },
        });

        // Process messages from the query
        for await (const msg of q) {
          // Check if cancelled
          if (abortController.signal.aborted) {
            task.status = TaskStatus.CANCELLED;
            break;
          }

          logStream.write(JSON.stringify(msg) + '\n');

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
                const noteEvent: StreamEvent = {
                  type: 'action',
                  action: noteAction,
                  phase: 'completed',
                  ok: true,
                  message: block.text.substring(0, 200),
                };
                task.events.push(noteEvent);
                this.emit('streamEvent', task.id, noteEvent);
              } else if (block.type === 'tool_use' && block.name) {
                // Emit action for tool use
                const toolAction = this.createAction(block.name, (block.input as Record<string, unknown>) || {});
                task.actions.push(toolAction);
                task.currentAction = toolAction;

                const toolEvent: StreamEvent = {
                  type: 'action',
                  action: toolAction,
                  phase: 'started',
                };
                task.events.push(toolEvent);
                this.emit('streamEvent', task.id, toolEvent);
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
      }

      // Finalize task
      task.endTime = new Date();
      task.costUsd = totalCost;
      task.currentAction = undefined;

      if (task.status === TaskStatus.RUNNING) {
        task.status = TaskStatus.COMPLETED;
      }

      // Emit completion event
      const completedEvent: StreamEvent = {
        type: 'completed',
        ok: task.status === TaskStatus.COMPLETED,
        answer: finalAnswer,
        sessionId: task.sessionId,
        costUsd: totalCost,
        durationMs: Date.now() - startTime,
      };
      task.events.push(completedEvent);
      this.emit('streamEvent', task.id, completedEvent);

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

  // Task-specific git tracking
  async getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>> {
    const initialHead = this.taskInitialHeads.get(taskId);
    if (!initialHead) return [];
    return gitService.getCommitsSince(workingDir, initialHead);
  }

  cleanupTaskHead(taskId: string): void {
    this.taskInitialHeads.delete(taskId);
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
