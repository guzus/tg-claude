"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlusCircle, Send, X, Image as ImageIcon } from "lucide-react";
import { type ImageContent, type ImageMediaType } from "@/lib/api";

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

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

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

    // Reset input
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
    <form onSubmit={onSubmit} className="px-4 pb-4">
      <div className="relative rounded-xl bg-card border border-border shadow-subtle">
        {/* Image Previews */}
        {images.length > 0 && (
          <div className="flex gap-2 p-3 pb-0 flex-wrap">
            {images.map((image) => (
              <div key={image.id} className="relative group">
                <img
                  src={image.preview}
                  alt="Upload preview"
                  className="w-16 h-16 object-cover rounded-lg border border-border"
                />
                <button
                  type="button"
                  onClick={() => removeImage(image.id)}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
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

        {/* Attach Button */}
        <div className="absolute left-3 bottom-3">
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
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={images.length > 0 ? "Add a message about the image(s)..." : "Message Claude..."}
          rows={1}
          className="w-full bg-transparent text-[15px] py-3.5 px-14 resize-none focus:outline-none placeholder:text-muted-foreground"
          style={{ minHeight: "52px", maxHeight: "200px" }}
        />

        {/* Send Button */}
        <div className="absolute right-3 bottom-3">
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
      <p className="text-[11px] text-muted-foreground text-center mt-2">
        Press Enter to send, Shift+Enter for new line
        {images.length > 0 && ` • ${images.length} image${images.length > 1 ? "s" : ""} attached`}
      </p>
    </form>
  );
}
