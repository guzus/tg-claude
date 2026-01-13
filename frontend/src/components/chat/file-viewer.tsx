"use client";

import { useState, useEffect, useRef } from "react";
import { X, FileCode, Copy, Check, Pencil, Save, Undo2, Loader2, Image, FileText, Download, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";

interface FileViewerProps {
  repositoryId: string;
  filePath: string;
  onClose: () => void;
}

type FileType = "text" | "image" | "pdf" | "unsupported";

function getFileType(filename: string): FileType {
  const ext = filename.split(".").pop()?.toLowerCase();

  const imageExtensions = ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp"];
  const pdfExtensions = ["pdf"];
  const textExtensions = [
    "ts", "tsx", "js", "jsx", "json", "md", "css", "html", "py", "yml", "yaml",
    "txt", "sh", "bash", "zsh", "env", "gitignore", "dockerfile", "makefile",
    "toml", "ini", "cfg", "conf", "xml", "sql", "graphql", "rs", "go", "java",
    "c", "cpp", "h", "hpp", "rb", "php", "swift", "kt", "scala", "r", "lua",
  ];

  if (!ext) return "text";
  if (imageExtensions.includes(ext)) return "image";
  if (pdfExtensions.includes(ext)) return "pdf";
  if (textExtensions.includes(ext)) return "text";

  // Default to text for unknown extensions (will fail gracefully if binary)
  return "text";
}

function getFileIcon(fileType: FileType) {
  switch (fileType) {
    case "image":
      return Image;
    case "pdf":
      return FileText;
    default:
      return FileCode;
  }
}

export function FileViewer({ repositoryId, filePath, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [imageZoom, setImageZoom] = useState(100);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const fileName = filePath.split("/").pop() || filePath;
  const fileType = getFileType(fileName);
  const isDirty = content !== originalContent;
  const FileIcon = getFileIcon(fileType);

  // Build raw file URL for binary files
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";
  const rawFileUrl = `${apiBase}/api/repositories/${repositoryId}/file/raw?userId=1&path=${encodeURIComponent(filePath)}`;

  useEffect(() => {
    // Only fetch content for text files
    if (fileType !== "text") {
      setLoading(false);
      return;
    }

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
  }, [repositoryId, filePath, fileType]);

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

  const handleDownload = () => {
    window.open(rawFileUrl, "_blank");
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

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-destructive">{error}</span>
        </div>
      );
    }

    switch (fileType) {
      case "image":
        return (
          <div className="flex-1 flex flex-col">
            <div className="flex items-center justify-center gap-2 p-2 border-b border-border bg-secondary/30">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageZoom(Math.max(25, imageZoom - 25))}
                disabled={imageZoom <= 25}
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground w-16 text-center">{imageZoom}%</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImageZoom(Math.min(400, imageZoom + 25))}
                disabled={imageZoom >= 400}
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex items-center justify-center p-8 min-h-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={rawFileUrl}
                  alt={fileName}
                  style={{ width: `${imageZoom}%`, maxWidth: "none" }}
                  className="object-contain rounded-lg shadow-lg"
                />
              </div>
            </ScrollArea>
          </div>
        );

      case "pdf":
        return (
          <div className="flex-1 flex flex-col">
            <embed
              src={rawFileUrl}
              type="application/pdf"
              className="flex-1 w-full"
            />
          </div>
        );

      case "text":
        if (isEditing) {
          return (
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
          );
        }
        return (
          <ScrollArea className="flex-1">
            <pre className="p-4 text-sm font-mono leading-relaxed overflow-x-auto">
              <code className={`language-${getLanguage(fileName)}`}>
                {content}
              </code>
            </pre>
          </ScrollArea>
        );

      default:
        return (
          <div className="flex-1 flex flex-col items-center justify-center gap-4">
            <FileText className="w-16 h-16 text-muted-foreground" />
            <p className="text-muted-foreground">This file type cannot be previewed</p>
            <Button onClick={handleDownload}>
              <Download className="w-4 h-4 mr-2" />
              Download File
            </Button>
          </div>
        );
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
        <div className="flex items-center gap-3 min-w-0">
          <FileIcon className="w-5 h-5 text-primary shrink-0" />
          <span className="font-medium text-[15px] truncate">{fileName}</span>
          <span className="text-sm text-muted-foreground truncate hidden sm:block">{filePath}</span>
          {isDirty && (
            <span className="text-xs text-amber-500 font-medium shrink-0">Modified</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {fileType === "text" && (
            isEditing ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDiscard}
                  disabled={saving}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Undo2 className="w-4 h-4 mr-1" />
                  <span className="hidden sm:inline">Discard</span>
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
                      <span className="hidden sm:inline">Saving...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">Save</span>
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
                  <span className="hidden sm:inline">Edit</span>
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
                      <span className="hidden sm:inline">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">Copy</span>
                    </>
                  )}
                </Button>
              </>
            )
          )}
          {(fileType === "image" || fileType === "pdf") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="text-muted-foreground hover:text-foreground"
            >
              <Download className="w-4 h-4 mr-1" />
              <span className="hidden sm:inline">Download</span>
            </Button>
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
      {renderContent()}
    </div>
  );
}
