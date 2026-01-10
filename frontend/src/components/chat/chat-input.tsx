"use client";

import { useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlusCircle, Send } from "lucide-react";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function ChatInput({ value, onChange, onSubmit, onKeyDown }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <form onSubmit={onSubmit} className="px-4 pb-4">
      <div className="relative rounded-xl bg-card border border-border shadow-subtle">
        {/* Attach Button */}
        <div className="absolute left-3 bottom-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-8 h-8 text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <PlusCircle className="w-5 h-5" />
          </Button>
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Claude..."
          rows={1}
          className="w-full bg-transparent text-[15px] py-3.5 px-14 resize-none focus:outline-none placeholder:text-muted-foreground"
          style={{ minHeight: "52px", maxHeight: "200px" }}
        />

        {/* Send Button */}
        <div className="absolute right-3 bottom-3">
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim()}
            className={cn(
              "w-8 h-8 rounded-lg transition-all",
              value.trim()
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
      </p>
    </form>
  );
}
