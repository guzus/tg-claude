"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Puzzle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

interface Plugin {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

const AVAILABLE_PLUGINS = [
  { id: "ralph-loop", name: "Ralph Loop", description: "Autonomous task loops" },
  { id: "commit-commands", name: "Commit Commands", description: "Git commit assistance" },
  { id: "github", name: "GitHub", description: "PR creation and review" },
  { id: "frontend-design", name: "Frontend Design", description: "UI/UX generation" },
];

// Default enabled plugins (when user has no config yet)
const DEFAULT_ENABLED = ["commit-commands", "github", "frontend-design"];

export function PluginSettings() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Load plugin settings from API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const config = await api.getConfig(1);
        const enabledPlugins = config.enabledPlugins ?? DEFAULT_ENABLED;

        setPlugins(
          AVAILABLE_PLUGINS.map((p) => ({
            ...p,
            enabled: enabledPlugins.includes(p.id),
          }))
        );
      } catch (error) {
        console.error("Failed to load plugin settings:", error);
        // Use defaults on error
        setPlugins(
          AVAILABLE_PLUGINS.map((p) => ({
            ...p,
            enabled: DEFAULT_ENABLED.includes(p.id),
          }))
        );
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, []);

  const togglePlugin = async (id: string) => {
    const plugin = plugins.find((p) => p.id === id);
    if (!plugin) return;

    const newEnabled = !plugin.enabled;

    // Optimistically update UI
    setPlugins((prev) =>
      prev.map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
    );
    setSaving(id);

    try {
      // Calculate new enabled plugins list
      const enabledPlugins = plugins
        .map((p) => (p.id === id ? { ...p, enabled: newEnabled } : p))
        .filter((p) => p.enabled)
        .map((p) => p.id);

      // Save to API
      await api.updateConfig(1, { enabledPlugins });
    } catch (error) {
      console.error("Failed to save plugin settings:", error);
      // Revert on error
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !newEnabled } : p))
      );
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
                disabled={saving === plugin.id}
              >
                {saving === plugin.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : plugin.enabled ? (
                  "Enabled"
                ) : (
                  "Enable"
                )}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
