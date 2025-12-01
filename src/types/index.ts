export type LLMProvider = 'anthropic' | 'deepseek';

export interface LLMProviderConfig {
  provider: LLMProvider;
  apiKey: string;
  baseUrl?: string;  // Optional custom base URL
  model?: string;    // Optional model override
}

// MCP Server Configuration Types
export type MCPTransport = 'http' | 'stdio' | 'sse';

export interface MCPServerConfig {
  name: string;
  transport: MCPTransport;
  url?: string;           // For http/sse transport
  command?: string;       // For stdio transport
  args?: string[];        // Additional arguments for stdio
  env?: Record<string, string>;  // Environment variables
  enabled: boolean;
  description?: string;
}

export interface MCPPreset {
  id: string;
  name: string;
  description: string;
  servers: MCPServerConfig[];
}

// Predefined MCP server templates for easy setup
export const MCP_SERVER_TEMPLATES: Record<string, Omit<MCPServerConfig, 'name' | 'enabled'>> = {
  'filesystem': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-filesystem', '/tmp'],
    description: 'File system access MCP server'
  },
  'github': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-github'],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
    description: 'GitHub integration MCP server'
  },
  'postgres': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-postgres'],
    env: { DATABASE_URL: '${DATABASE_URL}' },
    description: 'PostgreSQL database MCP server'
  },
  'sqlite': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-sqlite'],
    description: 'SQLite database MCP server'
  },
  'brave-search': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-brave-search'],
    env: { BRAVE_API_KEY: '${BRAVE_API_KEY}' },
    description: 'Brave Search MCP server'
  },
  'fetch': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-fetch'],
    description: 'HTTP fetch MCP server'
  },
  'memory': {
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@anthropic/mcp-server-memory'],
    description: 'Knowledge graph memory MCP server'
  }
};

// User's MCP configuration
export interface UserMCPConfig {
  servers: MCPServerConfig[];
  activePreset?: string;
  customEnv?: Record<string, string>;  // User-specific env vars for MCP
}

export interface BotConfig {
  telegramToken: string;
  claudeApiKey: string;       // Legacy - prefer llmProvider
  githubToken: string;
  allowedUserIds: number[];
  workspacePath: string;
  maxConcurrentTasks: number;
  taskTimeoutMs: number;
  maxOutputSize: number;
  logLevel: string;
  logFile: string;
  maxRequestsPerUserPerHour: number;
  maxRequestsPerUserPerDay: number;
  llmProvider?: LLMProviderConfig;  // New unified LLM provider config
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
  mcpConfig?: UserMCPConfig;  // MCP servers to enable for this execution
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
  limits?: {
    maxConcurrentTasks?: number;
    taskTimeoutMs?: number;
  };
  mcp?: UserMCPConfig;  // MCP server configuration
  createdAt: Date;
  updatedAt: Date;
}
