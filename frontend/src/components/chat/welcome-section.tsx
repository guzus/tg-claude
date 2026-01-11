"use client";

import { Sparkles, FolderGit2, Terminal, FileCode } from "lucide-react";

export function WelcomeSection() {
  return (
    <div className="px-6 pb-8 mb-6 border-b border-border">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
        <Sparkles className="w-8 h-8 text-primary-foreground" />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-foreground">
        Welcome to Claude Hub
      </h2>
      <p className="text-muted-foreground">
        Your AI-powered development assistant. Start a conversation to execute tasks, write code, and more.
      </p>
      <div className="flex gap-2 mt-4">
        <QuickAction icon={FolderGit2} label="Clone Repo" />
        <QuickAction icon={Terminal} label="Run Command" />
        <QuickAction icon={FileCode} label="Edit File" />
      </div>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ElementType;
  label: string;
}

function QuickAction({ icon: Icon, label }: QuickActionProps) {
  return (
    <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors border border-border">
      <Icon className="w-4 h-4 text-muted-foreground" />
      {label}
    </button>
  );
}
