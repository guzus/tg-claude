"use client";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings } from "lucide-react";

interface UserPanelProps {
  onShowSettings?: () => void;
}

export function UserPanel({ onShowSettings }: UserPanelProps) {
  return (
    <div className="h-14 px-3 flex items-center gap-3 bg-card border-t border-border shadow-subtle">
      {/* User Avatar */}
      <div className="relative">
        <div className="w-9 h-9 rounded-full bg-foreground flex items-center justify-center text-background text-sm font-semibold">
          U
        </div>
        <span className="absolute bottom-0 right-0 w-3 h-3 bg-primary rounded-full border-2 border-card" />
      </div>

      {/* User Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">User</p>
        <p className="text-[11px] text-primary truncate">Online</p>
      </div>

      {/* Settings Button */}
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onShowSettings}
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">Settings</TooltipContent>
      </Tooltip>
    </div>
  );
}
