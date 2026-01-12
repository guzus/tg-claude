"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Plus } from "lucide-react";
import { AddWorkspaceModal } from "./add-workspace-modal";
import { api, type Repository } from "@/lib/api";

interface ServerBarProps {
  activeWorkspace?: string;
  onWorkspaceSelect?: (id: string) => void;
}

function getRepoIcon(name: string): string {
  // Get first two letters, capitalize them
  const words = name.split(/[-_\s]/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export function ServerBar({ activeWorkspace, onWorkspaceSelect }: ServerBarProps) {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [repositories, setRepositories] = useState<Repository[]>([]);

  // Fetch repositories
  useEffect(() => {
    const fetchRepositories = async () => {
      try {
        const repos = await api.getRepositories(1);
        setRepositories(repos);

        // Auto-select first repository if none selected and repos exist
        if (!activeWorkspace && repos.length > 0) {
          onWorkspaceSelect?.(repos[0].id);
        }
      } catch {
        // API may not be available yet
        setRepositories([]);
      }
    };

    fetchRepositories();
    const interval = setInterval(fetchRepositories, 10000);
    return () => clearInterval(interval);
  }, [activeWorkspace, onWorkspaceSelect]);

  const handleWorkspaceCreated = (workspaceId: string) => {
    onWorkspaceSelect?.(workspaceId);
    // Refresh repositories list
    api.getRepositories(1).then(setRepositories).catch(() => {});
  };

  return (
    <>
      <AddWorkspaceModal
        open={addModalOpen}
        onOpenChange={setAddModalOpen}
        onWorkspaceCreated={handleWorkspaceCreated}
      />
      <div className="w-[68px] bg-secondary/50 flex flex-col items-center py-3 gap-2 border-r border-border">
        {/* Repositories */}
        {repositories.map((repo) => {
          const isActive = activeWorkspace === repo.id;
          return (
            <Tooltip key={repo.id} delayDuration={0}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "workspace-icon relative",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground hover:bg-card hover:text-foreground border border-border"
                  )}
                  onClick={() => onWorkspaceSelect?.(repo.id)}
                >
                  <span className="text-sm font-semibold">{getRepoIcon(repo.name)}</span>
                  {isActive && (
                    <span className="absolute -left-3 w-1 h-8 rounded-r-full bg-foreground" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="font-medium">
                {repo.name}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Add */}
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setAddModalOpen(true)}
              className="workspace-icon bg-card text-muted-foreground hover:bg-primary hover:text-primary-foreground border border-border hover:border-primary transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            Add Workspace
          </TooltipContent>
        </Tooltip>
      </div>
    </>
  );
}
