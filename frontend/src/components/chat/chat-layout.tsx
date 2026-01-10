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
  const [activeSession, setActiveSession] = useState<SessionId>("general");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);

  // Create a new draft session
  const createNewSession = useCallback((): DraftSession["id"] => {
    const id = `draft-${Date.now()}` as const;
    const newSession: DraftSession = {
      id,
      name: "New Session",
      createdAt: new Date().toISOString(),
    };
    setDraftSessions((prev) => [newSession, ...prev]);
    setActiveSession(id);
    setSelectedFile(null);
    setShowSettings(false);
    return id;
  }, []);

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
            onSessionSelect={(sessionId) => {
              setActiveSession(sessionId);
              setSelectedFile(null);
              setShowSettings(false);
            }}
            onSessionRename={(sessionId, name) => {
              if (isDraftSessionId(sessionId)) {
                renameDraftSession(sessionId, name);
              }
            }}
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
