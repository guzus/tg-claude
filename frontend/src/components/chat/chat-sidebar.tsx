"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings, Github } from "lucide-react";
import { api, type FileNode, type Task } from "@/lib/api";
import { ChatTab, FoldersTab, HistoryTab, UserPanel, type Session } from "./sidebar";
import { type DraftSession } from "./chat-layout";

interface ChatSidebarProps {
  workspaceName?: string;
  repositoryId?: string;
  gitUrl?: string;
  activeSession?: string;
  draftSessions?: DraftSession[];
  customSessionNames?: Record<string, string>;
  sessionOrder?: string[];
  onSessionSelect?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, name: string) => void;
  onSessionReorder?: (sessionIds: string[]) => void;
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
  onSessionSelect,
  onSessionRename,
  onSessionReorder,
  onFileSelect,
  onNewSession,
  onShowSettings,
}: ChatSidebarProps) {
  const [activeTab, setActiveTab] = useState<"chat" | "folders" | "history">("chat");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [fileTree, setFileTree] = useState<FileNode[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [fileTreeVersion, setFileTreeVersion] = useState(0);

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

        // Convert draft sessions to Session format
        const draftSessionsList: Session[] = draftSessions.map((ds) => ({
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
        // Convert draft sessions to Session format even on error
        const draftSessionsList: Session[] = draftSessions.map((ds) => ({
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
  }, [draftSessions, customSessionNames, sessionOrder]);

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
            onSessionSelect={onSessionSelect}
            onSessionRename={onSessionRename}
            onSessionReorder={onSessionReorder}
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
      <UserPanel onShowSettings={onShowSettings} />
    </div>
  );
}
