"use client";

import { useState, useEffect, createContext, useContext, useCallback } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServerBar } from "./server-bar";
import { ChatSidebar } from "./chat-sidebar";
import { api, type Repository } from "@/lib/api";

export interface DraftSession {
  id: string;
  name: string;
  createdAt: string;
}

interface ChatContextType {
  activeWorkspace: string;
  setActiveWorkspace: (id: string) => void;
  activeSession: string;
  setActiveSession: (id: string) => void;
  selectedFile: string | null;
  setSelectedFile: (path: string | null) => void;
  currentRepository: Repository | null;
  showSettings: boolean;
  setShowSettings: (show: boolean) => void;
  draftSessions: DraftSession[];
  createNewSession: () => string;
  removeDraftSession: (id: string) => void;
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
  const [activeSession, setActiveSession] = useState<string>("general");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);

  // Create a new draft session
  const createNewSession = useCallback(() => {
    const id = `draft-${Date.now()}`;
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
  const removeDraftSession = useCallback((id: string) => {
    setDraftSessions((prev) => prev.filter((s) => s.id !== id));
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
