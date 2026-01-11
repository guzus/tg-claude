"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Settings, LogIn, LogOut } from "lucide-react";

interface UserPanelProps {
  onShowSettings?: () => void;
}

export function UserPanel({ onShowSettings }: UserPanelProps) {
  const { data: session, status } = useSession();

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated" && session?.user;

  // Get user initials for avatar
  const getInitials = (name?: string | null) => {
    if (!name) return "U";
    const parts = name.split(" ");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name[0].toUpperCase();
  };

  return (
    <div className="h-14 px-3 flex items-center gap-3 bg-card border-t border-border shadow-subtle">
      {isLoading ? (
        // Loading state
        <div className="flex-1 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-secondary animate-pulse" />
          <div className="flex-1">
            <div className="h-4 w-20 bg-secondary rounded animate-pulse" />
          </div>
        </div>
      ) : isAuthenticated && session?.user ? (
        // Logged in state
        <>
          {/* User Avatar */}
          <div className="relative">
            {session.user.image ? (
              <img
                src={session.user.image}
                alt={session.user.name || "User"}
                className="w-9 h-9 rounded-full object-cover"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-sm font-semibold">
                {getInitials(session.user.name)}
              </div>
            )}
            <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-card" />
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{session.user.name || "User"}</p>
            <p className="text-[11px] text-muted-foreground truncate">{session.user.email}</p>
          </div>

          {/* Sign Out Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => signOut()}
                className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
              >
                <LogOut className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Sign Out</TooltipContent>
          </Tooltip>
        </>
      ) : (
        // Not logged in state
        <>
          {/* Guest Avatar */}
          <div className="relative">
            <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-muted-foreground text-sm font-semibold">
              U
            </div>
          </div>

          {/* Guest Info */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">Guest</p>
            <p className="text-[11px] text-muted-foreground truncate">Not signed in</p>
          </div>

          {/* Sign In Button */}
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => signIn()}
                className="w-8 h-8 text-muted-foreground hover:text-primary hover:bg-secondary"
              >
                <LogIn className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Sign In</TooltipContent>
          </Tooltip>
        </>
      )}

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
