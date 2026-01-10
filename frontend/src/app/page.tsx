"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type Task } from "@/lib/api";
import { useChatContext } from "@/components/chat/chat-layout";
import { FileViewer } from "@/components/chat/file-viewer";
import { SettingsView } from "@/components/chat/settings-view";
import { ChatHeader } from "@/components/chat/chat-header";
import { WelcomeSection } from "@/components/chat/welcome-section";
import { MessageItem, type Message } from "@/components/chat/message-item";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { ChatInput } from "@/components/chat/chat-input";

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingMessage, setPendingMessage] = useState<Message | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { selectedFile, setSelectedFile, activeWorkspace, activeSession, setActiveSession, showSettings, setShowSettings, currentRepository, removeDraftSession } = useChatContext();

  // Fetch all tasks
  const fetchTasks = useCallback(async () => {
    try {
      const data = await api.getTasks();
      setTasks(data);
      // Clear pending message if it now exists in tasks
      setPendingMessage((prev) => {
        if (prev && data.some((t) => t.prompt === prev.content)) {
          return null;
        }
        return prev;
      });
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Update messages based on active session
  useEffect(() => {
    // Check if this is a draft session
    const isDraftSession = typeof activeSession === "string" && activeSession.startsWith("draft-");

    if (isDraftSession) {
      // Draft session - only show pending message if exists
      if (pendingMessage) {
        setMessages([pendingMessage]);
      } else {
        setMessages([]);
      }
    } else if (activeSession === "general" || !activeSession) {
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

      // Add pending message if exists
      if (pendingMessage) {
        taskMessages.push(pendingMessage);
      }

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

        // Add pending message if exists for this session
        if (pendingMessage) {
          sessionMessages.push(pendingMessage);
        }

        setMessages(sessionMessages);
      } else {
        setMessages([]);
      }
    }
  }, [activeSession, tasks, pendingMessage]);

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

    // Check if we're in a draft session
    const isDraftSession = typeof activeSession === "string" && activeSession.startsWith("draft-");

    setPendingMessage(userMessage);
    setInput("");
    setIsTyping(true);

    try {
      const workingDir = currentRepository?.path || "/workspace";
      const newTask = await api.createTask(input, workingDir, 1);

      // If this was a draft session, remove it and switch to the new task
      if (isDraftSession) {
        removeDraftSession(activeSession);
        // Switch to the new task's session
        if (newTask?.id) {
          setActiveSession(newTask.id);
        }
      }

      // Immediately fetch tasks to get the new task
      await fetchTasks();
    } catch (error) {
      console.error("Failed to create task:", error);
      // Clear pending message on error
      setPendingMessage(null);
    } finally {
      setIsTyping(false);
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
  const isDraftSession = typeof activeSession === "string" && activeSession.startsWith("draft-");
  const currentSessionName = isDraftSession
    ? "New Session"
    : activeSession === "general" || !activeSession
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
