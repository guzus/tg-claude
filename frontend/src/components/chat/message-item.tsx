"use client";

import { cn, formatDate } from "@/lib/utils";
import { Bot, User, Terminal, FileCode, CheckCircle2 } from "lucide-react";
import { type Message } from "@/lib/types";

export type { Message };

interface MessageItemProps {
  message: Message;
  showHeader: boolean;
  highlightText?: string;
}

function HighlightedText({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) {
    return <>{text}</>;
  }

  const parts = text.split(new RegExp(`(${highlight.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));

  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === highlight.toLowerCase() ? (
          <mark key={i} className="bg-yellow-300 dark:bg-yellow-600 text-foreground rounded px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
}

export function MessageItem({ message, showHeader, highlightText }: MessageItemProps) {
  const isAction = message.type === "action";

  if (isAction) {
    return (
      <div className="px-6 py-1.5 flex items-center gap-3 text-sm text-muted-foreground hover:bg-secondary/50 rounded-lg mx-4">
        <div className="w-10 flex justify-center">
          {message.actionType === "command" && (
            <Terminal className="w-4 h-4 text-amber-600" />
          )}
          {message.actionType === "file_change" && (
            <FileCode className="w-4 h-4 text-emerald-600" />
          )}
          {message.actionType === "tool" && (
            <CheckCircle2 className="w-4 h-4 text-primary" />
          )}
        </div>
        <span className="font-mono text-xs">
          <HighlightedText text={message.content} highlight={highlightText} />
        </span>
        <span className="text-[10px] text-muted-foreground ml-auto">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group px-6 py-1 hover:bg-secondary/30 mx-4 rounded-lg",
        showHeader && "mt-4 pt-2"
      )}
    >
      <div className="flex gap-4">
        {/* Avatar */}
        {showHeader ? (
          <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center overflow-hidden">
            {message.author.isBot ? (
              <div className="w-full h-full bg-primary flex items-center justify-center">
                <Bot className="w-5 h-5 text-primary-foreground" />
              </div>
            ) : (
              <div className="w-full h-full bg-foreground flex items-center justify-center">
                <User className="w-5 h-5 text-background" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-10 shrink-0 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {showHeader && (
            <div className="flex items-center gap-2 mb-1">
              <span
                className={cn(
                  "font-semibold hover:underline cursor-pointer",
                  message.author.isBot ? "text-primary" : "text-foreground"
                )}
              >
                {message.author.name}
              </span>
              {message.author.isBot && (
                <span className="badge badge-primary">BOT</span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDate(message.timestamp)}
              </span>
            </div>
          )}
          <div className="text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
            <HighlightedText text={message.content} highlight={highlightText} />
          </div>
        </div>
      </div>
    </div>
  );
}
