"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  Search,
  PlusCircle,
  Send,
  Bot,
  User,
  Sparkles,
  Terminal,
  FileCode,
  CheckCircle2,
  Loader2,
  FolderGit2,
  Hash,
  MoreHorizontal,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { api, type Task } from "@/lib/api";
import { useChatContext } from "@/components/chat/chat-layout";
import { FileViewer } from "@/components/chat/file-viewer";
import { SettingsView } from "@/components/chat/settings-view";

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

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selectedFile, setSelectedFile, activeWorkspace, activeSession, showSettings, setShowSettings } = useChatContext();

  // Fetch all tasks
  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const data = await api.getTasks();
        setTasks(data);
      } catch (error) {
        console.error("Failed to fetch tasks:", error);
      }
    };

    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update messages based on active session
  useEffect(() => {
    if (activeSession === "general" || !activeSession) {
      // Show all messages for general session
      const taskMessages: Message[] = tasks.flatMap((task) => {
        const msgs: Message[] = [
          {
            id: `${task.id}-prompt`,
            author: { name: "You", isBot: false },
            content: task.prompt,
            timestamp: task.startTime,
            type: "text",
          },
        ];

        if (task.output) {
          msgs.push({
            id: `${task.id}-output`,
            author: { name: "Claude", isBot: true },
            content: task.output.slice(0, 500) + (task.output.length > 500 ? "..." : ""),
            timestamp: task.endTime || task.startTime,
            type: "text",
          });
        }

        return msgs;
      });
      setMessages(taskMessages);
    } else {
      // Show messages for specific session/task
      const task = tasks.find((t) => t.id === activeSession);
      if (task) {
        const sessionMessages: Message[] = [
          {
            id: `${task.id}-prompt`,
            author: { name: "You", isBot: false },
            content: task.prompt,
            timestamp: task.startTime,
            type: "text",
          },
        ];

        if (task.output) {
          sessionMessages.push({
            id: `${task.id}-output`,
            author: { name: "Claude", isBot: true },
            content: task.output,
            timestamp: task.endTime || task.startTime,
            type: "text",
          });
        }

        setMessages(sessionMessages);
      } else {
        setMessages([]);
      }
    }
  }, [activeSession, tasks]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      author: { name: "You", isBot: false },
      content: input,
      timestamp: new Date().toISOString(),
      type: "text",
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    try {
      await api.createTask(input, "/workspace", 1);
    } catch (error) {
      console.error("Failed to create task:", error);
    } finally {
      setTimeout(() => setIsTyping(false), 2000);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const runningTask = tasks.find((t) => t.status === "running");

  // Get current session name
  const currentSessionName = activeSession === "general" || !activeSession
    ? "General"
    : tasks.find((t) => t.id === activeSession)?.prompt.slice(0, 30) || "Session";

  // Show settings view if settings is selected
  if (showSettings) {
    return (
      <SettingsView
        onClose={() => setShowSettings(false)}
      />
    );
  }

  // Show file viewer if a file is selected
  if (selectedFile && activeWorkspace) {
    return (
      <FileViewer
        repositoryId={activeWorkspace}
        filePath={selectedFile}
        onClose={() => setSelectedFile(null)}
      />
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background">
      {/* Header */}
      <ChatHeader isRunning={!!runningTask} sessionName={currentSessionName} />

      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="py-6">
          {/* Welcome Message */}
          <WelcomeSection />

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
      />
    </div>
  );
}

function ChatHeader({ isRunning, sessionName }: { isRunning: boolean; sessionName: string }) {
  return (
    <div className="h-14 px-4 flex items-center justify-between border-b border-border bg-card shadow-subtle">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Hash className="w-5 h-5 text-muted-foreground" />
          <span className="font-semibold text-[15px]">{sessionName}</span>
        </div>
        {isRunning && (
          <>
            <div className="w-px h-5 bg-border" />
            <span className="badge badge-warning flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Running
            </span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search messages..."
            className="w-48 h-8 pl-9 pr-3 rounded-lg bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
          />
        </div>
        <Button variant="ghost" size="icon" className="w-8 h-8 text-muted-foreground hover:text-foreground">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function WelcomeSection() {
  return (
    <div className="px-6 pb-8 mb-6 border-b border-border">
      <div className="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-lg">
        <Sparkles className="w-8 h-8 text-primary-foreground" />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-foreground">
        Welcome to Claude Hub
      </h2>
      <p className="text-muted-foreground">
        Your AI-powered development assistant. Start a conversation to execute tasks, write code, and more.
      </p>
      <div className="flex gap-2 mt-4">
        <QuickAction icon={FolderGit2} label="Clone Repo" />
        <QuickAction icon={Terminal} label="Run Command" />
        <QuickAction icon={FileCode} label="Edit File" />
      </div>
    </div>
  );
}

function QuickAction({ icon: Icon, label }: { icon: React.ElementType; label: string }) {
  return (
    <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary hover:bg-secondary/80 text-sm font-medium text-foreground transition-colors border border-border">
      <Icon className="w-4 h-4 text-muted-foreground" />
      {label}
    </button>
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
        <span className="font-mono text-xs">{message.content}</span>
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
            {message.content}
          </div>
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
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

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

function ChatInput({ value, onChange, onSubmit, onKeyDown }: ChatInputProps) {
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
