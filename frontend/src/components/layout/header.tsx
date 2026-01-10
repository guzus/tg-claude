"use client";

import { Bell, Search, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UserMenu } from "@/components/auth/user-menu";

interface HeaderProps {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
}

export function Header({ title, description, actions }: HeaderProps) {
  return (
    <header className="flex items-center justify-between h-16 px-6 border-b bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        {title && (
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {description && (
              <p className="text-sm text-muted-foreground">{description}</p>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative hidden md:block">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="w-64 pl-9 bg-background"
          />
        </div>

        {actions}

        {/* Notifications */}
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
        </Button>

        {/* User Menu */}
        <UserMenu />
      </div>
    </header>
  );
}

export function NewTaskButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button onClick={onClick} size="sm" className="gap-2">
      <Plus className="w-4 h-4" />
      New Task
    </Button>
  );
}
