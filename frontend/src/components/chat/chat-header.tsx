"use client";

import { Button } from "@/components/ui/button";
import { Search, MoreHorizontal, Loader2, Hash } from "lucide-react";

interface ChatHeaderProps {
  isRunning: boolean;
  sessionName: string;
}

export function ChatHeader({ isRunning, sessionName }: ChatHeaderProps) {
  return (
    <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Hash className="w-5 h-5 text-muted-foreground" />
          <span className="font-semibold text-[15px]">{sessionName}</span>
        </div>
        {isRunning && (
          <>
            <div className="w-px h-5 bg-border" />
            <span className="badge badge-warning flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search messages..."
            className="w-48 h-8 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
          />
        </div>
        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
