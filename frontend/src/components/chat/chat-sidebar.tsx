"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Settings,
  ChevronDown,
  ChevronRight,
  Plus,
  MessageCircle,
  Play,
  CheckCircle2,
  Circle,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  File,
  Github,
  FilePlus,
  X,
  Loader2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { api, type FileNode, type Task } from "@/lib/api";

interface Session {
  id: string;
  name: string;
  status: "running" | "completed" | "idle";
  timestamp?: string;
}

interface ChatSidebarProps {
  workspaceName?: string;
  repositoryId?: string;
  gitUrl?: string;
  activeSession?: string;
  onSessionSelect?: (sessionId: string) => void;
  onFileSelect?: (filePath: string) => void;
  onNewSession?: () => void;
  onShowSettings?: () => void;
}

const DEFAULT_SESSION: Session = {
  id: "general",
  name: "General",
  status: "idle",
};

export function ChatSidebar({
  workspaceName = "tg-claude",
  repositoryId,
  gitUrl,
  activeSession,
  onSessionSelect,
  onFileSelect,
  onNewSession,
  onShowSettings,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "folders">("chat");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileTreeVersion, setFileTreeVersion] = useState(0);

  // Fetch sessions from tasks
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const tasks = await api.getTasks(1);
        const taskSessions: Session[] = tasks.map((task: Task) => ({
          id: task.id,
          name: task.prompt.slice(0, 30) + (task.prompt.length > 30 ? "..." : ""),
          status: task.status === "running" ? "running" : task.status === "completed" ? "completed" : "idle",
          timestamp: task.startTime,
        }));
        // Always include default session first, then task sessions
        setSessions([DEFAULT_SESSION, ...taskSessions.slice(0, 9)]);
      } catch {
        setSessions([DEFAULT_SESSION]);
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch file tree when repository changes
  useEffect(() => {
    if (!repositoryId) {
      setFileTree([]);
      return;
    }

    const fetchFileTree = async () => {
      try {
        const tree = await api.getFileTree(1, repositoryId);
        setFileTree(tree);
      } catch {
        // Repository may not exist yet - show empty tree
        setFileTree([]);
      }
    };

    fetchFileTree();
  }, [repositoryId, fileTreeVersion]);

  const toggleFolder = (path: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getStatusIcon = (status: Session["status"]) => {
    switch (status) {
      case "running":
        return <Play className="w-3 h-3 text-amber-500 fill-amber-500" />;
      case "completed":
        return <CheckCircle2 className="w-3 h-3 text-emerald-500" />;
      default:
        return <Circle className="w-3 h-3 text-muted-foreground/50" />;
    }
  };

  return (
    <div className="w-64 bg-secondary/30 flex flex-col border-r border-border">
      {/* Workspace Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
        <h2 className="font-semibold text-[15px] truncate flex-1">{workspaceName}</h2>
        <div className="flex items-center gap-1">
          {gitUrl && (
            <Tooltip delayDuration={0}>
              <TooltipTrigger asChild>
                <a
                  href={gitUrl.replace(/\.git$/, "")}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
                >
                  <Github className="w-4 h-4" />
                </a>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                Open on GitHub
              </TooltipContent>
            </Tooltip>
          )}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={onShowSettings}
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <Settings className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              Settings
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Tab Selector */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("chat")}
          className={cn(
            "flex-1 py-2.5 text-sm font-medium transition-colors",
            activeTab === "chat"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Chat
        </button>
        <button
          onClick={() => setActiveTab("folders")}
          className={cn(
            "flex-1 py-2.5 text-sm font-medium transition-colors",
            activeTab === "folders"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Folders
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeTab === "chat" ? (
          <ChatTab
            sessions={sessions}
            activeSession={activeSession}
            onSessionSelect={onSessionSelect}
            onNewSession={onNewSession}
            getStatusIcon={getStatusIcon}
          />
        ) : (
          <FoldersTab
            fileTree={fileTree}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onFileSelect={onFileSelect}
            repositoryId={repositoryId}
            onFileCreated={() => setFileTreeVersion((v) => v + 1)}
          />
        )}
      </ScrollArea>

      {/* User Panel */}
      <UserPanel onShowSettings={onShowSettings} />
    </div>
  );
}

interface ChatTabProps {
  sessions: Session[];
  activeSession?: string;
  onSessionSelect?: (sessionId: string) => void;
  onNewSession?: () => void;
  getStatusIcon: (status: Session["status"]) => React.ReactNode;
}

function ChatTab({ sessions, activeSession, onSessionSelect, onNewSession, getStatusIcon }: ChatTabProps) {
  return (
    <div className="px-2 py-3">
      {/* Section Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Sessions
        </span>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={onNewSession}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">New Session</TooltipContent>
        </Tooltip>
      </div>

      {/* Session List */}
      <div className="space-y-0.5">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-4 text-center">
            No sessions yet. Start a conversation!
          </p>
        ) : (
          sessions.map((session) => {
            const isActive = activeSession === session.id;
            return (
              <div
                key={session.id}
                className={cn(
                  "group flex items-center gap-2 px-2 py-2 rounded-md cursor-pointer",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
                onClick={() => onSessionSelect?.(session.id)}
              >
                {getStatusIcon(session.status)}
                <MessageCircle className="w-3.5 h-3.5 opacity-60" />
                <span className="flex-1 text-sm truncate">{session.name}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

interface FoldersTabProps {
  fileTree: FileNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  repositoryId?: string;
  onFileCreated?: () => void;
}

function FoldersTab({ fileTree, expandedFolders, onToggleFolder, onFileSelect, repositoryId, onFileCreated }: FoldersTabProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateFile = async () => {
    if (!newFilePath.trim() || !repositoryId) return;

    setIsLoading(true);
    setError(null);

    try {
      await api.saveFileContent(1, repositoryId, newFilePath.trim(), "");
      onFileCreated?.();
      onFileSelect?.(newFilePath.trim());
      setNewFilePath("");
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateFile();
    }
    if (e.key === "Escape") {
      setIsCreating(false);
      setNewFilePath("");
      setError(null);
    }
  };

  return (
    <div className="px-2 py-3">
      {/* Section Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Files
        </span>
        {repositoryId && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCreating(true)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">New File</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* New File Input */}
      {isCreating && (
        <div className="px-2 mb-3">
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              placeholder="path/to/file.ts"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="h-7 text-sm"
            />
            <button
              onClick={handleCreateFile}
              disabled={!newFilePath.trim() || isLoading}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewFilePath("");
                setError(null);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
      )}

      {/* File Tree */}
      {fileTree.length === 0 && !isCreating ? (
        <p className="text-sm text-muted-foreground px-2 py-4 text-center">
          No files found
        </p>
      ) : (
        <FileTreeNode
          nodes={fileTree}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          onFileSelect={onFileSelect}
          depth={0}
        />
      )}
    </div>
  );
}

interface FileTreeNodeProps {
  nodes: FileNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  depth: number;
}

function FileTreeNode({ nodes, expandedFolders, onToggleFolder, onFileSelect, depth }: FileTreeNodeProps) {
  const getFileIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
      case "js":
      case "jsx":
        return <FileCode className="w-4 h-4 text-primary" />;
      case "json":
        return <FileJson className="w-4 h-4 text-amber-500" />;
      case "md":
      case "txt":
        return <FileText className="w-4 h-4 text-muted-foreground" />;
      default:
        return <File className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.path);
        const paddingLeft = depth * 12 + 8;

        if (node.type === "directory") {
          return (
            <div key={node.path}>
              <div
                className="flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
                style={{ paddingLeft }}
                onClick={() => onToggleFolder(node.path)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-primary" />
                ) : (
                  <Folder className="w-4 h-4 text-primary" />
                )}
                <span className="text-sm truncate">{node.name}</span>
              </div>
              {isExpanded && node.children && (
                <FileTreeNode
                  nodes={node.children}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onFileSelect={onFileSelect}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        return (
          <div
            key={node.path}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
            style={{ paddingLeft: paddingLeft + 16 }}
            onClick={() => onFileSelect?.(node.path)}
          >
            {getFileIcon(node.name)}
            <span className="text-sm truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}

function UserPanel({ onShowSettings }: { onShowSettings?: () => void }) {
  return (
    <div className="h-14 px-3 flex items-center gap-3 bg-card border-t border-border shadow-subtle">
      {/* User Avatar */}
      <div className="relative">
        <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center text-background text-sm font-semibold">
          U
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 bg-primary rounded-full border-2 border-card" />
      </div>

      {/* User Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">User</p>
        <p className="text-[11px] text-primary truncate">Online</p>
      </div>

      {/* Settings Button */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowSettings}
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
