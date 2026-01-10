const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

export interface Task {
  id: string;
  userId: number;
  chatId: number;
  prompt: string;
  workingDir: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "timeout";
  startTime: string;
  endTime?: string;
  output: string;
  errorOutput: string;
  exitCode?: number;
  sessionId?: string;
  costUsd?: number;
  actions?: StreamAction[];
  currentAction?: StreamAction;
}

export interface StreamAction {
  id: string;
  kind: "command" | "tool" | "file_change" | "web_search" | "note" | "turn" | "warning" | "telemetry";
  title: string;
  detail?: Record<string, unknown>;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  type: "cloned" | "new" | "existing";
  gitUrl?: string;
  branch?: string;
  createdAt: string;
  lastUsed: string;
}

export interface UserConfig {
  userId: number;
  currentRepositoryId?: string;
  currentRepositoryPath?: string;
  aiProvider?: {
    provider: "anthropic" | "glm" | "openrouter";
    haikuModel?: string;
    sonnetModel?: string;
    opusModel?: string;
  };
  mcpConfigs?: Record<string, McpConfig>;
  claudeMdTemplate?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServer>;
}

export interface McpServer {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HealthResponse {
  status: string;
  uptime: number;
  activeTasks: number;
  stats: {
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    uniqueUsers: number;
  };
  timestamp: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Health & Metrics
  async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>("/health");
  }

  // Tasks
  async getTasks(userId?: number): Promise<Task[]> {
    const params = userId ? `?userId=${userId}` : "";
    return this.request<Task[]>(`/api/tasks${params}`);
  }

  async getTask(taskId: string): Promise<Task> {
    return this.request<Task>(`/api/tasks/${taskId}`);
  }

  async createTask(prompt: string, workingDir: string, userId: number): Promise<Task> {
    return this.request<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ prompt, workingDir, userId }),
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request<void>(`/api/tasks/${taskId}`, { method: "DELETE" });
  }

  // Repositories
  async getRepositories(userId: number): Promise<Repository[]> {
    return this.request<Repository[]>(`/api/repositories?userId=${userId}`);
  }

  async createRepository(userId: number, name: string): Promise<Repository> {
    return this.request<Repository>("/api/repositories", {
      method: "POST",
      body: JSON.stringify({ userId, name, type: "new" }),
    });
  }

  async cloneRepository(userId: number, gitUrl: string, name?: string, branch?: string): Promise<Repository> {
    return this.request<Repository>("/api/repositories", {
      method: "POST",
      body: JSON.stringify({ userId, gitUrl, name, branch, type: "clone" }),
    });
  }

  async switchRepository(userId: number, repositoryId: string): Promise<void> {
    await this.request<void>(`/api/repositories/${repositoryId}/switch`, {
      method: "POST",
      body: JSON.stringify({ userId }),
    });
  }

  // Config
  async getConfig(userId: number): Promise<UserConfig> {
    return this.request<UserConfig>(`/api/config?userId=${userId}`);
  }

  async updateConfig(userId: number, config: Partial<UserConfig>): Promise<UserConfig> {
    return this.request<UserConfig>("/api/config", {
      method: "PUT",
      body: JSON.stringify({ userId, ...config }),
    });
  }
}

export const api = new ApiClient();
