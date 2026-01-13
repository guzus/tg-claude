"use client";

import { GitCommit, Plus, Minus, ExternalLink, FileText, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

export interface CommitInfo {
  sha: string;
  shortSha: string;
  message: string;
  additions?: number;
  deletions?: number;
  filesChanged?: number;
  files?: Array<{
    path: string;
    additions: number;
    deletions: number;
  }>;
  repoUrl?: string;
}

interface CommitCardProps {
  commit: CommitInfo;
}

export function CommitCard({ commit }: CommitCardProps) {
  const [expanded, setExpanded] = useState(false);
  const commitUrl = commit.repoUrl ? `${commit.repoUrl}/commit/${commit.sha}` : null;

  return (
    <div className="my-3 rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-secondary/30">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
          <GitCommit className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Committed</span>
            <code className="px-1.5 py-0.5 rounded bg-secondary text-xs font-mono text-muted-foreground">
              {commit.shortSha}
            </code>
            {commitUrl && (
              <a
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate mt-0.5">{commit.message}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-border/50 text-sm">
        {commit.filesChanged !== undefined && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="w-3.5 h-3.5" />
            <span>{commit.filesChanged} file{commit.filesChanged !== 1 ? "s" : ""}</span>
          </div>
        )}
        {commit.additions !== undefined && commit.additions > 0 && (
          <div className="flex items-center gap-1 text-green-600 dark:text-green-400">
            <Plus className="w-3.5 h-3.5" />
            <span>{commit.additions}</span>
          </div>
        )}
        {commit.deletions !== undefined && commit.deletions > 0 && (
          <div className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <Minus className="w-3.5 h-3.5" />
            <span>{commit.deletions}</span>
          </div>
        )}
        {commit.files && commit.files.length > 0 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {expanded ? "Hide files" : "Show files"}
          </button>
        )}
      </div>

      {/* File list */}
      {expanded && commit.files && commit.files.length > 0 && (
        <div className="border-t border-border/50 px-4 py-2 space-y-1">
          {commit.files.map((file, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs">
              <FileText className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="font-mono text-muted-foreground truncate flex-1">{file.path}</span>
              <div className="flex items-center gap-2 shrink-0">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-400">+{file.additions}</span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">-{file.deletions}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Parse commit info from text content
export function parseCommitsFromText(text: string, repoUrl?: string): CommitInfo[] {
  const commits: CommitInfo[] = [];

  // Pattern 1: Standard git commit output with hash
  // e.g., "[main abc1234] commit message" or "abc1234 commit message"
  const commitPatterns = [
    // Git commit output: [branch hash] message
    /\[[\w\-\/]+\s+([a-f0-9]{7,40})\]\s+(.+)/gi,
    // Commit hash at start of line
    /^([a-f0-9]{7,40})\s+(.+)/gm,
    // "Created commit" or "Committed" patterns
    /(?:created\s+commit|committed)\s+([a-f0-9]{7,40})(?:\s*[-:]\s*(.+))?/gi,
  ];

  for (const pattern of commitPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const sha = match[1];
      const message = match[2]?.trim() || "Commit";

      // Avoid duplicates
      if (!commits.find(c => c.sha === sha || c.shortSha === sha)) {
        commits.push({
          sha,
          shortSha: sha.slice(0, 7),
          message,
          repoUrl,
        });
      }
    }
  }

  // Pattern 2: Parse stats if present
  // e.g., "2 files changed, 10 insertions(+), 5 deletions(-)"
  const statsPattern = /(\d+)\s+files?\s+changed(?:,\s*(\d+)\s+insertions?\(\+\))?(?:,\s*(\d+)\s+deletions?\(-\))?/gi;
  let statsMatch;
  while ((statsMatch = statsPattern.exec(text)) !== null) {
    const filesChanged = parseInt(statsMatch[1], 10);
    const additions = statsMatch[2] ? parseInt(statsMatch[2], 10) : 0;
    const deletions = statsMatch[3] ? parseInt(statsMatch[3], 10) : 0;

    // Apply to the most recent commit without stats
    const lastCommit = commits[commits.length - 1];
    if (lastCommit && lastCommit.filesChanged === undefined) {
      lastCommit.filesChanged = filesChanged;
      lastCommit.additions = additions;
      lastCommit.deletions = deletions;
    }
  }

  return commits;
}
