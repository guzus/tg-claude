"use client";

import { useEffect, useState } from "react";
import { Header, NewTaskButton } from "@/components/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Activity,
  CheckCircle2,
  Clock,
  Cpu,
  FolderGit2,
  Loader2,
  TrendingUp,
  XCircle,
} from "lucide-react";
import { api, type HealthResponse, type Task } from "@/lib/api";
import { formatDuration, formatDate, truncate } from "@/lib/utils";

interface Stats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  avgDuration: number;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [healthData, tasksData] = await Promise.all([
          api.getHealth().catch(() => null),
          api.getTasks().catch(() => []),
        ]);
        setHealth(healthData);
        setTasks(tasksData);
      } catch (error) {
        console.error("Failed to fetch data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const stats: Stats = {
    totalTasks: health?.stats?.totalCommands ?? 0,
    activeTasks: health?.activeTasks ?? 0,
    completedTasks: health?.stats?.successfulCommands ?? 0,
    failedTasks: health?.stats?.failedCommands ?? 0,
    avgDuration: 0,
  };

  const activeTasks = tasks.filter((t) => t.status === "running" || t.status === "pending");
  const recentTasks = tasks.slice(0, 5);

  return (
    <>
      <Header title="Dashboard" description="Overview of your AI development hub" />

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatsCard
              title="Active Tasks"
              value={stats.activeTasks}
              icon={Loader2}
              iconClassName="animate-spin"
              trend={stats.activeTasks > 0 ? "Running" : "Idle"}
              trendUp={stats.activeTasks > 0}
            />
            <StatsCard
              title="Completed"
              value={stats.completedTasks}
              icon={CheckCircle2}
              iconClassName="text-emerald-500"
              trend="+12% this week"
              trendUp
            />
            <StatsCard
              title="Failed"
              value={stats.failedTasks}
              icon={XCircle}
              iconClassName="text-red-500"
              trend="-3% this week"
              trendUp={false}
            />
            <StatsCard
              title="Total Commands"
              value={stats.totalTasks}
              icon={Activity}
              iconClassName="text-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Active Tasks */}
            <Card className="lg:col-span-2">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
                <div>
                  <CardTitle className="text-base font-medium">Active Tasks</CardTitle>
                  <CardDescription>Currently running and queued tasks</CardDescription>
                </div>
                <NewTaskButton />
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : activeTasks.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Cpu className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No active tasks</p>
                    <p className="text-sm">Start a new task to see it here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activeTasks.map((task) => (
                      <TaskItem key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* System Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-medium">System Status</CardTitle>
                <CardDescription>Current system health</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <StatusItem
                  label="API Status"
                  value={health ? "Online" : "Offline"}
                  status={health ? "success" : "error"}
                />
                <Separator />
                <StatusItem
                  label="Uptime"
                  value={health ? formatDuration(health.uptime * 1000) : "-"}
                  status="info"
                />
                <Separator />
                <StatusItem
                  label="Unique Users"
                  value={health?.stats?.uniqueUsers?.toString() ?? "-"}
                  status="info"
                />
                <Separator />
                <StatusItem
                  label="Last Updated"
                  value={health ? formatDate(health.timestamp) : "-"}
                  status="info"
                />
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-medium">Recent Activity</CardTitle>
              <CardDescription>Latest task executions</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : recentTasks.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                  <p>No recent activity</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTasks.map((task) => (
                    <TaskItem key={task.id} task={task} showDate />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </>
  );
}

function StatsCard({
  title,
  value,
  icon: Icon,
  iconClassName,
  trend,
  trendUp,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  iconClassName?: string;
  trend?: string;
  trendUp?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {trend && (
              <p className={`text-xs mt-1 flex items-center gap-1 ${trendUp ? "text-emerald-500" : "text-red-500"}`}>
                {trendUp !== undefined && <TrendingUp className={`w-3 h-3 ${!trendUp && "rotate-180"}`} />}
                {trend}
              </p>
            )}
          </div>
          <div className="p-3 rounded-lg bg-muted">
            <Icon className={`w-6 h-6 ${iconClassName}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskItem({ task, showDate }: { task: Task; showDate?: boolean }) {
  const statusColors = {
    pending: "warning",
    running: "info",
    completed: "success",
    failed: "destructive",
    cancelled: "secondary",
    timeout: "destructive",
  } as const;

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <div className="p-2 rounded-lg bg-background">
          <FolderGit2 className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{truncate(task.prompt, 50)}</p>
          <p className="text-xs text-muted-foreground truncate">{task.workingDir}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {showDate && (
          <span className="text-xs text-muted-foreground">{formatDate(task.startTime)}</span>
        )}
        <Badge variant={statusColors[task.status]}>{task.status}</Badge>
      </div>
    </div>
  );
}

function StatusItem({
  label,
  value,
  status,
}: {
  label: string;
  value: string;
  status: "success" | "error" | "info";
}) {
  const colors = {
    success: "text-emerald-500",
    error: "text-red-500",
    info: "text-muted-foreground",
  };

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-medium ${colors[status]}`}>{value}</span>
    </div>
  );
}
