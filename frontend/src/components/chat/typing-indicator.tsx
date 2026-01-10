"use client";

import { Bot } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="px-6 py-3 flex items-center gap-3 mx-4">
      <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center shadow-sm">
        <Bot className="w-5 h-5 text-primary-foreground" />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
          <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
        </div>
        <span className="text-sm text-muted-foreground ml-2">
          <strong className="text-primary">Claude</strong> is thinking...
        </span>
      </div>
    </div>
  );
}
