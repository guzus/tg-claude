export interface BotConfig {
  telegramToken: string;
  claudeApiKey: string;
  allowedUserIds: number[];
  workspacePath: string;
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  maxOutputSize: number;
  logLevel: string;
  logFile: string;
  maxRequestsPerUserPerHour: number;
  maxRequestsPerUserPerDay: number;
}

export interface ClaudeTask {
  id: string;
  userId: number;
  chatId: number;
  prompt: string;
  workingDir: string;
  status: TaskStatus;
  startTime: Date;
  endTime?: Date;
  output: string;
  errorOutput: string;
  exitCode?: number;
  messageId?: number;
}

export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMEOUT = 'timeout'
}

export interface ClaudeExecutionOptions {
  workingDir?: string;
  dangerMode?: boolean;
  additionalFlags?: string[];
  timeout?: number;
}

export interface UserActivity {
  userId: number;
  requestsThisHour: number;
  requestsToday: number;
  lastRequestTime: Date;
  hourStartTime: Date;
  dayStartTime: Date;
}

export interface TaskMetrics {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  averageExecutionTime: number;
  tasksByUser: Map<number, number>;
}

export interface CommandContext {
  userId: number;
  chatId: number;
  username?: string;
  args: string[];
  rawCommand: string;
}

export interface ProjectConfig {
  name: string;
  path: string;
  gitBranch?: string;
  description?: string;
}

export interface AuditLogEntry {
  timestamp: Date;
  userId: number;
  username?: string;
  command: string;
  taskId?: string;
  success: boolean;
  executionTime?: number;
  error?: string;
}
