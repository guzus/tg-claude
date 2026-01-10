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
  McpServer,
  ImageContent,
} from '../types';
import { config, WORKSPACE_PATH, LOGS_PATH } from '../config';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { gitService } from './GitService';

const execAsync = promisify(exec);
const TASK_LOGS_DIR = path.join(LOGS_PATH, 'tasks');
const DEFAULT_CODEX_MODEL = process.env.CODEX_MODEL || 'gpt-5-codex';
const MAX_TOOL_ITERATIONS = 12;

type TaskRunOptions = {
  workingDir?: string;
  dangerMode?: boolean;
  additionalFlags?: string[];
  timeout?: number;
  aiProvider?: AIProviderConfig;
  ralphLoop?: { completionPromise: string; maxIterations: number };
  mcpServers?: Record<string, McpServer>;
  images?: ImageContent[];
};

type ToolCall = {
  id: string;
  name: string;
  arguments: string;
};

type ResponseContentBlock = {
  type?: string;
  text?: string;
};

type ResponseOutputItem = {
  type?: string;
  call_id?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
  content?: ResponseContentBlock[];
};

type ToolCallEnvelope = {
  id?: string;
  function?: {
    name?: string;
    arguments?: unknown;
  };
};

type CodexResponse = {
  output_text?: string;
  output?: ResponseOutputItem[] | { tool_calls?: ToolCallEnvelope[] };
};

export class CodexSdkExecutor extends EventEmitter {
  private activeTasks: Map<string, AbortController> = new Map();
  private taskHistory: Map<string, ClaudeTaskWithStreaming> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();
  private taskInitialHeads: Map<string, string> = new Map();
  private chatSessions: Map<number, string> = new Map();
  private actionCounter = 0;
  private apiKey?: string;
  private model: string;

  constructor(apiKey?: string, model: string = DEFAULT_CODEX_MODEL) {
    super();

    const resolvedKey = apiKey || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
    if (!resolvedKey) {
      logger.warn('Codex executor missing API key. Set CODEX_API_KEY or OPENAI_API_KEY.');
    }

    this.apiKey = resolvedKey;
    this.model = model;

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

  private createTask(
    userId: number,
    chatId: number,
    prompt: string,
    workingDir: string,
    overrides: Partial<ClaudeTaskWithStreaming> = {}
  ): ClaudeTaskWithStreaming {
    const task: ClaudeTaskWithStreaming = {
      id: overrides.id || uuidv4(),
      userId,
      chatId,
      prompt,
      workingDir,
      status: overrides.status || TaskStatus.PENDING,
      startTime: overrides.startTime || new Date(),
      output: '',
      errorOutput: '',
      actions: [],
      events: [],
      sessionId: overrides.sessionId,
      images: overrides.images,
    };

    this.taskHistory.set(task.id, task);
    return task;
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
    if (['write_file', 'edit_file'].includes(lowerName)) return 'file_change';
    if (['read_file', 'list_directory', 'glob', 'grep'].includes(lowerName)) return 'tool';
    return 'tool';
  }

  private generateActionTitle(toolName: string, input: Record<string, unknown>): string {
    const lowerName = toolName.toLowerCase();
    switch (lowerName) {
      case 'bash':
        return `$ ${String(input.command || '').substring(0, 60)}`;
      case 'read_file':
        return `Read ${input.path || ''}`;
      case 'write_file':
        return `Write ${input.path || ''}`;
      case 'edit_file':
        return `Edit ${input.path || ''}`;
      case 'list_directory':
        return `List ${input.path || ''}`;
      case 'glob':
        return `Find ${input.pattern || ''}`;
      case 'grep':
        return `Search "${input.pattern || ''}"`;
      default:
        return toolName;
    }
  }

  startTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: TaskRunOptions = {}
  ): ClaudeTaskWithStreaming {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);

    if (options.images && options.images.length > 0) {
      logger.warn('Codex executor does not support image inputs yet.', { taskId: task.id });
    }

    void this.runTask(task, options).catch((error) => {
      logger.error('Codex task execution failed', { taskId: task.id, error: getErrorMessage(error) });
    });

    return task;
  }

  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: TaskRunOptions = {}
  ): Promise<ClaudeTaskWithStreaming> {
    const workingDir = options.workingDir || WORKSPACE_PATH;
    const task = this.createTask(userId, chatId, prompt, workingDir);
    await this.runTask(task, options);
    return task;
  }

  private async runTask(task: ClaudeTaskWithStreaming, options: TaskRunOptions): Promise<void> {
    const {
      workingDir = task.workingDir,
      timeout = config.taskTimeoutMs,
    } = options;

    logger.info('Starting Codex task', { taskId: task.id, userId: task.userId, prompt: task.prompt.substring(0, 100) });

    if (!fs.existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
    }

    try {
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDir, timeout: 5000 });
      this.taskInitialHeads.set(task.id, stdout.trim());
    } catch {
      // Not a git repo or no commits yet - ignore
    }

    const abortController = new AbortController();
    this.activeTasks.set(task.id, abortController);
    task.status = TaskStatus.RUNNING;

    const logStream = this.createTaskLogFile(task.id);
    logStream.write(`=== Codex Task: ${task.id} | ${task.startTime.toISOString()} ===\n`);
    logStream.write(`Prompt: ${task.prompt}\nWorkingDir: ${workingDir}\n\n`);

    const startedEvent: StreamEvent = {
      type: 'started',
      sessionId: task.sessionId || task.id,
      title: 'Codex session started',
    };
    task.events.push(startedEvent);
    this.emit('streamEvent', task.id, startedEvent);

    let timeoutHandle: NodeJS.Timeout | null = null;
    const resetTimeout = () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        if (this.activeTasks.has(task.id)) {
          logger.warn('Codex task timeout', { taskId: task.id });
          abortController.abort();
          task.status = TaskStatus.TIMEOUT;
        }
      }, timeout);
    };

    resetTimeout();

    try {
      const { answer, events } = await this.runCodexLoop(task, workingDir, abortController, resetTimeout);
      task.output = answer;

      for (const event of events) {
        task.events.push(event);
        this.emit('streamEvent', task.id, event);
      }

      task.status = task.status === TaskStatus.TIMEOUT ? TaskStatus.TIMEOUT : TaskStatus.COMPLETED;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = getErrorMessage(error);
      this.emit('taskError', task.id, error);
      throw error;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      task.endTime = new Date();
      this.activeTasks.delete(task.id);
    }

    const completedEvent: StreamEvent = {
      type: 'completed',
      ok: task.status === TaskStatus.COMPLETED,
      answer: task.output,
      sessionId: task.sessionId,
      durationMs: task.endTime ? task.endTime.getTime() - task.startTime.getTime() : undefined,
    };
    task.events.push(completedEvent);
    this.emit('streamEvent', task.id, completedEvent);
    this.emit('taskComplete', task.id, task);

    logStream.write(`\n=== Completed: ${task.status} ===\n`);
    logStream.end();
    this.taskLogFiles.delete(task.id);
  }

  private async runCodexLoop(
    task: ClaudeTaskWithStreaming,
    workingDir: string,
    abortController: AbortController,
    resetTimeout: () => void
  ): Promise<{ answer: string; events: StreamEvent[] }> {
    const tools = this.getToolDefinitions();
    const events: StreamEvent[] = [];

    const input: Array<Record<string, unknown>> = [
      {
        role: 'user',
        content: [{ type: 'input_text', text: task.prompt }],
      },
    ];

    let answer = '';

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      resetTimeout();
      const response = await this.createResponse({
        model: this.model,
        input,
        tools,
      }, abortController.signal);

      const toolCalls = this.extractToolCalls(response);
      if (toolCalls.length === 0) {
        answer = this.extractOutputText(response);
        break;
      }

      for (const call of toolCalls) {
        const args = this.safeParseArgs(call.arguments);
        const action = this.createAction(call.name, args);
        task.actions.push(action);
        task.currentAction = action;

        const startedEvent: StreamEvent = {
          type: 'action',
          action,
          phase: 'started',
        };
        events.push(startedEvent);

        const output = await this.runTool(call.name, args, workingDir);

        const completedEvent: StreamEvent = {
          type: 'action',
          action,
          phase: 'completed',
          ok: true,
          message: typeof output === 'string' ? output.substring(0, 200) : undefined,
        };
        events.push(completedEvent);

        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.name,
          arguments: call.arguments,
        });
        input.push({
          type: 'function_call_output',
          call_id: call.id,
          output: typeof output === 'string' ? output : JSON.stringify(output),
        });
      }
    }

    task.currentAction = undefined;
    if (!answer) {
      answer = 'Codex finished without a final response.';
    }
    return { answer, events };
  }

  private async createResponse(payload: Record<string, unknown>, signal: AbortSignal): Promise<CodexResponse> {
    if (!this.apiKey) {
      throw new Error('Codex API key is not configured. Set CODEX_API_KEY or OPENAI_API_KEY.');
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Codex API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<CodexResponse>;
  }

  private extractToolCalls(response: CodexResponse): ToolCall[] {
    if (!response) return [];
    if (Array.isArray(response.output)) {
      return response.output
        .filter(item => item?.type === 'function_call')
        .map(item => ({
          id: String(item.call_id || item.id || ''),
          name: String(item.name || ''),
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
        }))
        .filter((item: ToolCall) => item.id && item.name);
    }

    if (!response.output || Array.isArray(response.output)) return [];
    const toolCalls = response.output.tool_calls;
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls
      .map(item => ({
        id: String(item.id || ''),
        name: String(item.function?.name || ''),
        arguments: typeof item.function?.arguments === 'string' ? item.function.arguments : JSON.stringify(item.function?.arguments || {}),
      }))
      .filter((item: ToolCall) => item.id && item.name);
  }

  private extractOutputText(response: CodexResponse): string {
    if (typeof response?.output_text === 'string') return response.output_text.trim();

    const output = response?.output;
    if (!Array.isArray(output)) return '';

    const textChunks = output
      .filter(item => item?.type === 'message')
      .flatMap(item => item?.content || [])
      .filter(content => content?.type === 'output_text')
      .map(content => content.text)
      .filter(Boolean);

    return textChunks.join('\n').trim();
  }

  private safeParseArgs(raw: string): Record<string, unknown> {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private resolvePath(workingDir: string, targetPath: string): string {
    const resolved = path.resolve(workingDir, targetPath);
    if (!resolved.startsWith(path.resolve(workingDir))) {
      throw new Error(`Path outside working directory: ${targetPath}`);
    }
    return resolved;
  }

  private async runTool(name: string, args: Record<string, unknown>, workingDir: string): Promise<string> {
    switch (name) {
      case 'read_file': {
        const target = this.resolvePath(workingDir, String(args.path || ''));
        return fs.promises.readFile(target, 'utf-8');
      }
      case 'write_file': {
        const target = this.resolvePath(workingDir, String(args.path || ''));
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.writeFile(target, String(args.content || ''), 'utf-8');
        return `Wrote ${target}`;
      }
      case 'edit_file': {
        const target = this.resolvePath(workingDir, String(args.path || ''));
        await fs.promises.writeFile(target, String(args.content || ''), 'utf-8');
        return `Edited ${target}`;
      }
      case 'list_directory': {
        const target = this.resolvePath(workingDir, String(args.path || '.'));
        const entries = await fs.promises.readdir(target, { withFileTypes: true });
        return entries
          .map(entry => (entry.isDirectory() ? `${entry.name}/` : entry.name))
          .join('\n');
      }
      case 'glob': {
        const pattern = String(args.pattern || '*');
        const { stdout } = await execAsync(`rg --files -g "${pattern}"`, { cwd: workingDir, timeout: 10000 });
        return stdout.trim();
      }
      case 'grep': {
        const pattern = String(args.pattern || '');
        const searchPath = String(args.path || '.');
        const { stdout } = await execAsync(`rg -n "${pattern}" ${searchPath}`, { cwd: workingDir, timeout: 10000 });
        return stdout.trim();
      }
      case 'bash': {
        const command = String(args.command || '');
        const { stdout, stderr } = await execAsync(command, { cwd: workingDir, timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
        return [stdout, stderr].filter(Boolean).join('\n');
      }
      default:
        throw new Error(`Unsupported tool: ${name}`);
    }
  }

  private getToolDefinitions(): Array<Record<string, unknown>> {
    return [
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: 'Read a file from the workspace.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'write_file',
          description: 'Write a file to the workspace, overwriting if it exists.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'edit_file',
          description: 'Overwrite a file with new content.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' },
            },
            required: ['path', 'content'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_directory',
          description: 'List files and folders in a directory.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
            },
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'glob',
          description: 'Find files matching a glob pattern.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep',
          description: 'Search files for a regex pattern.',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string' },
              path: { type: 'string' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Run a shell command in the workspace.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        },
      },
    ];
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

  getCurrentAction(taskId: string): StreamAction | undefined {
    const task = this.taskHistory.get(taskId);
    return task?.currentAction;
  }

  getTaskActions(taskId: string): StreamAction[] {
    const task = this.taskHistory.get(taskId);
    return task?.actions || [];
  }

  getRecentEvents(taskId: string, limit: number = 10): StreamEvent[] {
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
      logger.info('Codex task cancelled', { taskId });
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

    if (cleaned > 0) logger.info('Cleaned old Codex tasks', { count: cleaned });
    return cleaned;
  }

  clearChatSession(chatId: number): boolean {
    return this.chatSessions.delete(chatId);
  }

  getChatSessionId(chatId: number): string | undefined {
    return this.chatSessions.get(chatId);
  }
}
