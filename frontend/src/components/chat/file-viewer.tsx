"use client";

import { useState, useEffect, useRef } from "react";
import { X, FileCode, Copy, Check, Pencil, Save, Undo2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

interface FileViewerProps {
  repositoryId: string;
  filePath: string;
  onClose: () => void;
}

export function FileViewer({ repositoryId, filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileName = filePath.split("/").pop() || filePath;
  const isDirty = content !== originalContent;

  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await api.getFileContent(1, repositoryId, filePath);
        setContent(result.content);
        setOriginalContent(result.content);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load file");
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [repositoryId, filePath]);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.saveFileContent(1, repositoryId, filePath, content);
      setOriginalContent(content);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setContent(originalContent);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Save with Cmd/Ctrl + S
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      if (isDirty) {
        handleSave();
      }
    }
    // Cancel with Escape
    if (e.key === "Escape") {
      if (isDirty) {
        handleDiscard();
      } else {
        setIsEditing(false);
      }
    }
    // Handle Tab key for indentation
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newContent = content.substring(0, start) + "  " + content.substring(end);
      setContent(newContent);
      // Set cursor position after the inserted spaces
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const getLanguage = (filename: string): string => {
    const ext = filename.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "ts":
      case "tsx":
        return "typescript";
      case "js":
      case "jsx":
        return "javascript";
      case "json":
        return "json";
      case "md":
        return "markdown";
      case "css":
        return "css";
      case "html":
        return "html";
      case "py":
        return "python";
      case "yml":
      case "yaml":
        return "yaml";
      default:
        return "plaintext";
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
        <div className="flex items-center gap-3">
          <FileCode className="w-5 h-5 text-primary" />
          <span className="font-medium text-[15px]">{fileName}</span>
          <span className="text-sm text-muted-foreground">{filePath}</span>
          {isDirty && (
            <span className="text-xs text-amber-500 font-medium">Modified</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDiscard}
                disabled={saving}
                className="text-muted-foreground hover:text-foreground"
              >
                <Undo2 className="w-4 h-4 mr-1" />
                Discard
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!isDirty || saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-1" />
                    Save
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditing(true)}
                disabled={loading}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil className="w-4 h-4 mr-1" />
                Edit
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <>
                    <Check className="w-4 h-4 mr-1" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy
                  </>
                )}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="w-8 h-8 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-muted-foreground">Loading...</span>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-destructive">{error}</span>
        </div>
      ) : isEditing ? (
        <div className="flex-1 flex flex-col">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 p-4 text-sm font-mono leading-relaxed bg-background resize-none focus:outline-none"
            spellCheck={false}
          />
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border bg-secondary/30">
            <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border">Ctrl+S</kbd> to save,{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border">Esc</kbd> to discard,{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-secondary border border-border">Tab</kbd> for indent
          </div>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <pre className="p-4 text-sm font-mono leading-relaxed overflow-x-auto">
            <code className={`language-${getLanguage(fileName)}`}>
              {content}
            </code>
          </pre>
        </ScrollArea>
      )}
    </div>
  );
}
