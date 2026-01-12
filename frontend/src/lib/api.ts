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

export interface StreamEvent {
  type: "init" | "started" | "action" | "completed" | "stream_end";
  task?: Partial<Task>;
  sessionId?: string;
  action?: StreamAction;
  phase?: "started" | "completed";
  ok?: boolean;
  answer?: string;
  costUsd?: number;
  message?: string;
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
    glmApiKey?: string;
    openrouterApiKey?: string;
    haikuModel?: string;
    sonnetModel?: string;
    opusModel?: string;
  };
  effectiveModels?: {
    haiku: string;
    sonnet: string;
    opus: string;
  };
  mcpConfigs?: Record<string, McpConfig>;
  claudeMdTemplate?: string;
  enabledPlugins?: string[];
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

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
}

export interface FileContent {
  content: string;
  path: string;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  subject: string;
  author: { name: string; email: string };
  date: string;
  refs: string[];
}

export interface GitCommitDiff {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: { name: string; email: string };
  date: string;
  diff: string;
}

export type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

export interface ImageContent {
  type: "image";
  source: {
    type: "base64";
    media_type: ImageMediaType;
    data: string;
  };
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

  async createTask(
    prompt: string,
    workingDir: string,
    userId: number,
    options?: {
      resumeSessionId?: string;
      newSession?: boolean;
      images?: ImageContent[];
    }
  ): Promise<Task & { sessionId?: string }> {
    return this.request<Task & { sessionId?: string }>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        workingDir,
        userId,
        resumeSessionId: options?.resumeSessionId,
        newSession: options?.newSession,
        images: options?.images,
      }),
    });
  }

  async cancelTask(taskId: string): Promise<void> {
    await this.request<void>(`/api/tasks/${taskId}`, { method: "DELETE" });
  }

  // Subscribe to task streaming events via SSE
  subscribeToTaskStream(
    taskId: string,
    onEvent: (event: StreamEvent) => void,
    onError?: (error: Error) => void
  ): () => void {
    const url = `${this.baseUrl}/api/tasks/${taskId}/stream`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as StreamEvent;
        onEvent(event);

        // Close connection when stream ends
        if (event.type === "stream_end") {
          eventSource.close();
        }
      } catch (err) {
        console.error("Failed to parse SSE event:", err);
      }
    };

    eventSource.onerror = (e) => {
      console.error("SSE error:", e);
      eventSource.close();
      if (onError) {
        onError(new Error("SSE connection failed"));
      }
    };

    // Return cleanup function
    return () => {
      eventSource.close();
    };
  }

  // Repositories
  async getRepositories(userId: number): Promise<Repository[]> {
    return this.request<Repository[]>(`/api/repositories?userId=${userId}`);
  }

  async createRepository(
    userId: number,
    name: string,
    options?: { createGithub?: boolean; isPrivate?: boolean }
  ): Promise<Repository> {
    return this.request<Repository>("/api/repositories", {
      method: "POST",
      body: JSON.stringify({
        userId,
        name,
        type: "new",
        createGithub: options?.createGithub ?? true,
        isPrivate: options?.isPrivate ?? false,
      }),
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

  async getFileTree(userId: number, repositoryId: string): Promise<FileNode[]> {
    return this.request<FileNode[]>(`/api/repositories/${repositoryId}/files?userId=${userId}`);
  }

  async getFileContent(userId: number, repositoryId: string, filePath: string): Promise<FileContent> {
    return this.request<FileContent>(`/api/repositories/${repositoryId}/file?userId=${userId}&path=${encodeURIComponent(filePath)}`);
  }

  async saveFileContent(userId: number, repositoryId: string, filePath: string, content: string): Promise<{ success: boolean; path: string }> {
    return this.request<{ success: boolean; path: string }>(`/api/repositories/${repositoryId}/file`, {
      method: "PUT",
      body: JSON.stringify({ userId, path: filePath, content }),
    });
  }

  // Git History
  async getCommits(userId: number, repositoryId: string, limit: number = 50): Promise<GitCommit[]> {
    return this.request<GitCommit[]>(`/api/repositories/${repositoryId}/commits?userId=${userId}&limit=${limit}`);
  }

  async getCommitDiff(userId: number, repositoryId: string, sha: string): Promise<GitCommitDiff> {
    return this.request<GitCommitDiff>(`/api/repositories/${repositoryId}/commits/${sha}/diff?userId=${userId}`);
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
