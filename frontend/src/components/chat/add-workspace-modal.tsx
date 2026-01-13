"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GitBranch, Loader2, ArrowLeft, Github, Lock, Globe } from "lucide-react";
import { api } from "@/lib/api";

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
      setError(err instanceof Error ? err.message : "Failed to clone repository");
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
      setError(err instanceof Error ? err.message : "Failed to create repository");
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
              <label className="text-sm font-medium">Repository *</label>
              <Input
                placeholder="user/repo"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Enter <code className="px-1 py-0.5 rounded bg-secondary">user/repo</code> or full URL
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Name <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="Custom folder name"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Branch <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
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
              <label className="text-sm font-medium">Repository Name *</label>
              <Input
                placeholder="my-new-project"
                value={repoName}
                onChange={(e) => setRepoName(e.target.value)}
                disabled={isLoading}
              />
            </div>

            {/* GitHub Integration Notice */}
            <div className="flex items-center gap-2 p-3 rounded-lg bg-secondary/50 border border-border">
              <Github className="w-5 h-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                A GitHub repository will be created automatically
              </span>
            </div>

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
              <p className="text-sm text-destructive">{error}</p>
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
