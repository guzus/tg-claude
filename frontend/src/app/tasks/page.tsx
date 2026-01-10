"use client";

import { useEffect, useState, useRef } from "react";
import { Header, NewTaskButton } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Play,
  Square,
  Loader2,
  Clock,
  CheckCircle2,
  XCircle,
  ChevronRight,
  Terminal,
  FileCode,
  Globe,
  Lightbulb,
  AlertTriangle,
  Send,
  X,
} from "lucide-react";
import { api, type Task, type StreamAction } from "@/lib/api";
import { formatDuration, formatDate, cn, truncate } from "@/lib/utils";

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showNewTask, setShowNewTask] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await api.getTasks();
        setTasks(data);
        // Auto-select first running task
        if (!selectedTask) {
          const running = data.find((t) => t.status === "running");
          if (running) setSelectedTask(running);
        } else {
          // Update selected task
          const updated = data.find((t) => t.id === selectedTask.id);
          if (updated) setSelectedTask(updated);
        }
      } catch (error) {
        console.error("Failed to fetch tasks:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 2000);
    return () => clearInterval(interval);
  }, [selectedTask?.id]);

  const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "pending");
  const completedTasks = tasks.filter((t) => t.status === "completed");
  const failedTasks = tasks.filter((t) => t.status === "failed" || t.status === "cancelled" || t.status === "timeout");

  return (
    <>
      <Header
        title="Tasks"
        description="Manage and monitor task executions"
        actions={<NewTaskButton onClick={() => setShowNewTask(true)} />}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Task List */}
        <div className="w-80 border-r flex flex-col">
          <Tabs defaultValue="active" className="flex-1 flex flex-col">
            <div className="px-4 pt-4">
              <TabsList className="w-full">
                <TabsTrigger value="active" className="flex-1 gap-1.5">
                  <Loader2 className="w-3 h-3" />
                  Active ({activeTasks.length})
                </TabsTrigger>
                <TabsTrigger value="history" className="flex-1 gap-1.5">
                  <Clock className="w-3 h-3" />
                  History
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="active" className="flex-1 mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  {activeTasks.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No active tasks
                    </div>
                  ) : (
                    activeTasks.map((task) => (
                      <TaskListItem
                        key={task.id}
                        task={task}
                        selected={selectedTask?.id === task.id}
                        onClick={() => setSelectedTask(task)}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="history" className="flex-1 mt-0">
              <ScrollArea className="h-full">
                <div className="p-4 space-y-2">
                  {[...completedTasks, ...failedTasks].map((task) => (
                    <TaskListItem
                      key={task.id}
                      task={task}
                      selected={selectedTask?.id === task.id}
                      onClick={() => setSelectedTask(task)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        {/* Task Detail */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selectedTask ? (
            <TaskDetail task={selectedTask} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Terminal className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">Select a task to view details</p>
                <p className="text-sm mt-1">or create a new task to get started</p>
              </div>
            </div>
          )}
        </div>

        {/* New Task Modal */}
        {showNewTask && <NewTaskModal onClose={() => setShowNewTask(false)} />}
      </div>
    </>
  );
}

function TaskListItem({
  task,
  selected,
  onClick,
}: {
  task: Task;
  selected: boolean;
  onClick: () => void;
}) {
  const statusIcons = {
    pending: Clock,
    running: Loader2,
    completed: CheckCircle2,
    failed: XCircle,
    cancelled: XCircle,
    timeout: AlertTriangle,
  };

  const statusColors = {
    pending: "text-amber-500",
    running: "text-blue-500 animate-spin",
    completed: "text-emerald-500",
    failed: "text-red-500",
    cancelled: "text-gray-500",
    timeout: "text-orange-500",
  };

  const Icon = statusIcons[task.status];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg transition-colors",
        selected ? "bg-primary text-primary-foreground" : "hover:bg-muted"
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", !selected && statusColors[task.status])} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{truncate(task.prompt, 40)}</p>
          <p className={cn("text-xs mt-0.5 truncate", selected ? "opacity-80" : "text-muted-foreground")}>
            {task.workingDir.split("/").pop()}
          </p>
        </div>
        <ChevronRight className={cn("w-4 h-4 shrink-0", selected ? "opacity-80" : "text-muted-foreground")} />
      </div>
    </button>
  );
}

function TaskDetail({ task }: { task: Task }) {
  const outputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [task.output]);

  const handleCancel = async () => {
    try {
      await api.cancelTask(task.id);
    } catch (error) {
      console.error("Failed to cancel task:", error);
    }
  };

  const duration = task.endTime
    ? new Date(task.endTime).getTime() - new Date(task.startTime).getTime()
    : Date.now() - new Date(task.startTime).getTime();

  return (
    <>
      {/* Header */}
      <div className="px-6 py-4 border-b flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <TaskStatusBadge status={task.status} />
            {task.costUsd && (
              <Badge variant="outline" className="text-xs">
                ${task.costUsd.toFixed(4)}
              </Badge>
            )}
          </div>
          <h2 className="text-lg font-semibold truncate">{task.prompt}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Started {formatDate(task.startTime)} &middot; Duration: {formatDuration(duration)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {task.status === "running" && (
            <Button variant="destructive" size="sm" onClick={handleCancel}>
              <Square className="w-4 h-4 mr-1.5" />
              Cancel
            </Button>
          )}
        </div>
      </div>

      {/* Actions Stream */}
      {task.actions && task.actions.length > 0 && (
        <div className="px-6 py-3 border-b bg-muted/30">
          <p className="text-xs font-medium text-muted-foreground mb-2">Actions</p>
          <div className="flex flex-wrap gap-1.5">
            {task.actions.slice(-8).map((action) => (
              <ActionBadge key={action.id} action={action} />
            ))}
            {task.currentAction && (
              <ActionBadge action={task.currentAction} active />
            )}
          </div>
        </div>
      )}

      {/* Output */}
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full" ref={outputRef}>
          <pre className="p-6 text-sm font-mono whitespace-pre-wrap break-words">
            {task.output || task.errorOutput || "Waiting for output..."}
          </pre>
        </ScrollArea>
      </div>
    </>
  );
}

function TaskStatusBadge({ status }: { status: Task["status"] }) {
  const variants = {
    pending: "warning",
    running: "info",
    completed: "success",
    failed: "destructive",
    cancelled: "secondary",
    timeout: "destructive",
  } as const;

  return <Badge variant={variants[status]}>{status}</Badge>;
}

function ActionBadge({ action, active }: { action: StreamAction; active?: boolean }) {
  const icons = {
    command: Terminal,
    tool: Play,
    file_change: FileCode,
    web_search: Globe,
    note: Lightbulb,
    turn: ChevronRight,
    warning: AlertTriangle,
    telemetry: Clock,
  };

  const Icon = icons[action.kind] || Terminal;

  return (
    <Badge
      variant={active ? "default" : "secondary"}
      className={cn("gap-1", active && "animate-pulse")}
    >
      <Icon className="w-3 h-3" />
      {truncate(action.title, 20)}
    </Badge>
  );
}

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    setLoading(true);
    try {
      await api.createTask(prompt, workingDir || "/workspace", 1);
      onClose();
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>New Task</CardTitle>
            <CardDescription>Create a new task for Claude to execute</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Prompt</label>
              <Textarea
                placeholder="Describe what you want Claude to do..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                autoFocus
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Working Directory</label>
              <Input
                placeholder="/workspace/my-project"
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!prompt.trim() || loading}>
                {loading ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Execute
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
