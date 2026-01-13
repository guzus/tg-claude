"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Loader2, ArrowLeft, Github, Lock, Globe, Info } from "lucide-react";
import { api, type GitHubAuthStatus } from "@/lib/api";

type Mode = "select" | "clone" | "create";

interface AddWorkspaceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWorkspaceCreated?: (workspaceId: string) => void;
  userId: number;
}

export function AddWorkspaceModal({
  open,
  onOpenChange,
  onWorkspaceCreated,
  userId,
}: AddWorkspaceModalProps) {
  const [mode, setMode] = useState<Mode>("select");
  const [gitUrl, setGitUrl] = useState("");
  const [repoName, setRepoName] = useState("");
  const [branch, setBranch] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [githubStatus, setGithubStatus] = useState<GitHubAuthStatus | null>(null);

  // Fetch GitHub status when modal opens
  useEffect(() => {
    if (open) {
      api.getGitHubStatus(userId)
        .then(setGithubStatus)
        .catch(() => setGithubStatus({ hasAuth: false, method: "none", appConfigured: false }));
    }
  }, [open, userId]);

  const resetState = () => {
    setMode("select");
    setGitUrl("");
    setRepoName("");
    setBranch("");
    setIsPrivate(false);
    setError(null);
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  const normalizeGitUrl = (input: string): string => {
    const trimmed = input.trim();
    // If it's already a full URL, return as-is
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("git@")) {
      return trimmed;
    }
    // If it matches user/repo pattern, convert to GitHub URL
    if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
      return `https://github.com/${trimmed}.git`;
    }
    return trimmed;
  };

  const handleClone = async () => {
    if (!gitUrl.trim()) {
      setError("Repository URL is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const normalizedUrl = normalizeGitUrl(gitUrl);
      const repo = await api.cloneRepository(
        userId,
        normalizedUrl,
        repoName.trim() || undefined,
        branch.trim() || undefined
      );
      onWorkspaceCreated?.(repo.id);
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to clone repository";
      // Improve error messages for common auth-related failures
      if (message.includes("Authentication") || message.includes("401") || message.includes("403")) {
        setError("Authentication required. Connect GitHub in Settings to clone private repositories.");
      } else if (message.includes("not found") || message.includes("404")) {
        setError("Repository not found. Check the URL or connect GitHub for private repos.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!repoName.trim()) {
      setError("Repository name is required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const repo = await api.createRepository(userId, repoName.trim(), {
        createGithub: true,
        isPrivate,
      });
      onWorkspaceCreated?.(repo.id);
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create repository";
      // Improve error messages for auth-related failures
      if (message.includes("Authentication") || message.includes("401") || message.includes("403") || message.includes("GitHub")) {
        setError("GitHub connection required. Connect GitHub in Settings to create repositories.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "select" && "Add Workspace"}
            {mode === "clone" && "Clone Repository"}
            {mode === "create" && "Create Repository"}
          </DialogTitle>
          <DialogDescription>
            {mode === "select" && "Choose how you want to add a new workspace"}
            {mode === "clone" && "Enter user/repo or a Git URL to clone"}
            {mode === "create" && "Create a new repository with GitHub integration"}
          </DialogDescription>
        </DialogHeader>

        {mode === "select" && (
          <div className="grid gap-3 py-4">
            <button
              onClick={() => setMode("clone")}
              className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <GitBranch className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Clone Repository</p>
                <p className="text-sm text-muted-foreground">
                  Clone an existing Git repository
                </p>
              </div>
            </button>

            <button
              onClick={() => setMode("create")}
              className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Github className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Create New Repository</p>
                <p className="text-sm text-muted-foreground">
                  Create a new repository on GitHub
                </p>
              </div>
            </button>
          </div>
        )}

        {mode === "clone" && (
          <div className="space-y-4 py-4">
            <button
              onClick={() => setMode("select")}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="space-y-2">
              <label htmlFor="clone-repo-url" className="text-sm font-medium">Repository *</label>
              <Input
                id="clone-repo-url"
                placeholder="user/repo"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                disabled={isLoading}
                aria-describedby="clone-repo-hint"
              />
              <p id="clone-repo-hint" className="text-xs text-muted-foreground">
                Enter <code className="px-1 py-0.5 rounded bg-secondary">user/repo</code> or full URL
              </p>
            </div>

            {/* GitHub auth hint for private repos */}
            {githubStatus && !githubStatus.hasAuth && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-blue-600 dark:text-blue-400">Private repos?</span>{" "}
                  Sign in with GitHub or add a Personal Access Token in Settings.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <label htmlFor="clone-repo-name" className="text-sm font-medium">
                Name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="clone-repo-name"
                placeholder="Custom folder name"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="clone-repo-branch" className="text-sm font-medium">
                Branch <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="clone-repo-branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && (
              <p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>
            )}

            <Button
              onClick={handleClone}
              disabled={isLoading || !gitUrl.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Cloning...
                </>
              ) : (
                "Clone Repository"
              )}
            </Button>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-4 py-4">
            <button
              onClick={() => setMode("select")}
              className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="space-y-2">
              <label htmlFor="create-repo-name" className="text-sm font-medium">Repository Name *</label>
              <Input
                id="create-repo-name"
                placeholder="my-new-project"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* GitHub Integration Notice */}
            {githubStatus?.hasAuth ? (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                <Github className="w-5 h-5 text-green-500" />
                <span className="text-sm text-green-600 dark:text-green-400">
                  Connected as @{githubStatus.login} - repo will be created on your account
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="text-sm">
                  <span className="font-medium text-amber-600 dark:text-amber-400">GitHub not connected</span>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sign in with GitHub or add a token in Settings to create repos.
                  </p>
                </div>
              </div>
            )}

            {/* Visibility Toggle */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Visibility</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setIsPrivate(false)}
                  disabled={isLoading}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${
                    !isPrivate
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Globe className="w-4 h-4" />
                  <span className="text-sm font-medium">Public</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrivate(true)}
                  disabled={isLoading}
                  className={`flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors ${
                    isPrivate
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Lock className="w-4 h-4" />
                  <span className="text-sm font-medium">Private</span>
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" aria-live="polite" className="text-sm text-destructive">{error}</p>
            )}

            <Button
              onClick={handleCreate}
              disabled={isLoading || !repoName.trim()}
              className="w-full"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Github className="w-4 h-4 mr-2" />
                  Create Repository
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
