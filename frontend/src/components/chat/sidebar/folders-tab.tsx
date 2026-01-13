"use client";

import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { api, type FileNode } from "@/lib/api";
import { FilePlus, Plus, X, Loader2 } from "lucide-react";
import { FileTreeNode } from "./file-tree-node";
import { useChatContext } from "../chat-layout";

interface FoldersTabProps {
  fileTree: FileNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  repositoryId?: string;
  onFileCreated?: () => void;
}

export function FoldersTab({ fileTree, expandedFolders, onToggleFolder, onFileSelect, repositoryId, onFileCreated }: FoldersTabProps) {
  const { userId } = useChatContext();
  const [isCreating, setIsCreating] = useState(false);
  const [newFilePath, setNewFilePath] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateFile = async () => {
    if (!newFilePath.trim() || !repositoryId) return;

    setIsLoading(true);
    setError(null);

    try {
      await api.saveFileContent(userId, repositoryId, newFilePath.trim(), "");
      onFileCreated?.();
      onFileSelect?.(newFilePath.trim());
      setNewFilePath("");
      setIsCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create file");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateFile();
    }
    if (e.key === "Escape") {
      setIsCreating(false);
      setNewFilePath("");
      setError(null);
    }
  };

  return (
    <div className="px-2 py-3">
      {/* Section Header */}
      <div className="flex items-center justify-between px-2 mb-2">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
          Files
        </span>
        {repositoryId && (
          <Tooltip delayDuration={0}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCreating(true)}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              >
                <FilePlus className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">New File</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* New File Input */}
      {isCreating && (
        <div className="px-2 mb-3">
          <div className="flex items-center gap-1">
            <Input
              autoFocus
              placeholder="path/to/file.ts"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              className="h-7 text-sm"
            />
            <button
              onClick={handleCreateFile}
              disabled={!newFilePath.trim() || isLoading}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {isLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => {
                setIsCreating(false);
                setNewFilePath("");
                setError(null);
              }}
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
      )}

      {/* File Tree */}
      {fileTree.length === 0 && !isCreating ? (
        <p className="text-sm text-muted-foreground px-2 py-4 text-center">
          No files found
        </p>
      ) : (
        <FileTreeNode
          nodes={fileTree}
          expandedFolders={expandedFolders}
          onToggleFolder={onToggleFolder}
          onFileSelect={onFileSelect}
          depth={0}
        />
      )}
    </div>
  );
}
