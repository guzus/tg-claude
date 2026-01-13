"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, MoreHorizontal, Loader2, Hash, X, Menu, ChevronRight } from "lucide-react";
import { useChatContext } from "./chat-layout";

interface ChatHeaderProps {
  isRunning: boolean;
  sessionName: string;
  repositoryName?: string;
  onSearch?: (query: string) => void;
}

export function ChatHeader({ isRunning, sessionName, repositoryName, onSearch }: ChatHeaderProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showMobileSearch, setShowMobileSearch] = useState(false);
  const { setMobileSidebarOpen } = useChatContext();

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    onSearch?.(value);
  };

  const clearSearch = () => {
    setSearchQuery("");
    onSearch?.("");
  };

  return (
    <div className="h-14 px-3 md:px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
      <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
        {/* Mobile hamburger menu */}
        <Button
          variant="ghost"
          size="icon"
          className="w-9 h-9 md:hidden text-muted-foreground hover:text-foreground shrink-0"
          onClick={() => setMobileSidebarOpen(true)}
        >
          <Menu className="w-5 h-5" />
        </Button>

        <div className="flex items-center gap-1.5 min-w-0">
          <Hash className="w-5 h-5 text-muted-foreground shrink-0" />
          {repositoryName && (
            <>
              <span className="text-[15px] text-muted-foreground truncate max-w-[120px] md:max-w-none">{repositoryName}</span>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
            </>
          )}
          <span className="font-semibold text-[15px] truncate">{sessionName}</span>
        </div>
        {isRunning && (
          <>
            <div className="w-px h-5 bg-border hidden sm:block" />
            <span className="badge badge-warning items-center gap-1 hidden sm:flex">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running
            </span>
            {/* Mobile running indicator - just the dot */}
            <span className="sm:hidden w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
          </>
        )}
      </div>

      <div className="flex items-center gap-1 md:gap-2 shrink-0">
        {/* Mobile search toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="w-8 h-8 md:hidden text-muted-foreground hover:text-foreground"
          onClick={() => setShowMobileSearch(!showMobileSearch)}
        >
          <Search className="w-4 h-4" />
        </Button>

        {/* Desktop search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search messages..."
            className="w-48 h-8 pl-9 pr-8 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
          />
          {searchQuery && (
            <button
              onClick={clearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>

      {/* Mobile search bar - slides down */}
      {showMobileSearch && (
        <div className="absolute top-14 left-0 right-0 p-3 bg-card border-b border-border md:hidden z-30">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search messages..."
              autoFocus
              className="w-full h-10 pl-10 pr-10 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
            />
            <button
              onClick={() => {
                clearSearch();
                setShowMobileSearch(false);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full hover:bg-muted text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
