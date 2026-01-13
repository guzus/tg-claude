"use client";

import { useState, useRef, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Plus, MessageCircle, Play, CheckCircle2, Circle, Pencil, GripVertical, Archive, ArchiveRestore, ChevronDown, ChevronRight } from "lucide-react";

export interface Session {
  id: string;
  name: string;
  status: "running" | "completed" | "idle";
  timestamp?: string;
}

interface ChatTabProps {
  sessions: Session[];
  activeSession?: string;
  archivedSessions?: Set<string>;
  onSessionSelect?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, name: string) => void;
  onSessionReorder?: (sessionIds: string[]) => void;
  onSessionArchive?: (sessionId: string) => void;
  onSessionUnarchive?: (sessionId: string) => void;
  onNewSession?: () => void;
}

export function ChatTab({ sessions, activeSession, archivedSessions = new Set(), onSessionSelect, onSessionRename, onSessionReorder, onSessionArchive, onSessionUnarchive, onNewSession }: ChatTabProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Split sessions into regular and archived
  const regularSessions = sessions.filter((s) => !archivedSessions.has(s.id));
  const archivedSessionsList = sessions.filter((s) => archivedSessions.has(s.id));

  // Focus input when editing starts
  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingSessionId]);

  const startEditing = (session: Session) => {
    // Allow editing all sessions except "general"
    if (session.id !== "general") {
      setEditingSessionId(session.id);
      setEditingName(session.name);
    }
  };

  const finishEditing = () => {
    if (editingSessionId && editingName.trim()) {
      onSessionRename?.(editingSessionId, editingName.trim());
    }
    setEditingSessionId(null);
    setEditingName("");
  };

  const cancelEditing = () => {
    setEditingSessionId(null);
    setEditingName("");
  };

  const handleDragStart = (e: React.DragEvent, sessionId: string) => {
    if (sessionId === "general") {
      e.preventDefault();
      return;
    }
    setDraggedId(sessionId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", sessionId);
  };

  const handleDragOver = (e: React.DragEvent, sessionId: string) => {
    e.preventDefault();
    if (sessionId !== "general" && draggedId && sessionId !== draggedId) {
      setDragOverId(sessionId);
    }
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedId || targetId === "general" || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }

    // Reorder sessions
    const currentOrder = sessions.map((s) => s.id);
    const draggedIndex = currentOrder.indexOf(draggedId);
    const targetIndex = currentOrder.indexOf(targetId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
      const newOrder = [...currentOrder];
      newOrder.splice(draggedIndex, 1);
      newOrder.splice(targetIndex, 0, draggedId);
      onSessionReorder?.(newOrder);
    }

    setDraggedId(null);
    setDragOverId(null);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverId(null);
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

  const renderSession = (session: Session, isArchived: boolean) => {
    const isActive = activeSession === session.id || (!activeSession && session.id === "general");
    const isEditing = editingSessionId === session.id;
    const isRenamable = session.id !== "general";
    const isDraggable = session.id !== "general" && !isArchived;
    const isDragOver = dragOverId === session.id;

    return (
      <div
        key={session.id}
        draggable={isDraggable && !isEditing}
        onDragStart={(e) => handleDragStart(e, session.id)}
        onDragOver={(e) => handleDragOver(e, session.id)}
        onDragLeave={handleDragLeave}
        onDrop={(e) => handleDrop(e, session.id)}
        onDragEnd={handleDragEnd}
        className={cn(
          "group flex items-center gap-1 px-1 py-2 rounded-md cursor-pointer transition-all",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          isDragOver && "border-t-2 border-primary",
          draggedId === session.id && "opacity-50"
        )}
        onClick={() => !isEditing && onSessionSelect?.(session.id)}
      >
        {isDraggable ? (
          <GripVertical className="w-3 h-3 opacity-0 group-hover:opacity-50 cursor-grab flex-shrink-0" />
        ) : (
          <div className="w-3" />
        )}
        {getStatusIcon(session.status)}
        <MessageCircle className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                finishEditing();
              } else if (e.key === "Escape") {
                cancelEditing();
              }
            }}
            className="flex-1 text-sm bg-background border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span
              className="flex-1 text-sm truncate"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditing(session);
              }}
            >
              {session.name}
            </span>
            <div className="flex items-center gap-0.5">
              {isRenamable && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditing(session);
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">Rename</TooltipContent>
                </Tooltip>
              )}
              {isRenamable && (
                <Tooltip delayDuration={0}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isArchived) {
                          onSessionUnarchive?.(session.id);
                        } else {
                          onSessionArchive?.(session.id);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-opacity"
                    >
                      {isArchived ? (
                        <ArchiveRestore className="w-3 h-3" />
                      ) : (
                        <Archive className="w-3 h-3" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    {isArchived ? "Unarchive" : "Archive"}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="px-2 py-3">
      {/* Section Header */}
      <div className="flex items-center gap-1 px-2 mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Sessions
        </span>
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNewSession?.();
              }}
              className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-foreground"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs">New Session</TooltipContent>
        </Tooltip>
      </div>

      {/* Regular Session List */}
      <div className="space-y-0.5">
        {regularSessions.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2 py-4 text-center">
            No sessions yet. Start a conversation!
          </p>
        ) : (
          regularSessions.map((session) => renderSession(session, false))
        )}
      </div>

      {/* Archived Section */}
      {archivedSessionsList.length > 0 && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className="flex items-center gap-1 px-2 mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors w-full"
          >
            {showArchived ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>Archived ({archivedSessionsList.length})</span>
          </button>
          {showArchived && (
            <div className="space-y-0.5">
              {archivedSessionsList.map((session) => renderSession(session, true))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
