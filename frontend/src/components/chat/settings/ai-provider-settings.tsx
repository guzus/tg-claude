"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Key, Save, Check, Zap, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

interface AIProvider {
  id: string;
  name: string;
  icon: React.ElementType;
  active: boolean;
  apiKey?: string;
}

export function AIProviderSettings() {
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
