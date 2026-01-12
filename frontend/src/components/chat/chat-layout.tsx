"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServerBar } from "./server-bar";
import { ChatSidebar } from "./chat-sidebar";
import { api, type Repository } from "@/lib/api";
import { type DraftSession, type SessionId, isDraftSessionId } from "@/lib/types";

export type { DraftSession };

interface ChatContextType {
  activeWorkspace: string;
  setActiveWorkspace: (id: string) => void;
  activeSession: SessionId;
  setActiveSession: (id: SessionId) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  currentRepository: Repository | null;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  draftSessions: DraftSession[];
  createNewSession: () => DraftSession["id"];
  removeDraftSession: (id: DraftSession["id"]) => void;
  renameDraftSession: (id: DraftSession["id"], name: string) => void;
  customSessionNames: Record<string, string>;
  setCustomSessionName: (sessionId: string, name: string) => void;
  sessionOrder: string[];
  setSessionOrder: (order: string[]) => void;
  archivedSessions: Set<string>;
  archiveSession: (sessionId: string) => void;
  unarchiveSession: (sessionId: string) => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function useChatContext() {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChatContext must be used within ChatLayout");
  }
  return context;
}

interface ChatLayoutProps {
  children?: React.ReactNode;
}

export function ChatLayout({ children }: ChatLayoutProps) {
  const [activeWorkspace, setActiveWorkspace] = useState<string>("");
  const [activeSession, setActiveSession] = useState<SessionId>("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [customSessionNames, setCustomSessionNames] = useState<Record<string, string>>({});
  const [sessionOrder, setSessionOrderState] = useState<string[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<Set<string>>(new Set());

  // Load custom session names, order, and archived from localStorage on mount
  useEffect(() => {
    const storedNames = localStorage.getItem("customSessionNames");
    if (storedNames) {
      try {
        setCustomSessionNames(JSON.parse(storedNames));
      } catch {
        // Ignore parse errors
      }
    }
    const storedOrder = localStorage.getItem("sessionOrder");
    if (storedOrder) {
      try {
        setSessionOrderState(JSON.parse(storedOrder));
      } catch {
        // Ignore parse errors
      }
    }
    const storedArchived = localStorage.getItem("archivedSessions");
    if (storedArchived) {
      try {
        setArchivedSessions(new Set(JSON.parse(storedArchived)));
      } catch {
        // Ignore parse errors
      }
    }
  }, []);

  // Save custom session name to localStorage
  const setCustomSessionName = useCallback((sessionId: string, name: string) => {
    setCustomSessionNames((prev) => {
      const updated = { ...prev, [sessionId]: name };
      localStorage.setItem("customSessionNames", JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Save session order to localStorage
  const setSessionOrder = useCallback((order: string[]) => {
    setSessionOrderState(order);
    localStorage.setItem("sessionOrder", JSON.stringify(order));
  }, []);

  // Archive a session
  const archiveSession = useCallback((sessionId: string) => {
    setArchivedSessions((prev) => {
      const updated = new Set(prev);
      updated.add(sessionId);
      localStorage.setItem("archivedSessions", JSON.stringify([...updated]));
      return updated;
    });
  }, []);

  // Unarchive a session
  const unarchiveSession = useCallback((sessionId: string) => {
    setArchivedSessions((prev) => {
      const updated = new Set(prev);
      updated.delete(sessionId);
      localStorage.setItem("archivedSessions", JSON.stringify([...updated]));
      return updated;
    });
  }, []);

  // Create a new draft session
  const createNewSession = useCallback((): DraftSession["id"] => {
    const id = `draft-${Date.now()}` as const;
    const newSession: DraftSession = {
      id,
      name: "New Session",
      createdAt: new Date().toISOString(),
      repositoryId: activeWorkspace || undefined,
    };
    setDraftSessions((prev) => [newSession, ...prev]);
    setActiveSession(id);
    setSelectedFile(null);
    setShowSettings(false);
    return id;
  }, [activeWorkspace]);

  // Remove a draft session (when it becomes a real task)
  const removeDraftSession = useCallback((id: DraftSession["id"]) => {
    setDraftSessions((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Rename a draft session
  const renameDraftSession = useCallback((id: DraftSession["id"], name: string) => {
    setDraftSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name } : s))
    );
  }, []);

  // Fetch repository details when workspace changes
  useEffect(() => {
    if (!activeWorkspace) {
      setCurrentRepository(null);
      return;
    }

    // Reset active session when switching workspaces
    setActiveSession("");
    setSelectedFile(null);
    setShowSettings(false);

    const fetchRepository = async () => {
      try {
        const repos = await api.getRepositories(1);
        const repo = repos.find((r) => r.id === activeWorkspace);
        setCurrentRepository(repo || null);
      } catch {
        setCurrentRepository(null);
      }
    };

    fetchRepository();
  }, [activeWorkspace]);

  return (
    <ChatContext.Provider
      value={{
        activeWorkspace,
        setActiveWorkspace,
        activeSession,
        setActiveSession,
        selectedFile,
        setSelectedFile,
        currentRepository,
        showSettings,
        setShowSettings,
        draftSessions,
        createNewSession,
        removeDraftSession,
        renameDraftSession,
        customSessionNames,
        setCustomSessionName,
        sessionOrder,
        setSessionOrder,
        archivedSessions,
        archiveSession,
        unarchiveSession,
      }}
    >
      <TooltipProvider>
        <div className="flex h-screen bg-background overflow-hidden">
          {/* Server Bar */}
          <ServerBar
            activeWorkspace={activeWorkspace}
            onWorkspaceSelect={setActiveWorkspace}
          />

          {/* Chat Sidebar */}
          <ChatSidebar
            workspaceName={currentRepository?.name || "Claude Hub"}
            repositoryId={activeWorkspace || undefined}
            gitUrl={currentRepository?.gitUrl}
            activeSession={activeSession}
            draftSessions={draftSessions}
            customSessionNames={customSessionNames}
            sessionOrder={sessionOrder}
            archivedSessions={archivedSessions}
            onSessionSelect={(sessionId) => {
              setActiveSession(sessionId);
              setSelectedFile(null);
              setShowSettings(false);
            }}
            onSessionRename={(sessionId, name) => {
              if (isDraftSessionId(sessionId)) {
                renameDraftSession(sessionId, name);
              } else {
                setCustomSessionName(sessionId, name);
              }
            }}
            onSessionReorder={setSessionOrder}
            onSessionArchive={archiveSession}
            onSessionUnarchive={unarchiveSession}
            onFileSelect={setSelectedFile}
            onNewSession={() => {
              createNewSession();
            }}
            onShowSettings={() => {
              setShowSettings(true);
              setSelectedFile(null);
            }}
          />

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {children}
          </main>
        </div>
      </TooltipProvider>
    </ChatContext.Provider>
  );
}
