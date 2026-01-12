"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings, Github, X } from "lucide-react";
import { api, type FileNode, type Task } from "@/lib/api";
import { ChatTab, FoldersTab, HistoryTab, UserPanel, type Session } from "./sidebar";
import { type DraftSession, useChatContext } from "./chat-layout";

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const DEFAULT_WIDTH = 256;

interface ChatSidebarProps {
  workspaceName?: string;
  repositoryId?: string;
  gitUrl?: string;
  activeSession?: string;
  draftSessions?: DraftSession[];
  customSessionNames?: Record<string, string>;
  sessionOrder?: string[];
  archivedSessions?: Set<string>;
  onSessionSelect?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, name: string) => void;
  onSessionReorder?: (sessionIds: string[]) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionUnarchive?: (sessionId: string) => void;
  onFileSelect?: (filePath: string) => void;
  onNewSession?: () => void;
  onShowSettings?: () => void;
}


export function ChatSidebar({
  workspaceName = "tg-claude",
  repositoryId,
  gitUrl,
  activeSession,
  draftSessions = [],
  customSessionNames = {},
  sessionOrder = [],
  archivedSessions = new Set(),
  onSessionSelect,
  onSessionRename,
  onSessionReorder,
  onSessionArchive,
  onSessionUnarchive,
  onFileSelect,
  onNewSession,
  onShowSettings,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "folders" | "history">("chat");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileTreeVersion, setFileTreeVersion] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { isMobileSidebarOpen, closeMobileSidebar } = useChatContext();

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX - 68)); // 68px is server bar width
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing]);

  // Fetch sessions from tasks - group by sessionId
  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const tasks = await api.getTasks(1);

        // Group tasks by sessionId - tasks with same sessionId are one conversation
        const sessionGroups = new Map<string, Task[]>();
        for (const task of tasks) {
          const key = task.sessionId || task.id; // Use sessionId if available, else task id
          const existing = sessionGroups.get(key) || [];
          existing.push(task);
          sessionGroups.set(key, existing);
        }

        // Create session entries from groups
        const taskSessions: Session[] = [];
        for (const [, groupTasks] of sessionGroups) {
          // Sort tasks in group by time (oldest first) to get the first prompt
          groupTasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          const firstTask = groupTasks[0];
          const latestTask = groupTasks[groupTasks.length - 1];

          // Use the first task's id as the session id (for navigation)
          // Use custom name if set, otherwise first task's prompt
          // Use the latest task's status for the session status
          const sessionId = firstTask.id;
          const defaultName = firstTask.prompt.slice(0, 30) + (firstTask.prompt.length > 30 ? "..." : "");
          taskSessions.push({
            id: sessionId,
            name: customSessionNames[sessionId] || defaultName,
            status: latestTask.status === "running" ? "running" : latestTask.status === "completed" ? "completed" : "idle",
            timestamp: firstTask.startTime,
          });
        }

        // Convert draft sessions to Session format (filtered by current repository)
        const draftSessionsList: Session[] = draftSessions
          .filter((ds) => ds.repositoryId === repositoryId)
          .map((ds) => ({
            id: ds.id,
            name: ds.name,
            status: "idle" as const,
            timestamp: ds.createdAt,
          }));

        // Combine all sessions (excluding default which is always first)
        const allSessions = [...draftSessionsList, ...taskSessions.slice(0, 9)];

        // Apply custom order if available, otherwise sort by timestamp
        if (sessionOrder.length > 0) {
          allSessions.sort((a, b) => {
            const aIndex = sessionOrder.indexOf(a.id);
            const bIndex = sessionOrder.indexOf(b.id);
            // Sessions not in order go to the end, sorted by timestamp
            if (aIndex === -1 && bIndex === -1) {
              return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
            }
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
          });
        } else {
          // Default: sort by timestamp (newest first)
          allSessions.sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());
        }

        setSessions(allSessions);
      } catch {
        // Convert draft sessions to Session format even on error (filtered by current repository)
        const draftSessionsList: Session[] = draftSessions
          .filter((ds) => ds.repositoryId === repositoryId)
          .map((ds) => ({
            id: ds.id,
            name: ds.name,
            status: "idle" as const,
            timestamp: ds.createdAt,
          }));
        setSessions(draftSessionsList);
      }
    };

    fetchSessions();
    const interval = setInterval(fetchSessions, 5000);
    return () => clearInterval(interval);
  }, [draftSessions, customSessionNames, sessionOrder, repositoryId]);

  // Fetch file tree when repository changes (with auto-refresh)
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
    const interval = setInterval(fetchFileTree, 10000); // Refresh every 10s
    return () => clearInterval(interval);
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

  return (
    <div
      ref={sidebarRef}
      className={cn(
        "bg-secondary/30 flex flex-col border-r border-border relative h-full",
        // On mobile when sidebar is open, use fixed width
        isMobileSidebarOpen ? "w-[280px] md:w-auto" : ""
      )}
      style={{ width: isMobileSidebarOpen ? undefined : sidebarWidth }}
    >
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
          {/* Mobile close button */}
          <button
            onClick={closeMobileSidebar}
            className="w-7 h-7 md:hidden flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="w-4 h-4" />
          </button>
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
        <button
          onClick={() => setActiveTab("history")}
          className={cn(
            "flex-1 py-2.5 text-sm font-medium transition-colors",
            activeTab === "history"
              ? "text-primary border-b-2 border-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          History
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {activeTab === "chat" ? (
          <ChatTab
            sessions={sessions}
            activeSession={activeSession}
            archivedSessions={archivedSessions}
            onSessionSelect={onSessionSelect}
            onSessionRename={onSessionRename}
            onSessionReorder={onSessionReorder}
            onSessionArchive={onSessionArchive}
            onSessionUnarchive={onSessionUnarchive}
            onNewSession={onNewSession}
          />
        ) : activeTab === "folders" ? (
          <FoldersTab
            fileTree={fileTree}
            expandedFolders={expandedFolders}
            onToggleFolder={toggleFolder}
            onFileSelect={onFileSelect}
            repositoryId={repositoryId}
            onFileCreated={() => setFileTreeVersion((v) => v + 1)}
          />
        ) : (
          <HistoryTab repositoryId={repositoryId} />
        )}
      </ScrollArea>

      {/* User Panel */}
      <UserPanel />

      {/* Resize Handle - hidden on mobile */}
      <div
        onMouseDown={handleMouseDown}
        className={cn(
          "absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/50 transition-colors hidden md:block",
          isResizing && "bg-primary/50"
        )}
      />
    </div>
  );
}
