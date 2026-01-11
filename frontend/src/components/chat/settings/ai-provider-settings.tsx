"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Key, Save, Check, Zap, Globe, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

type ProviderType = "anthropic" | "openrouter" | "glm";

interface AIProvider {
  id: ProviderType;
  name: string;
  icon: React.ElementType;
}

const PROVIDERS: AIProvider[] = [
  { id: "anthropic", name: "Anthropic", icon: Bot },
  { id: "openrouter", name: "OpenRouter", icon: Globe },
  { id: "glm", name: "GLM", icon: Zap },
];

export function AIProviderSettings() {
  const [activeProvider, setActiveProvider] = useState<ProviderType>("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [glmApiKey, setGlmApiKey] = useState("");
  const [openrouterApiKey, setOpenrouterApiKey] = useState("");
  const [haikuModel, setHaikuModel] = useState("");
  const [sonnetModel, setSonnetModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Get the current API key based on provider
  const getCurrentApiKey = () => {
    if (activeProvider === "glm") return glmApiKey;
    if (activeProvider === "openrouter") return openrouterApiKey;
    return apiKey;
  };

  const setCurrentApiKey = (value: string) => {
    if (activeProvider === "glm") setGlmApiKey(value);
    else if (activeProvider === "openrouter") setOpenrouterApiKey(value);
    else setApiKey(value);
  };

  // Load current config on mount
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const config = await api.getConfig(1);
        if (config.aiProvider) {
          setActiveProvider(config.aiProvider.provider || "anthropic");
          setHaikuModel(config.aiProvider.haikuModel || "");
          setSonnetModel(config.aiProvider.sonnetModel || "");
          setOpusModel(config.aiProvider.opusModel || "");
          // Load saved API keys (masked, but we can detect if one exists)
          if (config.aiProvider.glmApiKey) setGlmApiKey(config.aiProvider.glmApiKey);
          if (config.aiProvider.openrouterApiKey) setOpenrouterApiKey(config.aiProvider.openrouterApiKey);
        }
      } catch (error) {
        console.error("Failed to load config:", error);
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, []);

  const handleProviderChange = async (providerId: ProviderType) => {
    setActiveProvider(providerId);
    setSaving(true);
    try {
      await api.updateConfig(1, {
        aiProvider: {
          provider: providerId,
          haikuModel: haikuModel || undefined,
          sonnetModel: sonnetModel || undefined,
          opusModel: opusModel || undefined,
        },
      });
    } catch (error) {
      console.error("Failed to save provider:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveModels = async () => {
    setSaving(true);
    try {
      await api.updateConfig(1, {
        aiProvider: {
          provider: activeProvider,
          haikuModel: haikuModel || undefined,
          sonnetModel: sonnetModel || undefined,
          opusModel: opusModel || undefined,
        },
      });
    } catch (error) {
      console.error("Failed to save models:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    const currentKey = getCurrentApiKey();
    if (!currentKey) return;

    setSavingKey(true);
    setKeySaved(false);
    try {
      await api.updateConfig(1, {
        aiProvider: {
          provider: activeProvider,
          haikuModel: haikuModel || undefined,
          sonnetModel: sonnetModel || undefined,
          opusModel: opusModel || undefined,
          glmApiKey: activeProvider === "glm" ? currentKey : undefined,
          openrouterApiKey: activeProvider === "openrouter" ? currentKey : undefined,
        },
      });
      setKeySaved(true);
      setTimeout(() => setKeySaved(false), 2000);
    } catch (error) {
      console.error("Failed to save API key:", error);
    } finally {
      setSavingKey(false);
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
          {PROVIDERS.map((provider) => {
            const isActive = provider.id === activeProvider;
            return (
              <button
                key={provider.id}
                onClick={() => handleProviderChange(provider.id)}
                disabled={saving}
                className={cn(
                  "w-full flex items-center justify-between p-4 rounded-lg border transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50",
                  saving && "opacity-50 cursor-not-allowed"
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      "p-2 rounded-lg",
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted"
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
                {isActive && (
                  <Badge variant="default" className="gap-1">
                    {saving ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Check className="w-3 h-3" />
                    )}
                    Active
                  </Badge>
                )}
              </button>
            );
          })}
        </CardContent>
      </Card>

      {activeProvider !== "anthropic" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">API Key</CardTitle>
            <CardDescription>
              Enter your {activeProvider === "glm" ? "GLM (Z.ai)" : "OpenRouter"} API key
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  type="password"
                  placeholder={activeProvider === "glm" ? "your-glm-api-key" : "sk-or-..."}
                  value={getCurrentApiKey()}
                  onChange={(e) => setCurrentApiKey(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button onClick={handleSaveApiKey} disabled={savingKey || !getCurrentApiKey()}>
                {savingKey ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : keySaved ? (
                  <Check className="w-4 h-4 mr-1.5" />
                ) : (
                  <Save className="w-4 h-4 mr-1.5" />
                )}
                {keySaved ? "Saved" : "Save"}
              </Button>
            </div>
            {getCurrentApiKey() && (
              <p className="text-xs text-muted-foreground mt-2">
                API key is set. Enter a new key to replace it.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Custom Models</CardTitle>
          <CardDescription>Override default model slots</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Haiku Model</label>
            <Input
              placeholder="claude-3-5-haiku-latest"
              value={haikuModel}
              onChange={(e) => setHaikuModel(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Sonnet Model</label>
            <Input
              placeholder="claude-sonnet-4-20250514"
              value={sonnetModel}
              onChange={(e) => setSonnetModel(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">Opus Model</label>
            <Input
              placeholder="claude-opus-4-20250514"
              value={opusModel}
              onChange={(e) => setOpusModel(e.target.value)}
            />
          </div>
          <Button className="mt-2" onClick={handleSaveModels} disabled={saving}>
            {saving ? (
              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
            ) : (
              <Save className="w-4 h-4 mr-1.5" />
            )}
            Save Changes
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
