"use client";

import { useState, useRef, useEffect } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Plus, MessageCircle, Play, CheckCircle2, Circle, Pencil, GripVertical } from "lucide-react";

export interface Session {
  id: string;
  name: string;
  status: "running" | "completed" | "idle";
  timestamp?: string;
}

interface ChatTabProps {
  sessions: Session[];
  activeSession?: string;
  onSessionSelect?: (sessionId: string) => void;
  onSessionRename?: (sessionId: string, name: string) => void;
  onSessionReorder?: (sessionIds: string[]) => void;
  onNewSession?: () => void;
}

export function ChatTab({ sessions, activeSession, onSessionSelect, onSessionRename, onSessionReorder, onNewSession }: ChatTabProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onNewSession?.();
              }}
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
            const isActive = activeSession === session.id || (!activeSession && session.id === "general");
            const isEditing = editingSessionId === session.id;
            const isRenamable = session.id !== "general";
            const isDraggable = session.id !== "general";
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
                    {isRenamable && (
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
                    )}
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
