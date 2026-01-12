"use client";

import { useEffect, useState, useRef } from "react";
import { api, type StreamAction, type StreamEvent } from "@/lib/api";
import { Check, X, Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ActionEvent {
  action: StreamAction;
  phase: "started" | "completed";
  ok?: boolean;
}

interface StreamingActionsProps {
  taskId: string;
  onComplete?: (answer: string | undefined, costUsd: number | undefined) => void;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs}s`;
}

function formatActionTitle(action: StreamAction): string {
  let title = action.title;
  if (title.length > 60) {
    title = title.substring(0, 57) + "...";
  }
  return title;
}

export function StreamingActions({ taskId, onComplete }: StreamingActionsProps) {
  const [actions, setActions] = useState<ActionEvent[]>([]);
  const [currentAction, setCurrentAction] = useState<StreamAction | undefined>();
  const [elapsed, setElapsed] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const startTimeRef = useRef<Date | null>(null);

  const handleCancel = async () => {
    if (isCancelling) return;
    setIsCancelling(true);
    try {
      await api.cancelTask(taskId);
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }
  };

  useEffect(() => {
    if (!taskId) return;

    // Start timer
    startTimeRef.current = new Date();
    const timer = setInterval(() => {
      if (startTimeRef.current) {
        const now = new Date();
        setElapsed(Math.floor((now.getTime() - startTimeRef.current.getTime()) / 1000));
      }
    }, 1000);

    // Subscribe to SSE stream
    const unsubscribe = api.subscribeToTaskStream(
      taskId,
      (event: StreamEvent) => {
        if (event.type === "init" && event.task) {
          // Set initial state from task
          if (event.task.startTime) {
            startTimeRef.current = new Date(event.task.startTime);
          }
          if (event.task.currentAction) {
            setCurrentAction(event.task.currentAction);
          }
        } else if (event.type === "action" && event.action) {
          if (event.phase === "started") {
            setCurrentAction(event.action);
          } else if (event.phase === "completed") {
            setActions((prev) => [
              ...prev.slice(-4), // Keep last 4 actions
              { action: event.action!, phase: "completed", ok: event.ok },
            ]);
            setCurrentAction(undefined);
          }
        } else if (event.type === "completed") {
          setIsComplete(true);
          setCurrentAction(undefined);
          if (onComplete) {
            onComplete(event.answer, event.costUsd);
          }
        } else if (event.type === "stream_end") {
          setIsComplete(true);
        }
      },
      (error) => {
        console.error("Stream error:", error);
      }
    );

    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [taskId, onComplete]);

  if (isComplete) {
    return null;
  }

  return (
    <div className="px-6 py-3 mx-4 border-l-2 border-amber-500/50 bg-amber-500/5">
      {/* Header with timer and stop button */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span className="font-medium">{formatDuration(elapsed)}</span>
          <span className="text-muted-foreground/60">· Claude</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isCancelling}
          className="h-6 px-2 text-xs text-muted-foreground hover:text-red-500 hover:bg-red-500/10"
        >
          <Square className="w-3 h-3 mr-1 fill-current" />
          {isCancelling ? "Stopping..." : "Stop"}
        </Button>
      </div>

      {/* Action history */}
      <div className="space-y-1">
        {actions.map((ae, idx) => (
          <div key={idx} className="flex items-center gap-2 text-sm">
            {ae.ok === false ? (
              <X className="w-3 h-3 text-red-500 shrink-0" />
            ) : (
              <Check className="w-3 h-3 text-green-500 shrink-0" />
            )}
            <span className="text-muted-foreground truncate">
              {formatActionTitle(ae.action)}
            </span>
          </div>
        ))}

        {/* Current action */}
        {currentAction && (
          <div className="flex items-center gap-2 text-sm">
            <Loader2 className="w-3 h-3 animate-spin text-amber-500 shrink-0" />
            <span className="text-foreground truncate">
              {formatActionTitle(currentAction)}...
            </span>
          </div>
        )}

        {/* Starting message if no actions yet */}
        {actions.length === 0 && !currentAction && (
          <div className="text-sm text-muted-foreground italic">
            Starting...
          </div>
        )}
      </div>
    </div>
  );
}
