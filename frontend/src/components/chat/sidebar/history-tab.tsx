"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { api, type GitCommit, type GitCommitDiff } from "@/lib/api";
import {
  GitCommit as GitCommitIcon,
  ChevronRight,
  ArrowLeft,
  Loader2,
  Tag,
  GitBranch,
  FileText,
  Plus,
  Minus,
  ChevronDown,
  ChevronUp,
  User,
  Clock
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface HistoryTabProps {
  repositoryId?: string;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  diffContent: string;
}

function parseDiff(diff: string): { files: FileChange[]; stats: string } {
  const files: FileChange[] = [];
  let stats = "";

  // Extract stats line (e.g., "2 files changed, 10 insertions(+), 5 deletions(-)")
  const statsMatch = diff.match(/(\d+ files? changed.*?)(?:\n|$)/);
  if (statsMatch) {
    stats = statsMatch[1];
  }

  // Split by file diffs
  const fileDiffs = diff.split(/(?=diff --git)/);

  for (const fileDiff of fileDiffs) {
    if (!fileDiff.startsWith("diff --git")) continue;

    // Extract file path
    const pathMatch = fileDiff.match(/diff --git a\/(.*?) b\//);
    if (!pathMatch) continue;

    const path = pathMatch[1];

    // Count additions and deletions
    const lines = fileDiff.split("\n");
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith("+") && !line.startsWith("+++")) additions++;
      if (line.startsWith("-") && !line.startsWith("---")) deletions++;
    }

    files.push({
      path,
      additions,
      deletions,
      diffContent: fileDiff
    });
  }

  return { files, stats };
}

function FileDiffViewer({ file, isExpanded, onToggle }: {
  file: FileChange;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const lines = file.diffContent.split("\n");
  const fileName = file.path.split("/").pop() || file.path;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* File Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/50 hover:bg-secondary transition-colors text-left"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium truncate flex-1">{fileName}</span>
        <div className="flex items-center gap-2 shrink-0">
          {file.additions > 0 && (
            <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
              <Plus className="w-3 h-3" />
              {file.additions}
            </span>
          )}
          {file.deletions > 0 && (
            <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-0.5">
              <Minus className="w-3 h-3" />
              {file.deletions}
            </span>
          )}
        </div>
      </button>

      {/* File Path (smaller) */}
      <div className="px-3 py-1 bg-secondary/30 border-b border-border">
        <span className="text-[11px] text-muted-foreground font-mono">{file.path}</span>
      </div>

      {/* Diff Content */}
      {isExpanded && (
        <div className="font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto">
          {lines.map((line, i) => {
            // Skip diff header lines for cleaner view
            if (line.startsWith("diff --git") ||
                line.startsWith("index ") ||
                line.startsWith("new file") ||
                line.startsWith("deleted file")) {
              return null;
            }

            let className = "px-3 py-0.5 whitespace-pre";
            let prefix = "";

            if (line.startsWith("+++") || line.startsWith("---")) {
              return null; // Skip file path lines
            } else if (line.startsWith("@@")) {
              className += " text-blue-500 bg-blue-500/10 text-[10px]";
            } else if (line.startsWith("+")) {
              className += " text-green-600 dark:text-green-400 bg-green-500/10";
              prefix = "+ ";
            } else if (line.startsWith("-")) {
              className += " text-red-600 dark:text-red-400 bg-red-500/10";
              prefix = "- ";
            } else {
              className += " text-muted-foreground";
              prefix = "  ";
            }

            const content = line.startsWith("+") || line.startsWith("-")
              ? line.slice(1)
              : line;

            return (
              <div key={i} className={className}>
                <span className="select-none opacity-50">{prefix}</span>
                {content || " "}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CommitDetail({ commit, onBack }: { commit: GitCommitDiff; onBack: () => void }) {
  const { files } = parseDiff(commit.diff);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFile = (path: string) => {
    setExpandedFiles(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <div className="flex flex-col h-full">
      {/* Header with Back Button */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">Back</span>
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-3 space-y-4">
          {/* Commit Message */}
          <div className="space-y-2">
            <h3 className="text-base font-semibold leading-snug">{commit.subject}</h3>
            {commit.body && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{commit.body}</p>
            )}
          </div>

          {/* Commit Info Cards */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
              <User className="w-4 h-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">Author</p>
                <p className="text-sm font-medium truncate">{commit.author.name}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary/50">
              <Clock className="w-4 h-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">When</p>
                <p className="text-sm font-medium">{formatRelativeTime(commit.date)}</p>
              </div>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/30">
            <span className="text-sm text-muted-foreground">
              {files.length} file{files.length !== 1 ? "s" : ""} changed
            </span>
            {totalAdditions > 0 && (
              <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                {totalAdditions} addition{totalAdditions !== 1 ? "s" : ""}
              </span>
            )}
            {totalDeletions > 0 && (
              <span className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                <Minus className="w-3.5 h-3.5" />
                {totalDeletions} deletion{totalDeletions !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* Files Changed */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-1">
              Files Changed
            </h4>
            <div className="space-y-2">
              {files.map((file) => (
                <FileDiffViewer
                  key={file.path}
                  file={file}
                  isExpanded={expandedFiles.has(file.path)}
                  onToggle={() => toggleFile(file.path)}
                />
              ))}
            </div>
          </div>

          {/* Commit ID */}
          <div className="pt-2 border-t border-border">
            <p className="text-[11px] text-muted-foreground">
              Commit ID: <span className="font-mono text-primary">{commit.shortSha}</span>
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export function HistoryTab({ repositoryId }: HistoryTabProps) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<GitCommitDiff | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  useEffect(() => {
    if (!repositoryId) {
      setCommits([]);
      return;
    }

    const fetchCommits = async () => {
      setLoading(true);
      try {
        const data = await api.getCommits(1, repositoryId, 50);
        setCommits(data);
      } catch {
        setCommits([]);
      } finally {
        setLoading(false);
      }
    };

    fetchCommits();
  }, [repositoryId]);

  const handleCommitClick = async (commit: GitCommit) => {
    if (!repositoryId) return;

    setLoadingDiff(true);
    try {
      const diff = await api.getCommitDiff(1, repositoryId, commit.sha);
      setSelectedCommit(diff);
    } catch {
      // Handle error
    } finally {
      setLoadingDiff(false);
    }
  };

  const goBack = () => {
    setSelectedCommit(null);
  };

  // Show commit detail view
  if (selectedCommit) {
    return <CommitDetail commit={selectedCommit} onBack={goBack} />;
  }

  return (
    <div className="px-2 py-3">
      {/* Section Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Recent Changes
        </span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Commits List */}
      {!repositoryId ? (
        <p className="text-sm text-muted-foreground px-2 py-4 text-center">
          Select a repository
        </p>
      ) : commits.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground px-2 py-4 text-center">
          No changes yet
        </p>
      ) : (
        <div className="space-y-1">
          {commits.map((commit) => (
            <button
              key={commit.sha}
              onClick={() => handleCommitClick(commit)}
              disabled={loadingDiff}
              className={cn(
                "w-full flex items-start gap-2 px-2 py-2 rounded-md text-left transition-colors",
                "hover:bg-secondary group",
                loadingDiff && "opacity-50"
              )}
            >
              <GitCommitIcon className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate group-hover:text-foreground">
                  {commit.subject}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-muted-foreground">
                    {formatRelativeTime(commit.date)}
                  </span>
                  <span className="text-[11px] text-muted-foreground">by {commit.author.name}</span>
                </div>
                {commit.refs.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {commit.refs.map((ref, i) => (
                      <span
                        key={i}
                        className={cn(
                          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium",
                          ref.startsWith("tag:")
                            ? "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400"
                            : ref.includes("HEAD")
                            ? "bg-primary/20 text-primary"
                            : "bg-secondary text-muted-foreground"
                        )}
                      >
                        {ref.startsWith("tag:") ? (
                          <Tag className="w-2.5 h-2.5" />
                        ) : (
                          <GitBranch className="w-2.5 h-2.5" />
                        )}
                        {ref.replace("tag: ", "").replace("HEAD -> ", "")}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
