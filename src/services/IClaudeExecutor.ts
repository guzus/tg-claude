import { EventEmitter } from 'events';
import { ClaudeTaskWithStreaming, AIProviderConfig, StreamAction, StreamEvent, McpServer, ImageContent } from '../types';

export interface ExecutorOptions {
  workingDir?: string;
  dangerMode?: boolean;
  additionalFlags?: string[];
  timeout?: number;
  aiProvider?: AIProviderConfig;
  ralphLoop?: { completionPromise: string; maxIterations: number };
  mcpServers?: Record<string, McpServer>;
  images?: ImageContent[];
  resumeSessionId?: string;
}

/**
 * Interface for Claude task executors.
 * Implementations can use CLI (ClaudeExecutor) or SDK (AnthropicSdkExecutor).
 */
export interface IClaudeExecutor {
  // Task execution
  executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options?: ExecutorOptions
  ): Promise<ClaudeTaskWithStreaming>;
  startTask(
    userId: number,
    chatId: number,
    prompt: string,
    options?: ExecutorOptions
  ): ClaudeTaskWithStreaming;

  // Task queries
  getTask(taskId: string): ClaudeTaskWithStreaming | undefined;
  setTaskMessageId(taskId: string, messageId: number): void;
  getActiveTasks(): ClaudeTaskWithStreaming[];
  getActiveTasksForUser(userId: number): ClaudeTaskWithStreaming[];
  getAllTasks(): ClaudeTaskWithStreaming[];
  getAllTasksForUser(userId: number): ClaudeTaskWithStreaming[];
  getCurrentAction(taskId: string): StreamAction | undefined;
  getTaskActions(taskId: string): StreamAction[];
  getRecentEvents(taskId: string, limit?: number): StreamEvent[];
  getTaskLogFilePath(taskId: string): string | null;
  getTaskOutput(taskId: string): string;
  getTaskCount(): number;

  // Task management
  cancelTask(taskId: string): boolean;
  cancelAllTasksForUser(userId: number): number;
  hasReachedConcurrentLimit(userId: number): boolean;
  cleanupOldTasks(maxAge?: number): number;

  // Task-specific git tracking (uses internal taskInitialHeads)
  cleanupTaskHead(taskId: string): void;
  getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>>;

  // Session management (for conversation continuity)
  clearChatSession(chatId: number): boolean;
  getChatSessionId(chatId: number): string | undefined;
}

/**
 * Type for executor instances that extend EventEmitter
 */
export type ClaudeExecutorInstance = IClaudeExecutor & EventEmitter;
