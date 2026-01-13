"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlusCircle, Send, X, Image as ImageIcon, Wrench } from "lucide-react";
import { ToolUsePopup } from "./tool-use-popup";
import { type ImageContent, type ImageMediaType } from "@/lib/api";
import { filterCommands, isTypingSlashCommand } from "@/lib/slash-commands";

interface SelectedImage {
  id: string;
  file: File;
  preview: string;
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  images: SelectedImage[];
  onImagesChange: (images: SelectedImage[]) => void;
}

export type { SelectedImage };

// Convert file to ImageContent for API
export async function fileToImageContent(file: File): Promise<ImageContent> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      const mediaType = file.type as ImageMediaType;
      resolve({
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ChatInput({ value, onChange, onSubmit, onKeyDown, images, onImagesChange }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [showToolPopup, setShowToolPopup] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commandMenuRef = useRef<HTMLDivElement>(null);

  // Filter commands based on current input
  const filteredCommands = filterCommands(value);

  // Show commands when typing starts with /
  useEffect(() => {
    if (isTypingSlashCommand(value)) {
      setShowCommands(true);
      setSelectedIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [value]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  // Scroll selected item into view
  useEffect(() => {
    if (showCommands && commandMenuRef.current) {
      const selectedEl = commandMenuRef.current.querySelector(`[data-index="${selectedIndex}"]`);
      selectedEl?.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, showCommands]);

  const selectCommand = useCallback((command: string) => {
    onChange(command + " ");
    setShowCommands(false);
    textareaRef.current?.focus();
  }, [onChange]);

  const handleKeyDownInternal = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCommands && filteredCommands.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        selectCommand(filteredCommands[selectedIndex].command);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowCommands(false);
        return;
      }
    }
    onKeyDown(e);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter((file) =>
      ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(file.type)
    );

    const newImages: SelectedImage[] = validFiles.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
    }));

    onImagesChange([...images, ...newImages]);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeImage = (id: string) => {
    const image = images.find((img) => img.id === id);
    if (image) {
      URL.revokeObjectURL(image.preview);
    }
    onImagesChange(images.filter((img) => img.id !== id));
  };

  const handleAttachClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <form onSubmit={onSubmit} className="px-3 md:px-4 pb-3 md:pb-4">
      <div className="relative rounded-xl bg-card border border-border shadow-subtle">
        {/* Slash Command Menu */}
        {showCommands && filteredCommands.length > 0 && (
          <div
            ref={commandMenuRef}
            className="absolute bottom-full left-0 right-0 mb-2 bg-card border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto z-50"
          >
            <div className="p-2">
              <p className="text-xs text-muted-foreground px-2 py-1 font-medium">Commands</p>
              {filteredCommands.map((cmd, index) => (
                <button
                  key={cmd.command}
                  type="button"
                  data-index={index}
                  onClick={() => selectCommand(cmd.command)}
                  className={cn(
                    "w-full flex items-center gap-3 px-2 py-2 rounded-md text-left transition-colors",
                    index === selectedIndex
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-secondary text-foreground"
                  )}
                >
                  <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center text-muted-foreground shrink-0">
                    {cmd.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{cmd.command}</div>
                    <div className="text-xs text-muted-foreground truncate">{cmd.description}</div>
                  </div>
                  {cmd.category && (
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded hidden sm:inline">
                      {cmd.category}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Image Previews */}
        {images.length > 0 && (
          <div className="flex gap-2 p-3 pb-0 flex-wrap">
            {images.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.preview}
                  alt="Upload preview"
                  className="w-14 h-14 md:w-16 md:h-16 object-cover rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={() => removeImage(image.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          multiple
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Tool Use Popup */}
        <ToolUsePopup
          isOpen={showToolPopup}
          onClose={() => setShowToolPopup(false)}
        />

        {/* Left buttons: Attach & Tools */}
        <div className="absolute left-2 md:left-3 bottom-2 md:bottom-3 flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleAttachClick}
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            {images.length > 0 ? (
              <ImageIcon className="w-5 h-5 text-primary" />
            ) : (
              <PlusCircle className="w-5 h-5" />
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowToolPopup(!showToolPopup)}
            className={cn(
              "w-8 h-8 hover:bg-secondary",
              showToolPopup ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Wrench className="w-4 h-4" />
          </Button>
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDownInternal}
          placeholder={images.length > 0 ? "Add a message..." : "Message Claude..."}
          rows={1}
          className="w-full bg-transparent text-[15px] py-3 md:py-3.5 pl-20 md:pl-24 pr-12 md:pr-14 resize-none focus:outline-none placeholder:text-muted-foreground"
          style={{ minHeight: "48px", maxHeight: "200px" }}
        />

        {/* Send Button */}
        <div className="absolute right-2 md:right-3 bottom-2 md:bottom-3">
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim() && images.length === 0}
            className={cn(
              "w-8 h-8 rounded-lg transition-all",
              value.trim() || images.length > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary text-muted-foreground"
            )}
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <p className="text-[10px] md:text-[11px] text-muted-foreground text-center mt-2">
        <span className="hidden sm:inline">Press Enter to send, Shift+Enter for new line</span>
        <span className="sm:hidden">Tap send button to send</span>
        {images.length > 0 && ` • ${images.length} image${images.length > 1 ? "s" : ""}`}
      </p>
    </form>
  );
}
