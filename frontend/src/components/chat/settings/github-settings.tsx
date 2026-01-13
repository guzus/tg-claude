"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Github, LogOut, Key, Check, AlertCircle, Loader2, ExternalLink, Info, UserCheck } from "lucide-react";
import { api, type GitHubAuthStatus } from "@/lib/api";
import { useChatContext } from "../chat-layout";

export function GitHubSettings() {
  const { userId, isAuthenticated } = useChatContext();
  const { data: session } = useSession();
  const [status, setStatus] = useState<GitHubAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [patInput, setPatInput] = useState("");
  const [patError, setPatError] = useState<string | null>(null);
  const [patLoading, setPatLoading] = useState(false);
  const [showPatInput, setShowPatInput] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Check if user signed in with GitHub (has automatic repo access)
  const sessionUser = session?.user as { provider?: string; name?: string } | undefined;
  const isGitHubSignIn = isAuthenticated && sessionUser?.provider === "github";

  const fetchStatus = useCallback(async () => {
    try {
      const result = await api.getGitHubStatus(userId);
      setStatus(result);
      setPatError(null);
    } catch (error) {
      console.error("Failed to fetch GitHub status:", error);
      // Set a default status on error so the UI doesn't break
      setStatus({ hasAuth: false, method: "none", appConfigured: false });
      // Only show error if it's a network issue, not just an empty response
      const message = error instanceof Error ? error.message : "";
      if (message.includes("fetch") || message.includes("network") || message.includes("ECONNREFUSED")) {
        setPatError("Unable to connect to the server. Please check your connection and try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleDisconnect = async () => {
    setDisconnecting(true);
    setPatError(null);
    try {
      await api.disconnectGitHub(userId);
      setSuccessMessage("GitHub disconnected successfully.");
      await fetchStatus();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      console.error("Failed to disconnect:", error);
      setPatError("Failed to disconnect. Please try again.");
    } finally {
      setDisconnecting(false);
    }
  };

  const handleSetPat = async () => {
    if (!patInput.trim()) return;

    const token = patInput.trim();

    // Validate token format
    if (!token.startsWith("ghp_") && !token.startsWith("github_pat_")) {
      setPatError("Invalid token format. GitHub tokens start with 'ghp_' or 'github_pat_'.");
      return;
    }

    setPatLoading(true);
    setPatError(null);

    try {
      await api.setGitHubPat(userId, token);
      setPatInput("");
      setShowPatInput(false);
      setSuccessMessage("Personal Access Token saved successfully!");
      await fetchStatus();
      // Clear success message after 5 seconds
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("Invalid PAT") || message.includes("401")) {
        setPatError("This token is invalid or has been revoked. Please generate a new token.");
      } else if (message.includes("missing required scopes") || message.includes("repo")) {
        setPatError("This token needs the 'repo' scope. Please create a new token with repository access.");
      } else if (message.includes("rate limit")) {
        setPatError("GitHub rate limit exceeded. Please wait a moment and try again.");
      } else {
        setPatError(message || "Failed to validate token. Please check your token and try again.");
      }
    } finally {
      setPatLoading(false);
    }
  };

  const handleClearPat = async () => {
    setPatLoading(true);
    setPatError(null);
    try {
      await api.clearGitHubPat(userId);
      setSuccessMessage("Personal Access Token removed successfully.");
      await fetchStatus();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (error) {
      console.error("Failed to clear PAT:", error);
      setPatError("Failed to remove token. Please try again.");
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
          {/* Success message */}
          {successMessage && (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 p-3 text-sm bg-green-500/10 rounded-lg border border-green-500/20 animate-in fade-in duration-200"
            >
              <Check className="w-4 h-4 text-green-500 shrink-0" aria-hidden="true" />
              <span className="text-green-600 dark:text-green-400">{successMessage}</span>
            </div>
          )}

          {status?.hasAuth ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
                <Check className="w-5 h-5 text-green-500" />
                <div className="flex-1">
                  <p className="font-medium text-green-600 dark:text-green-400">
                    Connected as @{status.login}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isGitHubSignIn && status.method === "app"
                      ? "Auto-connected via GitHub sign-in"
                      : status.method === "app"
                      ? "Connected via GitHub OAuth"
                      : "Using Personal Access Token"}
                  </p>
                </div>
              </div>

              {status.method === "app" && !isGitHubSignIn && (
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
              {/* Auto-connect notice for GitHub sign-in users */}
              {isGitHubSignIn ? (
                <div className="flex items-start gap-2 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
                  <UserCheck className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-600 dark:text-blue-400">Connecting automatically...</p>
                    <p className="text-muted-foreground mt-1">
                      Your GitHub account will be connected automatically since you signed in with GitHub.
                    </p>
                  </div>
                </div>
              ) : !isAuthenticated ? (
                <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">Sign in for automatic access</p>
                    <p className="mt-1">
                      Sign in with GitHub to automatically connect your account, or use a Personal Access Token below.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 bg-muted/50 rounded-lg border border-border">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">GitHub not connected</p>
                    <p className="mt-1">
                      You signed in with a different provider. Use a Personal Access Token to connect your GitHub account.
                    </p>
                  </div>
                </div>
              )}

              {/* Error display */}
              {patError && !showPatInput && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="flex items-start gap-2 p-3 text-sm text-destructive bg-destructive/10 rounded-lg border border-destructive/20"
                >
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{patError}</span>
                </div>
              )}

              {/* PAT Fallback - only show for non-GitHub sign-in users */}
              {!isGitHubSignIn && (
                <div>
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
                      <label htmlFor="github-pat-input" className="text-sm font-medium mb-1.5 block">
                        Personal Access Token
                      </label>
                      <Input
                        id="github-pat-input"
                        type="password"
                        value={patInput}
                        onChange={(e) => {
                          setPatInput(e.target.value);
                          setPatError(null);
                        }}
                        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                        className="font-mono"
                        aria-describedby="github-pat-hint"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <p id="github-pat-hint" className="text-xs text-muted-foreground mt-1.5">
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
                      <div role="alert" aria-live="polite" className="flex items-center gap-2 text-sm text-destructive">
                        <AlertCircle className="w-4 h-4" aria-hidden="true" />
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
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About GitHub Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Connecting your GitHub account allows you to:
          </p>
          <ul className="list-disc list-inside space-y-1">
            <li>Clone and work with private repositories</li>
            <li>Push changes to GitHub</li>
            <li>Create new repositories on GitHub</li>
          </ul>

          <div className="space-y-2 pt-2 border-t">
            <p>
              <strong className="text-foreground">Sign in with GitHub (Recommended):</strong> Automatically connects
              your GitHub account for repository access. No extra setup required.
            </p>
            <p>
              <strong className="text-foreground">Personal Access Token:</strong> Alternative for users who sign in
              with Google or prefer manual token management.
            </p>
          </div>

          {/* Helpful links */}
          <div className="flex flex-wrap gap-3 pt-2 border-t text-xs">
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Manage tokens <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://github.com/settings/applications"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Connected apps <ExternalLink className="w-3 h-3" />
            </a>
            <a
              href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              Learn more <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
