export interface BotConfig {
  telegramToken: string;
  githubToken: string;
  allowedUserIds: number[];
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
  aiProvider?: AIProviderConfig;
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

export interface Repository {
  id: string;
  name: string;
  path: string;
  type: RepositoryType;
  gitUrl?: string;
  branch?: string;
  createdAt: Date;
  lastUsed: Date;
}

export enum RepositoryType {
  CLONED = 'cloned',
  NEW = 'new',
  EXISTING = 'existing'
}

export interface UserSession {
  userId: number;
  currentRepositoryId?: string;
  repositories: Map<string, Repository>;
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

export interface DeletedRepository {
  gitUrl?: string;
  path: string;
  deletedAt: Date;
}

export interface TechStackPreferences {
  typescript?: 'bun' | 'npm' | 'pnpm' | 'yarn';
  python?: 'uv' | 'pip' | 'poetry' | 'pipenv';
}

// AI Provider Types
export type AIProvider = 'anthropic' | 'glm';

export interface AIProviderConfig {
  provider: AIProvider;
  apiKey?: string;        // Provider-specific API key (stored separately from Anthropic)
  model?: string;         // Optional model override
}

export const AI_PROVIDER_ENDPOINTS: Record<AIProvider, string | undefined> = {
  anthropic: undefined,   // Uses default Anthropic endpoint
  glm: 'https://api.z.ai/api/anthropic'  // Z.ai GLM endpoint
};

// GLM model mappings for Claude Code's internal model slots (Haiku/Sonnet/Opus)
// Per Z.ai docs: https://docs.z.ai/devpack/tool/claude
export const GLM_MODEL_MAPPINGS = {
  haiku: 'GLM-4.5-Air',
  sonnet: 'GLM-4.7',
  opus: 'GLM-4.7'
};

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

export interface UserConfig {
  userId: number;
  currentRepositoryId?: string;
  deletedRepositories?: DeletedRepository[];
  git?: {
    userName?: string;
    userEmail?: string;
    defaultBranch?: string;
  };
  preferences?: {
    autoCommit?: boolean;
    autoPush?: boolean;
    notifyOnTaskComplete?: boolean;
    dangerModeEnabled?: boolean;
  };
  techStack?: TechStackPreferences;
  aiProvider?: AIProviderConfig;
  claudeMdTemplate?: string;
  mcpConfigs?: Record<string, McpConfig>;
  limits?: {
    maxConcurrentTasks?: number;
    taskTimeoutMs?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Beast Mode Types
export interface BeastModeConfig {
  maxIterations: number;          // Maximum iteration cycles (default: 10)
  maxDurationMs: number;          // Maximum total duration (default: 30 min)
  iterationTimeoutMs: number;     // Per-iteration timeout (default: 10 min)
  stopOnSuccess: boolean;         // Stop when tests pass (default: true)
  autoCommitPerIteration: boolean;// Commit after each iteration (default: false)
}

export interface BeastModeState {
  sessionId: string;
  userId: number;
  chatId: number;
  originalRequest: string;
  workingDir: string;
  status: BeastModeStatus;
  iteration: number;
  startTime: Date;
  endTime?: Date;
  iterations: BeastIteration[];
  config: BeastModeConfig;
  messageId?: number;             // Status message to update
  cleanedUp?: boolean;            // Tracks if cleanup has been performed
  aiProvider?: AIProviderConfig;  // AI provider configuration
}

export interface BeastIteration {
  number: number;
  startTime: Date;
  endTime?: Date;
  prompt: string;
  output: string;
  analysis: IterationAnalysis;
  taskId: string;
}

export interface IterationAnalysis {
  hasErrors: boolean;
  hasTestFailures: boolean;
  hasBuildFailures: boolean;
  isComplete: boolean;
  errorSummary?: string;
  suggestedAction?: string;
}

export enum BeastModeStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STOPPED = 'stopped',           // User stopped manually
  MAX_ITERATIONS = 'max_iterations',
  TIMEOUT = 'timeout'
}
