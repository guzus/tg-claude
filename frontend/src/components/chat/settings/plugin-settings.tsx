"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export function PluginSettings() {
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
