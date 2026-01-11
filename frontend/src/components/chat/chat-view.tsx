"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Hash,
  Users,
  Pin,
  Bell,
  Search,
  Inbox,
  HelpCircle,
  PlusCircle,
  Gift,
  Smile,
  Send,
  Bot,
  User,
  Sparkles,
  Terminal,
  FileCode,
  CheckCircle2,
} from "lucide-react";
import { formatDate } from "@/lib/utils";

interface Message {
  id: string;
  author: {
    name: string;
    avatar?: string;
    isBot?: boolean;
  };
  content: string;
  timestamp: string;
  type?: "text" | "code" | "action";
  actionType?: "command" | "file_change" | "tool";
}

const mockMessages: Message[] = [
  {
    id: "1",
    author: { name: "You", isBot: false },
    content: "Create a Discord-like interface for the frontend",
    timestamp: new Date(Date.now() - 300000).toISOString(),
    type: "text",
  },
  {
    id: "2",
    author: { name: "Claude", isBot: true },
    content: "I'll help you create a Discord-like chat interface. Let me analyze the current codebase structure first.",
    timestamp: new Date(Date.now() - 290000).toISOString(),
    type: "text",
  },
  {
    id: "3",
    author: { name: "Claude", isBot: true },
    content: "Reading frontend/src/components/layout/sidebar.tsx",
    timestamp: new Date(Date.now() - 280000).toISOString(),
    type: "action",
    actionType: "command",
  },
  {
    id: "4",
    author: { name: "Claude", isBot: true },
    content: `I'll create a new layout with:
1. **Server Bar** - workspace icons on the far left
2. **Chat Sidebar** - conversations list with settings at bottom
3. **Chat View** - main message area with input

Let me start implementing these components.`,
    timestamp: new Date(Date.now() - 270000).toISOString(),
    type: "text",
  },
  {
    id: "5",
    author: { name: "Claude", isBot: true },
    content: "Created frontend/src/components/chat/server-bar.tsx",
    timestamp: new Date(Date.now() - 260000).toISOString(),
    type: "action",
    actionType: "file_change",
  },
  {
    id: "6",
    author: { name: "Claude", isBot: true },
    content: "Created frontend/src/components/chat/chat-sidebar.tsx",
    timestamp: new Date(Date.now() - 250000).toISOString(),
    type: "action",
    actionType: "file_change",
  },
];

interface ChatViewProps {
  conversationName?: string;
  conversationType?: "task" | "chat";
}

export function ChatView({
  conversationName = "build-frontend",
  conversationType = "task",
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>(mockMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const newMessage: Message = {
      id: Date.now().toString(),
      author: { name: "You", isBot: false },
      content: input,
      timestamp: new Date().toISOString(),
      type: "text",
    };

    setMessages([...messages, newMessage]);
    setInput("");
    setIsTyping(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-card">
      {/* Channel Header */}
      <ChatHeader name={conversationName} type={conversationType} />

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="py-4">
          {/* Welcome Message */}
          <div className="px-4 pb-6 mb-4 border-b border-border/30">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center mb-4">
              {conversationType === "task" ? (
                <Sparkles className="w-8 h-8 text-white" />
              ) : (
                <Hash className="w-8 h-8 text-white" />
              )}
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {conversationType === "task" ? "Task: " : "#"}{conversationName}
            </h2>
            <p className="text-muted-foreground">
              {conversationType === "task"
                ? "This is the beginning of your task conversation with Claude."
                : `Welcome to #${conversationName}! This is the start of the conversation.`}
            </p>
          </div>

          {/* Messages */}
          <div className="space-y-0">
            {messages.map((message, index) => (
              <MessageItem
                key={message.id}
                message={message}
                showHeader={
                  index === 0 ||
                  messages[index - 1].author.name !== message.author.name ||
                  new Date(message.timestamp).getTime() -
                    new Date(messages[index - 1].timestamp).getTime() >
                    300000
                }
              />
            ))}
          </div>

          {/* Typing Indicator */}
          {isTyping && <TypingIndicator />}
        </div>
      </ScrollArea>

      {/* Message Input */}
      <ChatInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        channelName={conversationName}
      />
    </div>
  );
}

function ChatHeader({ name, type }: { name: string; type: "task" | "chat" }) {
  return (
    <div className="h-12 px-4 flex items-center justify-between border-b border-border/50 bg-card/80 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        {type === "task" ? (
          <Sparkles className="w-5 h-5 text-primary" />
        ) : (
          <Hash className="w-5 h-5 text-muted-foreground" />
        )}
        <span className="font-semibold">{name}</span>
        {type === "task" && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-emerald-500/20 text-emerald-400 rounded">
            Running
          </span>
        )}
      </div>

      <div className="flex items-center gap-1">
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
              <Bell className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Notifications</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
              <Pin className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Pinned Messages</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
              <Users className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Member List</TooltipContent>
        </Tooltip>

        <div className="w-px h-6 bg-border mx-1" />

        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search"
            className="w-36 h-7 pl-8 pr-2 rounded bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
              <Inbox className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Inbox</TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
              <HelpCircle className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function MessageItem({
  message,
  showHeader,
}: {
  message: Message;
  showHeader: boolean;
}) {
  const isAction = message.type === "action";

  if (isAction) {
    return (
      <div className="px-4 py-1 flex items-center gap-2 text-sm text-muted-foreground hover:bg-secondary/20">
        <div className="w-10 flex justify-center">
          {message.actionType === "command" && (
            <Terminal className="w-4 h-4 text-amber-500" />
          )}
          {message.actionType === "file_change" && (
            <FileCode className="w-4 h-4 text-emerald-500" />
          )}
          {message.actionType === "tool" && (
            <CheckCircle2 className="w-4 h-4 text-primary" />
          )}
        </div>
        <span className="font-mono text-xs">{message.content}</span>
        <span className="text-[10px] opacity-50 ml-auto">
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
        "message-row px-4 py-0.5 hover:bg-secondary/20",
        showHeader && "mt-4 pt-1"
      )}
    >
      <div className="flex gap-4">
        {/* Avatar */}
        {showHeader ? (
          <div className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center overflow-hidden">
            {message.author.isBot ? (
              <div className="w-full h-full bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                <User className="w-5 h-5 text-white" />
              </div>
            )}
          </div>
        ) : (
          <div className="w-10 shrink-0 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100 hover:opacity-100">
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
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={cn(
                  "font-medium hover:underline cursor-pointer",
                  message.author.isBot ? "text-primary" : "text-foreground"
                )}
              >
                {message.author.name}
              </span>
              {message.author.isBot && (
                <span className="px-1 py-0.5 text-[10px] font-medium bg-primary/20 text-primary rounded">
                  BOT
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {formatDate(message.timestamp)}
              </span>
            </div>
          )}
          <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="px-4 py-2 flex items-center gap-3">
      <div className="w-10 h-6 flex items-center justify-center">
        <div className="flex items-center gap-1">
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-primary" />
        </div>
      </div>
      <span className="text-sm text-muted-foreground">
        <strong className="text-primary">Claude</strong> is typing...
      </span>
    </div>
  );
}

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  channelName: string;
}

const ChatInput = ({
  value,
  onChange,
  onSubmit,
  onKeyDown,
  channelName,
}: ChatInputProps) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [value]);

  return (
    <form onSubmit={onSubmit} className="px-4 pb-6">
      <div className="chat-input-wrapper relative rounded-lg bg-secondary/50 border border-border/50">
        {/* Attach Button */}
        <div className="absolute left-3 bottom-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
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
          placeholder={`Message #${channelName}`}
          rows={1}
          className="w-full bg-transparent text-[15px] py-3 px-14 resize-none focus:outline-none placeholder:text-muted-foreground"
          style={{ minHeight: "46px", maxHeight: "200px" }}
        />

        {/* Right Actions */}
        <div className="absolute right-3 bottom-3 flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
          >
            <Gift className="w-5 h-5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-foreground"
          >
            <Smile className="w-5 h-5" />
          </Button>
          {value.trim() && (
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              className="w-7 h-7 text-primary hover:text-primary hover:bg-primary/10"
            >
              <Send className="w-5 h-5" />
            </Button>
          )}
        </div>
      </div>
    </form>
  );
};
