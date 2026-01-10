"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bot,
  Key,
  Server,
  Puzzle,
  Save,
  Plus,
  Trash2,
  ChevronRight,
  Check,
  Settings2,
  Zap,
  Globe,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface AIProvider {
  id: string;
  name: string;
  icon: React.ElementType;
  active: boolean;
  apiKey?: string;
}

interface McpServer {
  name: string;
  command: string;
  enabled: boolean;
}

interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

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

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-56 border-r border-border bg-secondary/30">
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
        <ScrollArea className="flex-1">
          <div className="p-6 max-w-3xl">
            {activeSection === "ai" && <AIProviderSettings />}
            {activeSection === "mcp" && <McpServerSettings />}
            {activeSection === "plugins" && <PluginSettings />}
            {activeSection === "general" && <GeneralSettings />}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function AIProviderSettings() {
  const [providers, setProviders] = useState<AIProvider[]>([
    { id: "anthropic", name: "Anthropic", icon: Bot, active: true },
    { id: "openrouter", name: "OpenRouter", icon: Globe, active: false },
    { id: "glm", name: "GLM", icon: Zap, active: false },
  ]);

  const [apiKey, setApiKey] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">AI Provider</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your AI provider and API keys
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Provider</CardTitle>
          <CardDescription>Select which AI provider to use for tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() =>
                setProviders((prev) =>
                  prev.map((p) => ({ ...p, active: p.id === provider.id }))
                )
              }
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-lg border transition-colors",
                provider.active
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    provider.active ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  <provider.icon className="w-5 h-5" />
                </div>
                <div className="text-left">
                  <p className="font-medium">{provider.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {provider.id === "anthropic"
                      ? "Claude models"
                      : provider.id === "openrouter"
                      ? "Multiple providers"
                      : "GLM-4 models"}
                  </p>
                </div>
              </div>
              {provider.active && (
                <Badge variant="default" className="gap-1">
                  <Check className="w-3 h-3" />
                  Active
                </Badge>
              )}
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Key</CardTitle>
          <CardDescription>Enter your API key for the selected provider</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button>
              <Save className="w-4 h-4 mr-1.5" />
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom Models</CardTitle>
          <CardDescription>Override default model slots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Haiku Model</label>
            <Input placeholder="claude-3-5-haiku-latest" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Sonnet Model</label>
            <Input placeholder="claude-sonnet-4-20250514" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Opus Model</label>
            <Input placeholder="claude-opus-4-20250514" />
          </div>
          <Button className="mt-2">
            <Save className="w-4 h-4 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function McpServerSettings() {
  const [servers, setServers] = useState<McpServer[]>([
    { name: "playwright", command: "npx @anthropic-ai/mcp-server-playwright", enabled: true },
    { name: "filesystem", command: "npx @anthropic-ai/mcp-server-filesystem", enabled: false },
    { name: "github", command: "npx @anthropic-ai/mcp-server-github", enabled: true },
    { name: "memory", command: "npx @anthropic-ai/mcp-server-memory", enabled: false },
  ]);

  const [newServer, setNewServer] = useState({ name: "", command: "" });

  const toggleServer = (name: string) => {
    setServers((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled: !s.enabled } : s))
    );
  };

  const removeServer = (name: string) => {
    setServers((prev) => prev.filter((s) => s.name !== name));
  };

  const addServer = () => {
    if (newServer.name && newServer.command) {
      setServers((prev) => [...prev, { ...newServer, enabled: true }]);
      setNewServer({ name: "", command: "" });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">MCP Servers</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Configure Model Context Protocol servers for extended capabilities
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Configured Servers</CardTitle>
          <CardDescription>Enable or disable MCP servers</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.name}
              className="flex items-center justify-between p-4 rounded-lg border"
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    server.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground"
                  )}
                >
                  <Server className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{server.name}</p>
                  <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                    {server.command}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={server.enabled ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggleServer(server.name)}
                >
                  {server.enabled ? "Enabled" : "Disabled"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => removeServer(server.name)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Server</CardTitle>
          <CardDescription>Add a new MCP server</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Name</label>
            <Input
              placeholder="my-server"
              value={newServer.name}
              onChange={(e) => setNewServer((prev) => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Command</label>
            <Input
              placeholder="npx @my/mcp-server"
              value={newServer.command}
              onChange={(e) => setNewServer((prev) => ({ ...prev, command: e.target.value }))}
            />
          </div>
          <Button onClick={addServer} disabled={!newServer.name || !newServer.command}>
            <Plus className="w-4 h-4 mr-1.5" />
            Add Server
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PluginSettings() {
  const [plugins, setPlugins] = useState<Plugin[]>([
    { id: "ralph-loop", name: "Ralph Loop", description: "Autonomous task loops", enabled: false },
    { id: "commit-commands", name: "Commit Commands", description: "Git commit assistance", enabled: true },
    { id: "github", name: "GitHub", description: "PR creation and review", enabled: true },
    { id: "frontend-design", name: "Frontend Design", description: "UI/UX generation", enabled: true },
  ]);

  const togglePlugin = (id: string) => {
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p))
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Plugins</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enable or disable Claude Code plugins
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Available Plugins</CardTitle>
          <CardDescription>Extend Claude Code functionality</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className={cn(
                "flex items-center justify-between p-4 rounded-lg border transition-colors",
                plugin.enabled ? "border-primary/50 bg-primary/5" : "border-border"
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "p-2 rounded-lg",
                    plugin.enabled ? "bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  <Puzzle className="w-4 h-4" />
                </div>
                <div>
                  <p className="font-medium text-sm">{plugin.name}</p>
                  <p className="text-xs text-muted-foreground">{plugin.description}</p>
                </div>
              </div>
              <Button
                variant={plugin.enabled ? "default" : "outline"}
                size="sm"
                onClick={() => togglePlugin(plugin.id)}
              >
                {plugin.enabled ? "Enabled" : "Enable"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function GeneralSettings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">General</h2>
        <p className="text-sm text-muted-foreground mt-1">
          General application settings
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Limits</CardTitle>
          <CardDescription>Configure task execution limits</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Max Concurrent Tasks</label>
            <Input type="number" defaultValue="3" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Task Timeout (minutes)</label>
            <Input type="number" defaultValue="30" />
          </div>
          <Button>
            <Save className="w-4 h-4 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Git Configuration</CardTitle>
          <CardDescription>Default git settings for repositories</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">User Name</label>
            <Input placeholder="Your Name" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">User Email</label>
            <Input type="email" placeholder="you@example.com" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Default Branch</label>
            <Input placeholder="main" />
          </div>
          <Button>
            <Save className="w-4 h-4 mr-1.5" />
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
