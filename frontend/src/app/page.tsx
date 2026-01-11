"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type Task } from "@/lib/api";
import { useChatContext } from "@/components/chat/chat-layout";
import { FileViewer } from "@/components/chat/file-viewer";
import { SettingsView } from "@/components/chat/settings-view";
import { ChatHeader } from "@/components/chat/chat-header";
import { WelcomeSection } from "@/components/chat/welcome-section";
import { MessageItem } from "@/components/chat/message-item";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { ChatInput } from "@/components/chat/chat-input";
import { StreamingActions } from "@/components/chat/streaming-actions";
import { type Message, isDraftSessionId, isGeneralSession } from "@/lib/types";

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
      // Clear pending message as soon as task exists (to avoid duplicate display)
      setPendingMessage((prev) => {
        if (prev) {
          const matchingTask = data.find((t) => t.prompt === prev.content);
          if (matchingTask) {
            return null;
          }
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
    if (isDraftSessionId(activeSession)) {
      // Draft session - only show pending message if exists
      if (pendingMessage) {
        setMessages([pendingMessage]);
      } else {
        setMessages([]);
      }
    } else if (isGeneralSession(activeSession)) {
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
        // Find all tasks that share the same sessionId (conversation)
        const sessionTasks = task.sessionId
          ? tasks.filter((t) => t.sessionId === task.sessionId).sort(
              (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            )
          : [task];

        const sessionMessages: Message[] = [];

        // Add messages from all tasks in the session
        for (const t of sessionTasks) {
          sessionMessages.push({
            id: `${t.id}-prompt`,
            author: { name: "You", isBot: false },
            content: t.prompt,
            timestamp: t.startTime,
            type: "text",
          });

          if (t.output) {
            sessionMessages.push({
              id: `${t.id}-output`,
              author: { name: "Claude", isBot: true },
              content: t.output,
              timestamp: t.endTime || t.startTime,
              type: "text",
            });
          }
        }

        // Add pending message if exists for this session
        if (pendingMessage) {
          sessionMessages.push(pendingMessage);
        }

        setMessages(sessionMessages);
      } else if (pendingMessage) {
        // Task not found yet but we have a pending message - show it
        setMessages([pendingMessage]);
      }
      // If no task and no pending message, keep previous messages (don't clear)
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

    const wasDraftSession = isDraftSessionId(activeSession);
    const isTaskSession = !wasDraftSession && !isGeneralSession(activeSession);

    // Get the sessionId if we're continuing a conversation in an existing task session
    let resumeSessionId: string | undefined;
    if (isTaskSession) {
      const currentTask = tasks.find((t) => t.id === activeSession);
      resumeSessionId = currentTask?.sessionId;
    }

    setPendingMessage(userMessage);
    setInput("");
    setIsTyping(true);

    try {
      const workingDir = currentRepository?.path || "/workspace";
      const newTask = await api.createTask(input, workingDir, 1, resumeSessionId);

      // If this was a draft session, remove it and switch to the new task
      if (wasDraftSession) {
        removeDraftSession(activeSession as `draft-${string}`);
        // Switch to the new task's session
        if (newTask?.id) {
          setActiveSession(newTask.id);
        }
      } else if (isGeneralSession(activeSession) && newTask?.id) {
        // In general view, switch to the new task
        setActiveSession(newTask.id);
      }
      // For existing task sessions, stay on the same session (the new task will appear there)

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

  // Find running task - for session view, check if any task in the session is running
  const runningTask = (() => {
    if (isDraftSessionId(activeSession) || isGeneralSession(activeSession)) {
      return tasks.find((t) => t.status === "running");
    }
    const currentTask = tasks.find((t) => t.id === activeSession);
    if (!currentTask?.sessionId) {
      return currentTask?.status === "running" ? currentTask : undefined;
    }
    // Find any running task in the same session
    return tasks.find(
      (t) => t.sessionId === currentTask.sessionId && t.status === "running"
    );
  })();

  // Get current session name
  const currentSessionName = isDraftSessionId(activeSession)
    ? "New Session"
    : isGeneralSession(activeSession)
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

          {/* Streaming Actions - show real-time progress when task is running */}
          {runningTask && (
            <StreamingActions
              taskId={runningTask.id}
              onComplete={() => {
                // Refresh tasks when streaming completes
                fetchTasks();
              }}
            />
          )}

          {/* Typing Indicator */}
          {isTyping && !runningTask && <TypingIndicator />}
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
