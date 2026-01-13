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
  // Discord configuration
  discordToken?: string;
  discordClientId?: string;
  discordGuildId?: string;
  discordAllowedUserIds?: string[];
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

export interface UserActivity {
  userId: number;
  requestsThisHour: number;
  requestsToday: number;
  lastRequestTime: Date;
  hourStartTime: Date;
  dayStartTime: Date;
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
  platform?: 'telegram' | 'discord';
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
export type AIProvider = 'anthropic' | 'glm' | 'openrouter';

export interface AIProviderConfig {
  provider: AIProvider;
  // Provider-specific keys (recommended so switching providers doesn't reuse the wrong token)
  glmApiKey?: string;
  openrouterApiKey?: string;
  model?: string;         // Optional model override (legacy)
  haikuModel?: string;    // Custom model for Haiku slot
  sonnetModel?: string;   // Custom model for Sonnet slot
  opusModel?: string;     // Custom model for Opus slot
}

export const AI_PROVIDER_ENDPOINTS: Record<AIProvider, string | undefined> = {
  anthropic: undefined,   // Uses default Anthropic endpoint
  glm: 'https://api.z.ai/api/anthropic',  // Z.ai GLM endpoint
  openrouter: 'https://openrouter.ai/api'  // OpenRouter endpoint
};

// GLM model mappings for Claude Code's internal model slots (Haiku/Sonnet/Opus)
// Per Z.ai docs: https://docs.z.ai/devpack/tool/claude
export const GLM_MODEL_MAPPINGS = {
  haiku: 'GLM-4.5-Air',
  sonnet: 'GLM-4.7',
  opus: 'GLM-4.7'
};

// OpenRouter default model mappings (users can override via env vars or config)
// Per OpenRouter docs: https://openrouter.ai/docs/guides/guides/claude-code-integration
export const OPENROUTER_MODEL_MAPPINGS = {
  haiku: 'minimax/minimax-m2.1',
  sonnet: 'minimax/minimax-m2.1',
  opus: 'minimax/minimax-m2.1'
};

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

// GitHub Integration Types
export interface GitHubAppConnection {
  installationId: number;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
  scope?: string;
  connectedAt: Date;
  login?: string; // GitHub username
  avatarUrl?: string;
}

export interface UserConfig {
  userId: number;
  currentRepositoryId?: string;
  currentRepositoryPath?: string;
  deletedRepositories?: DeletedRepository[];
  git?: {
    userName?: string;
    userEmail?: string;
    defaultBranch?: string;
  };
  preferences?: {
    notifyOnTaskComplete?: boolean;
  };
  techStack?: TechStackPreferences;
  aiProvider?: AIProviderConfig;
  claudeMdTemplate?: string;
  // GitHub authentication
  githubPat?: string;  // Personal Access Token (fallback option)
  github?: GitHubAppConnection;  // GitHub App OAuth connection (primary)
  mcpConfigs?: Record<string, McpConfig>;
  enabledPlugins?: string[]; // List of enabled plugin IDs (e.g., ['ralph-loop', 'commit-commands'])
  limits?: {
    maxConcurrentTasks?: number;
    taskTimeoutMs?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

// Claude Code Streaming Event Types (from --output-format stream-json)
export type StreamActionKind = 'command' | 'tool' | 'file_change' | 'web_search' | 'note' | 'turn' | 'warning' | 'telemetry';
export type StreamActionPhase = 'started' | 'updated' | 'completed';
export type StreamActionLevel = 'debug' | 'info' | 'warning' | 'error';

export interface StreamAction {
  id: string;
  kind: StreamActionKind;
  title: string;
  detail?: Record<string, unknown>;
}

// Raw Claude Code JSON event types
export interface ClaudeSystemEvent {
  type: 'system';
  subtype?: 'init';
  session_id?: string;
  message?: string;
}

export interface ClaudeAssistantEvent {
  type: 'assistant';
  message: {
    content: Array<{
      type: string;
      tool_use_id?: string;
      name?: string;
      input?: Record<string, unknown>;
      text?: string;
    }>;
  };
}

export interface ClaudeUserEvent {
  type: 'user';
  message: {
    content: Array<{
      type: string;
      tool_use_id?: string;
      content?: string;
      is_error?: boolean;
    }>;
  };
}

export interface ClaudeResultEvent {
  type: 'result';
  result?: string;
  cost_usd?: number;
  total_cost_usd?: number;  // Claude Code CLI uses this field name
  is_error?: boolean;
  duration_ms?: number;
  session_id?: string;
}

export type ClaudeStreamEvent = ClaudeSystemEvent | ClaudeAssistantEvent | ClaudeUserEvent | ClaudeResultEvent;

// Parsed/normalized streaming events (similar to takopi's TakopieEvent)
export interface StreamStartedEvent {
  type: 'started';
  sessionId: string;
  title?: string;
}

export interface StreamActionEvent {
  type: 'action';
  action: StreamAction;
  phase: StreamActionPhase;
  ok?: boolean;
  message?: string;
  level?: StreamActionLevel;
}

export interface StreamCompletedEvent {
  type: 'completed';
  ok: boolean;
  answer: string;
  sessionId?: string;
  error?: string;
  costUsd?: number;
  durationMs?: number;
}

export type StreamEvent = StreamStartedEvent | StreamActionEvent | StreamCompletedEvent;

// Image content types for multimodal input
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64';
    media_type: ImageMediaType;
    data: string; // base64 encoded image data
  };
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = TextContent | ImageContent;

// Extended ClaudeTask with streaming support
export interface ClaudeTaskWithStreaming extends ClaudeTask {
  sessionId?: string;
  actions: StreamAction[];
  currentAction?: StreamAction;
  costUsd?: number;
  events: StreamEvent[];
  images?: ImageContent[]; // Optional images attached to the task
}
