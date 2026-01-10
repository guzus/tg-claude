"use client";

import { useState, useEffect, createContext, useContext } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServerBar } from "./server-bar";
import { ChatSidebar } from "./chat-sidebar";
import { api, type Repository } from "@/lib/api";

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
  const [activeSession, setActiveSession] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
            onSessionSelect={(sessionId) => {
              setActiveSession(sessionId);
              setSelectedFile(null);
              setShowSettings(false);
            }}
            onFileSelect={setSelectedFile}
            onNewSession={() => {
              setActiveSession("general");
              setSelectedFile(null);
              setShowSettings(false);
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
