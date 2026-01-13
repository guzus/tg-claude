"use client";

import { useState, useEffect, createContext, useContext, useCallback, useRef } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServerBar } from "./server-bar";
import { ChatSidebar } from "./chat-sidebar";
import { api, type Repository } from "@/lib/api";
import { type DraftSession, type SessionId, isDraftSessionId } from "@/lib/types";
import { type Session } from "./sidebar";

export type { DraftSession };

type SidebarTab = "chat" | "folders" | "history";

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
  // Mobile navigation
  isMobileSidebarOpen: boolean;
  setMobileSidebarOpen: (open: boolean) => void;
  closeMobileSidebar: () => void;
  // Sidebar tab
  sidebarTab: SidebarTab;
  setSidebarTab: (tab: SidebarTab) => void;
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const isInitializedRef = useRef(false);

  const [activeWorkspace, setActiveWorkspaceState] = useState<string>("");
  const [activeSession, setActiveSessionState] = useState<SessionId>("");
  const [selectedFile, setSelectedFileState] = useState<string | null>(null);
  const [currentRepository, setCurrentRepository] = useState<Repository | null>(null);
  const [showSettings, setShowSettingsState] = useState(false);
  const [draftSessions, setDraftSessions] = useState<DraftSession[]>([]);
  const [customSessionNames, setCustomSessionNames] = useState<Record<string, string>>({});
  const [sessionOrder, setSessionOrderState] = useState<string[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<Set<string>>(new Set());
  const [isMobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTabState] = useState<SidebarTab>("chat");
  const shouldAutoSelectRef = useRef(false);

  // Update URL with current state
  const updateUrl = useCallback((params: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === "") {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }

    const queryString = newParams.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    router.replace(newUrl, { scroll: false });
  }, [router, pathname, searchParams]);

  // Wrapped setters that also update URL
  const setActiveWorkspace = useCallback((id: string) => {
    setActiveWorkspaceState(id);
    // Reset session and file when workspace changes
    setActiveSessionState("");
    setSelectedFileState(null);
    setShowSettingsState(false);
    shouldAutoSelectRef.current = true;
    updateUrl({ workspace: id || null, session: null, file: null, settings: null });
  }, [updateUrl]);

  const setActiveSession = useCallback((id: SessionId) => {
    setActiveSessionState(id);
    setSelectedFileState(null);
    setShowSettingsState(false);
    updateUrl({ session: id || null, file: null, settings: null });
  }, [updateUrl]);

  const setSelectedFile = useCallback((path: string | null) => {
    setSelectedFileState(path);
    if (path) {
      setShowSettingsState(false);
      updateUrl({ file: path, settings: null });
    } else {
      updateUrl({ file: null });
    }
  }, [updateUrl]);

  const setShowSettings = useCallback((show: boolean) => {
    setShowSettingsState(show);
    if (show) {
      setSelectedFileState(null);
      updateUrl({ settings: "true", file: null });
    } else {
      updateUrl({ settings: null });
    }
  }, [updateUrl]);

  const setSidebarTab = useCallback((tab: SidebarTab) => {
    setSidebarTabState(tab);
    updateUrl({ tab: tab === "chat" ? null : tab });
  }, [updateUrl]);

  // Initialize state from URL on mount
  useEffect(() => {
    if (isInitializedRef.current) return;
    isInitializedRef.current = true;

    const workspaceParam = searchParams.get("workspace");
    const sessionParam = searchParams.get("session");
    const fileParam = searchParams.get("file");
    const settingsParam = searchParams.get("settings");
    const tabParam = searchParams.get("tab") as SidebarTab | null;

    if (workspaceParam) {
      setActiveWorkspaceState(workspaceParam);
    }
    if (sessionParam) {
      setActiveSessionState(sessionParam as SessionId);
    }
    if (fileParam) {
      setSelectedFileState(fileParam);
    }
    if (settingsParam === "true") {
      setShowSettingsState(true);
    }
    if (tabParam && ["chat", "folders", "history"].includes(tabParam)) {
      setSidebarTabState(tabParam);
    }
  }, [searchParams]);

  // Handle sessions loaded - auto-select first non-archived session if none selected
  const handleSessionsLoaded = useCallback((sessions: Session[]) => {
    if (shouldAutoSelectRef.current && sessions.length > 0) {
      // Find first non-archived session
      const firstSession = sessions.find(s => !archivedSessions.has(s.id));
      if (firstSession) {
        setActiveSessionState(firstSession.id);
        updateUrl({ session: firstSession.id });
      }
      shouldAutoSelectRef.current = false;
    }
  }, [archivedSessions, updateUrl]);

  // Close mobile sidebar
  const closeMobileSidebar = useCallback(() => {
    setMobileSidebarOpen(false);
  }, []);

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
    // setActiveSession already clears file and settings
    setActiveSession(id);
    return id;
  }, [activeWorkspace, setActiveSession]);

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
        customSessionNames,
        setCustomSessionName,
        sessionOrder,
        setSessionOrder,
        archivedSessions,
        archiveSession,
        unarchiveSession,
        isMobileSidebarOpen,
        setMobileSidebarOpen,
        closeMobileSidebar,
        sidebarTab,
        setSidebarTab,
      }}
    >
      <TooltipProvider>
        <div className="flex h-screen bg-background overflow-hidden">
          {/* Mobile Sidebar Overlay */}
          <div
            className={`
              fixed inset-0 bg-black/50 z-40 md:hidden transition-opacity duration-200
              ${isMobileSidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
            `}
            onClick={closeMobileSidebar}
          />

          {/* Mobile Sidebar Container - slides in from left */}
          <div className={`
            fixed left-0 top-0 bottom-0 z-50 flex md:hidden
            transition-transform duration-200 ease-out
            ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}>
            <ServerBar
              activeWorkspace={activeWorkspace}
              onWorkspaceSelect={(id) => {
                setActiveWorkspace(id);
              }}
            />
            <ChatSidebar
              workspaceName={currentRepository?.name || "Claude Hub"}
              repositoryId={activeWorkspace || undefined}
              repositoryPath={currentRepository?.path}
              gitUrl={currentRepository?.gitUrl}
              activeSession={activeSession}
              draftSessions={draftSessions}
              customSessionNames={customSessionNames}
              sessionOrder={sessionOrder}
              archivedSessions={archivedSessions}
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              onSessionSelect={(sessionId) => {
                setActiveSession(sessionId);
                closeMobileSidebar();
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
              onFileSelect={(path) => {
                setSelectedFile(path);
                closeMobileSidebar();
              }}
              onNewSession={() => {
                createNewSession();
                closeMobileSidebar();
              }}
              onShowSettings={() => {
                setShowSettings(true);
                closeMobileSidebar();
              }}
              onSessionsLoaded={handleSessionsLoaded}
            />
          </div>

          {/* Desktop Server Bar */}
          <div className="hidden md:block">
            <ServerBar
              activeWorkspace={activeWorkspace}
              onWorkspaceSelect={(id) => {
                setActiveWorkspace(id);
              }}
            />
          </div>

          {/* Desktop Chat Sidebar */}
          <div className="hidden md:block">
            <ChatSidebar
              workspaceName={currentRepository?.name || "Claude Hub"}
              repositoryId={activeWorkspace || undefined}
              repositoryPath={currentRepository?.path}
              gitUrl={currentRepository?.gitUrl}
              activeSession={activeSession}
              draftSessions={draftSessions}
              customSessionNames={customSessionNames}
              sessionOrder={sessionOrder}
              archivedSessions={archivedSessions}
              activeTab={sidebarTab}
              onTabChange={setSidebarTab}
              onSessionSelect={(sessionId) => {
                setActiveSession(sessionId);
                closeMobileSidebar();
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
              onFileSelect={(path) => {
                setSelectedFile(path);
                closeMobileSidebar();
              }}
              onNewSession={() => {
                createNewSession();
                closeMobileSidebar();
              }}
              onShowSettings={() => {
                setShowSettings(true);
                closeMobileSidebar();
              }}
              onSessionsLoaded={handleSessionsLoaded}
            />
          </div>

          {/* Main Content */}
          <main className="flex-1 flex flex-col overflow-hidden w-full">
            {children}
          </main>
        </div>
      </TooltipProvider>
    </ChatContext.Provider>
  );
}
