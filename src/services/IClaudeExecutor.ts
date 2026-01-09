import { EventEmitter } from 'events';
import { ClaudeTaskWithStreaming, AIProviderConfig, StreamAction, StreamEvent } from '../types';

export interface ExecutorOptions {
  workingDir?: string;
  dangerMode?: boolean;
  additionalFlags?: string[];
  timeout?: number;
  aiProvider?: AIProviderConfig;
  ralphLoop?: { completionPromise: string; maxIterations: number };
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

  // Task queries
  getTask(taskId: string): ClaudeTaskWithStreaming | undefined;
  getActiveTasks(): ClaudeTaskWithStreaming[];
  getActiveTasksForUser(userId: number): ClaudeTaskWithStreaming[];
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
  cleanupTaskHead(taskId: string): void;

  // Git operations
  hasUncommittedChanges(workingDir: string): Promise<boolean>;
  hasUnpushedCommits(workingDir: string): Promise<boolean>;
  hasRemoteRepository(workingDir: string): Promise<boolean>;
  autoCommitChanges(workingDir: string): Promise<string | null>;
  autoPushChanges(workingDir: string): Promise<'success' | 'no_remote' | 'failed' | 'no_changes'>;
  getTaskCommits(taskId: string, workingDir: string): Promise<Array<{ hash: string; message: string }>>;
  createGitHubRepository(
    workingDir: string,
    isPrivate?: boolean,
    customRepoName?: string
  ): Promise<'success' | 'already_exists' | 'error'>;
}

/**
 * Type for executor instances that extend EventEmitter
 */
export type ClaudeExecutorInstance = IClaudeExecutor & EventEmitter;
