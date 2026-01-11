"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Server, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface McpServer {
  name: string;
  command: string;
  enabled: boolean;
}

export function McpServerSettings() {
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
