"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, LogOut, Key, Check, AlertCircle, Loader2, ExternalLink } from "lucide-react";
import { api, type GitHubAuthStatus } from "@/lib/api";
import { useChatContext } from "../chat-layout";

export function GitHubSettings() {
  const { userId } = useChatContext();
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [patInput, setPatInput] = useState("");
  const [patError, setPatError] = useState<string | null>(null);
  const [patLoading, setPatLoading] = useState(false);
  const [showPatInput, setShowPatInput] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const result = await api.getGitHubStatus(userId);
      setStatus(result);
    } catch (error) {
      console.error("Failed to fetch GitHub status:", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Handle OAuth callback from URL params
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");

    if (code && state?.startsWith(`${userId}_`)) {
      // Clear URL params
      window.history.replaceState({}, "", window.location.pathname);

      // Complete OAuth flow
      setConnecting(true);
      api.completeGitHubOAuth(userId, code, state)
        .then(() => {
          fetchStatus();
        })
        .catch((error) => {
          console.error("OAuth callback failed:", error);
          setPatError("Failed to complete GitHub connection");
        })
        .finally(() => {
          setConnecting(false);
        });
    }
  }, [userId, fetchStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    setPatError(null);

    try {
      const redirectUri = window.location.origin + window.location.pathname;
      const { url } = await api.getGitHubOAuthUrl(userId, redirectUri);
      window.location.href = url;
    } catch (error) {
      console.error("Failed to get OAuth URL:", error);
      setPatError("Failed to initiate GitHub connection. GitHub App may not be configured.");
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnectGitHub(userId);
      await fetchStatus();
    } catch (error) {
      console.error("Failed to disconnect:", error);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSetPat = async () => {
    if (!patInput.trim()) return;

    setPatLoading(true);
    setPatError(null);

    try {
      await api.setGitHubPat(userId, patInput.trim());
      setPatInput("");
      setShowPatInput(false);
      await fetchStatus();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to set PAT";
      setPatError(message);
    } finally {
      setPatLoading(false);
    }
  };

  const handleClearPat = async () => {
    setPatLoading(true);
    try {
      await api.clearGitHubPat(userId);
      await fetchStatus();
    } catch (error) {
      console.error("Failed to clear PAT:", error);
    } finally {
      setPatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">GitHub</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Connect your GitHub account for private repository access
          </p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">GitHub</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Connect your GitHub account for private repository access
        </p>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Github className="w-5 h-5" />
            Connection Status
          </CardTitle>
          <CardDescription>
            {status?.hasAuth
              ? `Connected ${status.method === "app" ? "via GitHub App" : "with Personal Access Token"}`
              : "Not connected to GitHub"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.hasAuth ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <Check className="w-5 h-5 text-green-500" />
                <div className="flex-1">
                  <p className="font-medium text-green-600 dark:text-green-400">
                    Connected as @{status.login}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {status.method === "app"
                      ? "Using GitHub App OAuth (recommended)"
                      : "Using Personal Access Token"}
                  </p>
                </div>
              </div>

              {status.method === "app" && (
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                  className="text-destructive hover:text-destructive"
                >
                  {disconnecting ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <LogOut className="w-4 h-4 mr-1.5" />
                  )}
                  Disconnect GitHub
                </Button>
              )}

              {status.method === "pat" && (
                <Button
                  variant="outline"
                  onClick={handleClearPat}
                  disabled={patLoading}
                  className="text-destructive hover:text-destructive"
                >
                  {patLoading ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <Key className="w-4 h-4 mr-1.5" />
                  )}
                  Remove PAT
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {/* GitHub App OAuth (Primary) */}
              {status?.appConfigured && (
                <div className="space-y-3">
                  <Button
                    onClick={handleConnect}
                    disabled={connecting}
                    className="w-full"
                  >
                    {connecting ? (
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                    ) : (
                      <Github className="w-4 h-4 mr-1.5" />
                    )}
                    Connect with GitHub
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Recommended: Securely connect via OAuth
                  </p>
                </div>
              )}

              {/* PAT Fallback */}
              <div className="border-t border-border pt-4">
                {!showPatInput ? (
                  <Button
                    variant="outline"
                    onClick={() => setShowPatInput(true)}
                    className="w-full"
                  >
                    <Key className="w-4 h-4 mr-1.5" />
                    Use Personal Access Token
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium mb-1.5 block">
                        Personal Access Token
                      </label>
                      <Input
                        type="password"
                        value={patInput}
                        onChange={(e) => {
                          setPatInput(e.target.value);
                          setPatError(null);
                        }}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        className="font-mono"
                      />
                      <p className="text-xs text-muted-foreground mt-1.5">
                        Requires <code className="bg-secondary px-1 rounded">repo</code> scope.{" "}
                        <a
                          href="https://github.com/settings/tokens/new?scopes=repo&description=tg-claude"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline inline-flex items-center gap-0.5"
                        >
                          Create token <ExternalLink className="w-3 h-3" />
                        </a>
                      </p>
                    </div>

                    {patError && (
                      <div className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4" />
                        {patError}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        onClick={handleSetPat}
                        disabled={!patInput.trim() || patLoading}
                      >
                        {patLoading ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 mr-1.5" />
                        )}
                        Save Token
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setShowPatInput(false);
                          setPatInput("");
                          setPatError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About GitHub Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Connecting your GitHub account allows you to:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Clone and work with private repositories</li>
            <li>Push changes to GitHub</li>
            <li>Create new repositories on GitHub</li>
          </ul>
          <p className="pt-2">
            <strong>OAuth (Recommended):</strong> More secure, easier token management,
            and can be revoked from GitHub settings.
          </p>
          <p>
            <strong>Personal Access Token:</strong> Alternative for advanced users or
            if OAuth is not available.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
