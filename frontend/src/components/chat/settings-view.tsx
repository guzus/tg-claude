"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, Server, Puzzle, ChevronRight, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AIProviderSettings,
  McpServerSettings,
  PluginSettings,
  GeneralSettings,
} from "./settings";

interface SettingsViewProps {
  onClose: () => void;
}

export function SettingsView({ onClose }: SettingsViewProps) {
  const [activeSection, setActiveSection] = useState("ai");

  const sections = [
    { id: "ai", name: "AI Provider", icon: Bot },
    { id: "mcp", name: "MCP Servers", icon: Server },
    { id: "plugins", name: "Plugins", icon: Puzzle },
    { id: "general", name: "General", icon: Settings2 },
  ];

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
        <div className="flex items-center gap-3">
          <Settings2 className="w-5 h-5 text-primary" />
          <span className="font-semibold text-[15px]">Settings</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="w-8 h-8 text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 border-r border-border bg-secondary/30 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-3 space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    activeSection === section.id
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  )}
                >
                  <section.icon className="w-4 h-4" />
                  {section.name}
                  <ChevronRight className="w-4 h-4 ml-auto" />
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Content */}
        <div className="flex-1 h-full overflow-hidden">
          <ScrollArea className="h-full">
            <div className="p-6 max-w-3xl">
              {activeSection === "ai" && <AIProviderSettings />}
              {activeSection === "mcp" && <McpServerSettings />}
              {activeSection === "plugins" && <PluginSettings />}
              {activeSection === "general" && <GeneralSettings />}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
