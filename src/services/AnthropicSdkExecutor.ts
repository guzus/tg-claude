import Anthropic from '@anthropic-ai/sdk';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { glob } from 'fs/promises';
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

type ContentBlock = Anthropic.ContentBlock;
type ToolUseBlock = Anthropic.ToolUseBlock;
type TextBlock = Anthropic.TextBlock;
type MessageParam = Anthropic.MessageParam;
type Tool = Anthropic.Tool;

interface ToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

// Tool definitions for Claude Code-like functionality
const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the specified path. Returns the file content as text.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute or relative path to the file to read',
        },
        offset: {
          type: 'number',
          description: 'Optional line number to start reading from (0-indexed)',
        },
        limit: {
          type: 'number',
          description: 'Optional number of lines to read',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file at the specified path. Creates the file if it does not exist, overwrites if it does.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The absolute or relative path to the file to write',
        },
        content: {
          type: 'string',
          description: 'The content to write to the file',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing old_string with new_string. The old_string must match exactly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The path to the file to edit',
        },
        old_string: {
          type: 'string',
          description: 'The exact text to replace',
        },
        new_string: {
          type: 'string',
          description: 'The text to replace it with',
        },
        replace_all: {
          type: 'boolean',
          description: 'If true, replace all occurrences. Default false.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'bash',
    description: 'Execute a bash command and return the output. Use for git, npm, build commands, etc.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        timeout: {
          type: 'number',
          description: 'Optional timeout in milliseconds (default 120000)',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern (e.g., "**/*.ts", "src/**/*.js")',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'The glob pattern to match files against',
        },
        path: {
          type: 'string',
          description: 'Optional directory to search in. Defaults to working directory.',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search for a regex pattern in files. Returns matching file paths or content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Optional directory or file to search in',
        },
        include: {
          type: 'string',
          description: 'Optional glob pattern to filter files (e.g., "*.ts")',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'list_directory',
    description: 'List the contents of a directory',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list',
        },
      },
      required: ['path'],
    },
  },
];

export class AnthropicSdkExecutor extends EventEmitter {
  private client: Anthropic;
  private activeTasks: Map<string, AbortController> = new Map();
  private taskHistory: Map<string, ClaudeTaskWithStreaming> = new Map();
  private taskLogFiles: Map<string, fs.WriteStream> = new Map();
  private taskInitialHeads: Map<string, string> = new Map();
  private actionCounter = 0;

  constructor(apiKey?: string) {
    super();
    // Support both API key and OAuth token
    const authToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const apiKeyValue = apiKey || process.env.ANTHROPIC_API_KEY;

    if (authToken) {
      // Warn if both are set - ANTHROPIC_API_KEY will cause billing conflicts
      if (apiKeyValue) {
        logger.warn(
          'Both CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY are set. ' +
          'Using OAuth token. Unset ANTHROPIC_API_KEY to avoid billing conflicts.'
        );
      }
      // Use authToken for OAuth (Claude subscription billing)
      this.client = new Anthropic({ authToken });
    } else if (apiKeyValue) {
      // Use apiKey for direct API access (API key billing)
      this.client = new Anthropic({ apiKey: apiKeyValue });
    } else {
      // Default - will fail if no auth configured
      this.client = new Anthropic();
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
   * Configure the SDK client for a specific provider
   */
  private configureClient(aiProvider?: AIProviderConfig): void {
    const provider = aiProvider?.provider || 'anthropic';

    if (provider === 'anthropic') {
      // Support both OAuth token and API key for Anthropic
      const authToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (authToken) {
        this.client = new Anthropic({ authToken });
      } else if (apiKey) {
        this.client = new Anthropic({ apiKey });
      } else {
        throw new Error('Anthropic requires ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN');
      }
    } else if (provider === 'openrouter') {
      const apiKey = aiProvider?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter requires API key');
      this.client = new Anthropic({
        apiKey,
        baseURL: 'https://openrouter.ai/api',
      });
    } else if (provider === 'glm') {
      const apiKey = aiProvider?.glmApiKey || process.env.GLM_API_KEY;
      if (!apiKey) throw new Error('GLM requires API key');
      this.client = new Anthropic({
        apiKey,
        baseURL: 'https://api.z.ai/api/anthropic',
      });
    }
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

  /**
   * Execute a tool call
   */
  private async executeTool(
    toolName: string,
    input: Record<string, unknown>,
    workingDir: string
  ): Promise<{ content: string; isError: boolean }> {
    try {
      switch (toolName) {
        case 'read_file': {
          const filePath = this.resolvePath(input.file_path as string, workingDir);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          const lines = content.split('\n');
          const offset = (input.offset as number) || 0;
          const limit = (input.limit as number) || lines.length;
          const selectedLines = lines.slice(offset, offset + limit);
          return { content: selectedLines.join('\n'), isError: false };
        }

        case 'write_file': {
          const filePath = this.resolvePath(input.file_path as string, workingDir);
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) {
            await fs.promises.mkdir(dir, { recursive: true });
          }
          await fs.promises.writeFile(filePath, input.content as string, 'utf-8');
          return { content: `Successfully wrote to ${filePath}`, isError: false };
        }

        case 'edit_file': {
          const filePath = this.resolvePath(input.file_path as string, workingDir);
          let content = await fs.promises.readFile(filePath, 'utf-8');
          const oldStr = input.old_string as string;
          const newStr = input.new_string as string;
          const replaceAll = input.replace_all as boolean;

          if (!content.includes(oldStr)) {
            return { content: `Error: old_string not found in file`, isError: true };
          }

          if (replaceAll) {
            content = content.split(oldStr).join(newStr);
          } else {
            content = content.replace(oldStr, newStr);
          }
          await fs.promises.writeFile(filePath, content, 'utf-8');
          return { content: `Successfully edited ${filePath}`, isError: false };
        }

        case 'bash': {
          const command = input.command as string;
          const timeout = (input.timeout as number) || 120000;

          // Security check - block dangerous commands
          const dangerous = ['rm -rf /', 'mkfs', ':(){:|:&};:'];
          if (dangerous.some(d => command.includes(d))) {
            return { content: 'Error: Dangerous command blocked', isError: true };
          }

          const { stdout, stderr } = await execAsync(command, {
            cwd: workingDir,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
          });
          const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
          return { content: output.slice(0, 50000), isError: false };
        }

        case 'glob': {
          const pattern = input.pattern as string;
          const searchPath = input.path ? this.resolvePath(input.path as string, workingDir) : workingDir;
          const matches: string[] = [];

          // Use native glob from fs/promises (Node 22+) or fallback to manual
          try {
            for await (const entry of glob(pattern, { cwd: searchPath })) {
              matches.push(entry.toString());
              if (matches.length >= 500) break;
            }
          } catch {
            // Fallback: use find command
            const { stdout } = await execAsync(`find . -name "${pattern}" 2>/dev/null | head -500`, { cwd: searchPath });
            matches.push(...stdout.trim().split('\n').filter(Boolean));
          }
          return { content: matches.join('\n') || 'No matches found', isError: false };
        }

        case 'grep': {
          const pattern = input.pattern as string;
          const searchPath = input.path ? this.resolvePath(input.path as string, workingDir) : workingDir;
          const include = input.include as string | undefined;

          let cmd = `grep -r -l "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
          if (include) {
            cmd = `grep -r -l --include="${include}" "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
          }

          try {
            const { stdout } = await execAsync(cmd, { timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
            return { content: stdout.trim() || 'No matches found', isError: false };
          } catch (e) {
            // grep returns exit code 1 when no matches
            const err = e as { stdout?: string };
            return { content: err.stdout?.trim() || 'No matches found', isError: false };
          }
        }

        case 'list_directory': {
          const dirPath = this.resolvePath(input.path as string, workingDir);
          const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          const formatted = entries.map(e => `${e.isDirectory() ? 'd' : '-'} ${e.name}`);
          return { content: formatted.join('\n'), isError: false };
        }

        default:
          return { content: `Unknown tool: ${toolName}`, isError: true };
      }
    } catch (error) {
      return { content: `Error: ${getErrorMessage(error)}`, isError: true };
    }
  }

  private resolvePath(filePath: string, workingDir: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(workingDir, filePath);
  }

  private createAction(toolName: string, input: Record<string, unknown>): StreamAction {
    this.actionCounter++;
    const kind = this.mapToolToKind(toolName);
    const title = this.generateActionTitle(toolName, input);
    return {
      id: `action-${this.actionCounter}`,
      kind,
      title,
      detail: input,
    };
  }

  private mapToolToKind(toolName: string): 'command' | 'tool' | 'file_change' | 'web_search' | 'note' | 'turn' | 'warning' | 'telemetry' {
    if (toolName === 'bash') return 'command';
    if (['write_file', 'edit_file'].includes(toolName)) return 'file_change';
    if (toolName === 'grep') return 'tool';
    return 'tool';
  }

  private generateActionTitle(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'bash': {
        const cmd = String(input.command || '').substring(0, 60);
        return `$ ${cmd}${String(input.command || '').length > 60 ? '...' : ''}`;
      }
      case 'read_file':
        return `Read ${input.file_path}`;
      case 'write_file':
        return `Write ${input.file_path}`;
      case 'edit_file':
        return `Edit ${input.file_path}`;
      case 'glob':
        return `Find ${input.pattern}`;
      case 'grep':
        return `Search "${input.pattern}"`;
      case 'list_directory':
        return `List ${input.path}`;
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

    logger.info('Starting SDK task', { taskId: task.id, userId, prompt: prompt.substring(0, 100) });

    try {
      if (!fs.existsSync(workingDir)) {
        throw new Error(`Working directory does not exist: ${workingDir}. Use /repo to set up a repository first.`);
      }

      // Store initial HEAD
      try {
        const { stdout } = await execAsync('git rev-parse HEAD', { cwd: workingDir, timeout: 5000 });
        this.taskInitialHeads.set(task.id, stdout.trim());
      } catch {
        // Not a git repo - ignore
      }

      // Configure client for provider
      this.configureClient(aiProvider);
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

      // Build system prompt with context
      const systemPrompt = `You are Claude, an AI assistant with access to tools for file operations and command execution.
You are working in the directory: ${workingDir}

Available tools:
- read_file: Read file contents
- write_file: Write content to a file
- edit_file: Edit a file by replacing text
- bash: Execute bash commands
- glob: Find files by pattern
- grep: Search for patterns in files
- list_directory: List directory contents

Be helpful, concise, and complete tasks thoroughly. Always verify your work.`;

      // Agentic loop
      const messages: MessageParam[] = [{ role: 'user', content: prompt }];
      let totalCost = 0;
      let finalAnswer = '';
      const startTime = Date.now();
      const timeoutMs = timeout;
      const MAX_ITERATIONS = 100;
      let iterations = 0;

      while (iterations < MAX_ITERATIONS) {
        iterations++;
        // Check timeout
        if (Date.now() - startTime > timeoutMs) {
          task.status = TaskStatus.TIMEOUT;
          break;
        }

        // Check if cancelled
        if (abortController.signal.aborted) {
          task.status = TaskStatus.CANCELLED;
          break;
        }

        // Call API
        const response = await this.client.messages.create({
          model,
          max_tokens: 8192,
          system: systemPrompt,
          tools: TOOL_DEFINITIONS,
          messages,
        });

        // Estimate cost (approximate)
        const inputTokens = response.usage?.input_tokens || 0;
        const outputTokens = response.usage?.output_tokens || 0;
        totalCost += (inputTokens * 0.003 + outputTokens * 0.015) / 1000;

        logStream.write(`\n--- API Response ---\n${JSON.stringify(response, null, 2)}\n`);

        // Process response
        const assistantContent: ContentBlock[] = response.content;
        const toolUses: ToolUseBlock[] = [];

        for (const block of assistantContent) {
          if (block.type === 'text') {
            const textBlock = block as TextBlock;
            finalAnswer = textBlock.text;
            task.output += textBlock.text + '\n';

            // Emit note action
            const noteAction = this.createAction('note', { text: textBlock.text });
            task.actions.push(noteAction);
            this.emit('streamEvent', task.id, {
              type: 'action',
              action: noteAction,
              phase: 'completed',
              ok: true,
              message: textBlock.text.substring(0, 200),
            } as StreamEvent);
          } else if (block.type === 'tool_use') {
            toolUses.push(block as ToolUseBlock);
          }
        }

        // If no tool uses, we're done
        if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
          break;
        }

        // Execute tools
        const toolResults: ToolResult[] = [];
        for (const toolUse of toolUses) {
          const action = this.createAction(toolUse.name, toolUse.input as Record<string, unknown>);
          task.actions.push(action);
          task.currentAction = action;

          this.emit('streamEvent', task.id, {
            type: 'action',
            action,
            phase: 'started',
          } as StreamEvent);

          const { content, isError } = await this.executeTool(
            toolUse.name,
            toolUse.input as Record<string, unknown>,
            workingDir
          );

          logStream.write(`\n--- Tool: ${toolUse.name} ---\nInput: ${JSON.stringify(toolUse.input)}\nOutput: ${content.substring(0, 1000)}\n`);

          this.emit('streamEvent', task.id, {
            type: 'action',
            action,
            phase: 'completed',
            ok: !isError,
            message: content.substring(0, 200),
          } as StreamEvent);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content,
            is_error: isError,
          });
        }

        task.currentAction = undefined;

        // Add assistant message and tool results to conversation
        messages.push({ role: 'assistant', content: assistantContent });
        messages.push({
          role: 'user',
          content: toolResults.map(r => ({
            type: 'tool_result' as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
            is_error: r.is_error,
          })),
        });
      }

      // Finalize task
      task.endTime = new Date();
      task.costUsd = totalCost;

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

      logger.info('SDK task completed', {
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

      let diffContent = '';
      try {
        const { stdout: stagedDiff } = await execAsync('git diff --cached', { cwd: workingDir, timeout: 10000 });
        const { stdout: unstagedDiff } = await execAsync('git diff', { cwd: workingDir, timeout: 10000 });
        diffContent = (stagedDiff + unstagedDiff).substring(0, 3000);
      } catch {
        const { stdout: statDiff } = await execAsync('git diff HEAD --stat', { cwd: workingDir, timeout: 10000 });
        diffContent = statDiff;
      }

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
        return `${file} (${statusDesc})`;
      }).join(', ');

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

      // Use SDK for commit message generation (Haiku model)
      const response = await this.client.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 100,
        messages: [{ role: 'user', content: prompt }],
      });

      let message = '';
      for (const block of response.content) {
        if (block.type === 'text') {
          message = (block as TextBlock).text.trim();
          break;
        }
      }

      message = message
        .replace(/^["'`]|["'`]$/g, '')
        .replace(/^\*\*|\*\*$/g, '')
        .trim();

      if (message.length < 5 || message.length > 100 || message.includes('\n')) {
        const firstLine = gitStatus.trim().split('\n')[0] || '';
        const fileMatch = firstLine.match(/^.{1,2}\s+(.+)$/);
        const firstFile = fileMatch ? fileMatch[1] : 'files';
        return `chore: update ${path.basename(firstFile)}`;
      }

      return message;
    } catch (error) {
      logger.debug('Commit message generation failed', { error: getErrorMessage(error) });
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
