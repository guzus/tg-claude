"use client";

import { type FileNode } from "@/lib/api";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  FileJson,
  File,
} from "lucide-react";

interface FileTreeNodeProps {
  nodes: FileNode[];
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onFileSelect?: (filePath: string) => void;
  depth: number;
}

export function FileTreeNode({ nodes, expandedFolders, onToggleFolder, onFileSelect, depth }: FileTreeNodeProps) {
  const getFileIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
      case "js":
      case "jsx":
        return <FileCode className="w-4 h-4 text-primary" />;
      case "json":
        return <FileJson className="w-4 h-4 text-amber-500" />;
      case "md":
      case "txt":
        return <FileText className="w-4 h-4 text-muted-foreground" />;
      default:
        return <File className="w-4 h-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-0.5">
      {nodes.map((node) => {
        const isExpanded = expandedFolders.has(node.path);
        const paddingLeft = depth * 12 + 8;

        if (node.type === "directory") {
          return (
            <div key={node.path}>
              <div
                className="flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
                style={{ paddingLeft }}
                onClick={() => onToggleFolder(node.path)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-4 h-4 text-primary" />
                ) : (
                  <Folder className="w-4 h-4 text-primary" />
                )}
                <span className="text-sm truncate">{node.name}</span>
              </div>
              {isExpanded && node.children && (
                <FileTreeNode
                  nodes={node.children}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  onFileSelect={onFileSelect}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        return (
          <div
            key={node.path}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
            style={{ paddingLeft: paddingLeft + 16 }}
            onClick={() => onFileSelect?.(node.path)}
          >
            {getFileIcon(node.name)}
            <span className="text-sm truncate">{node.name}</span>
          </div>
        );
      })}
    </div>
  );
}
