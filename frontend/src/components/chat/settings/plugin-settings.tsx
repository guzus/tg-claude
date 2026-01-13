"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Puzzle, Loader2, Download, Check, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type MarketplacePlugin, type InstalledPlugin } from "@/lib/api";

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

const DEFAULT_ENABLED = ["commit-commands", "github", "frontend-design"];

export function PluginSettings() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [marketplacePlugins, setMarketplacePlugins] = useState<MarketplacePlugin[]>([]);
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [showMarketplace, setShowMarketplace] = useState(false);

  // Load plugin settings from API
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [config, marketplace, installed] = await Promise.all([
          api.getConfig(1),
          api.getMarketplacePlugins(),
          api.getInstalledPlugins(),
        ]);

        const enabledPlugins = config.enabledPlugins ?? DEFAULT_ENABLED;

        setPlugins(
          AVAILABLE_PLUGINS.map((p) => ({
            ...p,
            enabled: enabledPlugins.includes(p.id),
          }))
        );
        setMarketplacePlugins(marketplace);
        setInstalledPlugins(installed);
      } catch (error) {
        console.error("Failed to load plugin settings:", error);
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
    } catch (error) {
      console.error("Failed to save plugin settings:", error);
      setPlugins((prev) =>
        prev.map((p) => (p.id === id ? { ...p, enabled: !newEnabled } : p))
      );
    } finally {
      setSaving(null);
    }
  };

  const installPlugin = async (plugin: MarketplacePlugin) => {
    setInstalling(plugin.id);

    try {
      await api.installPlugin(plugin.id, plugin.registry);

      // Refresh installed plugins list
      const installed = await api.getInstalledPlugins();
      setInstalledPlugins(installed);

      // Add to available plugins if not already there
      if (!plugins.find((p) => p.id === plugin.id)) {
        const newPlugin = {
          id: plugin.id,
          name: plugin.name,
          description: plugin.description,
          enabled: false,
        };
        setPlugins((prev) => [...prev, newPlugin]);
      }
    } catch (error) {
      console.error("Failed to install plugin:", error);
    } finally {
      setInstalling(null);
    }
  };

  const isPluginInstalled = (pluginId: string) => {
    return installedPlugins.some((p) => p.id.includes(pluginId));
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Available Plugins</CardTitle>
              <CardDescription>Extend Claude Code functionality</CardDescription>
            </div>
            <Button
              variant={showMarketplace ? "default" : "outline"}
              size="sm"
              onClick={() => setShowMarketplace(!showMarketplace)}
            >
              <Store className="w-4 h-4 mr-1.5" />
              {showMarketplace ? "Hide Marketplace" : "Browse Marketplace"}
            </Button>
          </div>
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

      {showMarketplace && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Store className="w-4 h-4" />
              Plugin Marketplace
            </CardTitle>
            <CardDescription>
              Browse and install plugins from the official marketplace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {marketplacePlugins.map((plugin) => {
              const installed = isPluginInstalled(plugin.id);
              const isInstalling = installing === plugin.id;

              return (
                <div
                  key={plugin.id}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-lg border transition-colors",
                    installed ? "border-emerald-500/50 bg-emerald-500/5" : "border-border"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-lg",
                        installed ? "bg-emerald-500 text-white" : "bg-muted"
                      )}
                    >
                      <Puzzle className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground">{plugin.description}</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                        {plugin.registry}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant={installed ? "outline" : "default"}
                    size="sm"
                    onClick={() => !installed && installPlugin(plugin)}
                    disabled={installed || isInstalling}
                  >
                    {isInstalling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : installed ? (
                      <>
                        <Check className="w-4 h-4 mr-1" />
                        Installed
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 mr-1" />
                        Install
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
