"use client";

import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  Server,
  Puzzle,
  Zap,
  ChevronRight,
  Loader2,
  Check,
} from "lucide-react";
import { SLASH_COMMANDS } from "@/lib/slash-commands";

interface ToolItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: "mcp" | "plugin" | "skill";
}

const AVAILABLE_PLUGINS = [
  { id: "ralph-loop", name: "Ralph Loop", description: "Autonomous task loops" },
  { id: "commit-commands", name: "Commit Commands", description: "Git commit assistance" },
  { id: "github", name: "GitHub", description: "PR creation and review" },
  { id: "frontend-design", name: "Frontend Design", description: "UI/UX generation" },
];

const DEFAULT_ENABLED_PLUGINS = ["commit-commands", "github", "frontend-design"];

const MCP_SERVERS = [
  { id: "playwright", name: "Playwright", description: "Browser automation" },
  { id: "filesystem", name: "Filesystem", description: "File system access" },
  { id: "github", name: "GitHub MCP", description: "GitHub API integration" },
  { id: "memory", name: "Memory", description: "Persistent memory" },
];

interface ToolUsePopupProps {
  isOpen: boolean;
  onClose: () => void;
  onToolToggle?: (toolId: string, type: string, enabled: boolean) => void;
}

type TabType = "plugins" | "mcp" | "skills";

export function ToolUsePopup({ isOpen, onClose, onToolToggle }: ToolUsePopupProps) {
  const [activeTab, setActiveTab] = useState<TabType>("plugins");
  const [plugins, setPlugins] = useState<ToolItem[]>([]);
  const [mcpServers, setMcpServers] = useState<ToolItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Load settings
  useEffect(() => {
    if (!isOpen) return;

    const loadSettings = async () => {
      setLoading(true);
      try {
        const config = await api.getConfig(1);
        const enabledPlugins = config.enabledPlugins ?? DEFAULT_ENABLED_PLUGINS;

        setPlugins(
          AVAILABLE_PLUGINS.map((p) => ({
            ...p,
            enabled: enabledPlugins.includes(p.id),
            type: "plugin" as const,
          }))
        );

        // MCP servers - check if configured
        const mcpConfig = config.mcpConfigs?.[config.currentRepositoryId ?? ""] ?? { mcpServers: {} };
        setMcpServers(
          MCP_SERVERS.map((s) => ({
            ...s,
            enabled: !!mcpConfig.mcpServers[s.id],
            type: "mcp" as const,
          }))
        );
      } catch (error) {
        console.error("Failed to load tool settings:", error);
        setPlugins(
          AVAILABLE_PLUGINS.map((p) => ({
            ...p,
            enabled: DEFAULT_ENABLED_PLUGINS.includes(p.id),
            type: "plugin" as const,
          }))
        );
        setMcpServers(
          MCP_SERVERS.map((s) => ({
            ...s,
            enabled: false,
            type: "mcp" as const,
          }))
        );
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  const togglePlugin = async (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin) return;

    const newEnabled = !plugin.enabled;
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
    );
    setSaving(id);

    try {
      const enabledPlugins = plugins
        .map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
        .filter((p) => p.enabled)
        .map((p) => p.id);

      await api.updateConfig(1, { enabledPlugins });
      onToolToggle?.(id, "plugin", newEnabled);
    } catch (error) {
      console.error("Failed to save plugin settings:", error);
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !newEnabled } : p))
      );
    } finally {
      setSaving(null);
    }
  };

  const skills = SLASH_COMMANDS.filter((cmd) => cmd.category === "Tools").map((cmd) => ({
    id: cmd.command,
    name: cmd.command,
    description: cmd.description,
    enabled: true,
    type: "skill" as const,
  }));

  if (!isOpen) return null;

  const tabs: { id: TabType; label: string; icon: React.ReactNode; count: number }[] = [
    {
      id: "plugins",
      label: "Plugins",
      icon: <Puzzle className="w-3.5 h-3.5" />,
      count: plugins.filter((p) => p.enabled).length,
    },
    {
      id: "mcp",
      label: "MCP",
      icon: <Server className="w-3.5 h-3.5" />,
      count: mcpServers.filter((s) => s.enabled).length,
    },
    {
      id: "skills",
      label: "Skills",
      icon: <Zap className="w-3.5 h-3.5" />,
      count: skills.length,
    },
  ];

  const renderItems = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      );
    }

    const items = activeTab === "plugins" ? plugins : activeTab === "mcp" ? mcpServers : skills;

    return (
      <div className="space-y-1 p-2">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.type === "plugin") {
                togglePlugin(item.id);
              }
            }}
            disabled={item.type !== "plugin" || saving === item.id}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all",
              item.enabled
                ? "bg-primary/10 border border-primary/20"
                : "hover:bg-secondary border border-transparent",
              item.type !== "plugin" && "cursor-default"
            )}
          >
            <div
              className={cn(
                "w-7 h-7 rounded-md flex items-center justify-center shrink-0 transition-colors",
                item.enabled
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {item.type === "plugin" && <Puzzle className="w-3.5 h-3.5" />}
              {item.type === "mcp" && <Server className="w-3.5 h-3.5" />}
              {item.type === "skill" && <Zap className="w-3.5 h-3.5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-sm truncate">{item.name}</div>
              <div className="text-xs text-muted-foreground truncate">{item.description}</div>
            </div>
            {item.type === "plugin" && (
              <div className="shrink-0">
                {saving === item.id ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : item.enabled ? (
                  <Check className="w-4 h-4 text-primary" />
                ) : (
                  <div className="w-4 h-4 rounded border border-muted-foreground/30" />
                )}
              </div>
            )}
            {item.type === "skill" && (
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            )}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      ref={popupRef}
      className="absolute bottom-full left-0 mb-2 w-80 bg-card border border-border rounded-xl shadow-lg overflow-hidden z-50"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-sm">Tools & Extensions</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Configure available tools</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
              activeTab === tab.id
                ? "text-primary border-b-2 border-primary -mb-px"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.icon}
            <span>{tab.label}</span>
            <span
              className={cn(
                "px-1.5 py-0.5 rounded-full text-[10px]",
                activeTab === tab.id ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-h-64 overflow-y-auto">{renderItems()}</div>

      {/* Footer hint */}
      <div className="px-4 py-2 border-t border-border bg-muted/30">
        <p className="text-[10px] text-muted-foreground text-center">
          {activeTab === "plugins" && "Click to toggle plugins on/off"}
          {activeTab === "mcp" && "Configure MCP servers in Settings"}
          {activeTab === "skills" && "Type / in chat to use skills"}
        </p>
      </div>
    </div>
  );
}
