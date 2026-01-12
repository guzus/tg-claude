"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api, type Task } from "@/lib/api";
import { useChatContext } from "@/components/chat/chat-layout";
import { FileViewer } from "@/components/chat/file-viewer";
import { SettingsView } from "@/components/chat/settings-view";
import { ChatHeader } from "@/components/chat/chat-header";
import { WelcomeSection } from "@/components/chat/welcome-section";
import { MessageItem } from "@/components/chat/message-item";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { ChatInput, fileToImageContent, type SelectedImage } from "@/components/chat/chat-input";
import { StreamingActions } from "@/components/chat/streaming-actions";
import { type Message, isDraftSessionId } from "@/lib/types";

export default function HomePage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pendingMessage, setPendingMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
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
    // No session selected or draft session - show empty/pending state
    if (!activeSession || isDraftSessionId(activeSession)) {
      if (pendingMessage) {
        setMessages([pendingMessage]);
      } else {
        setMessages([]);
      }
      return;
    }

    // Show messages for specific session/task
    // First, try to find task by ID
    let task = tasks.find((t) => t.id === activeSession);

    // If not found by ID, try to find by sessionId (the session might be identified by sessionId)
    if (!task) {
      task = tasks.find((t) => t.sessionId === activeSession);
    }

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
    } else {
      // Clear messages when switching to a session that doesn't exist yet
      setMessages([]);
    }
  }, [activeSession, tasks, pendingMessage]);


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && selectedImages.length === 0) return;

    const messageContent = selectedImages.length > 0
      ? `${input}${input ? "\n" : ""}[${selectedImages.length} image${selectedImages.length > 1 ? "s" : ""} attached]`
      : input;

    const userMessage: Message = {
      id: Date.now().toString(),
      author: { name: "You", isBot: false },
      content: messageContent,
      timestamp: new Date().toISOString(),
      type: "text",
    };

    const wasDraftSession = isDraftSessionId(activeSession);
    const isNewSession = !activeSession || wasDraftSession;

    // Only get resumeSessionId if we're continuing an EXISTING task session
    let resumeSessionId: string | undefined;
    if (!isNewSession) {
      const currentTask = tasks.find((t) => t.id === activeSession);
      resumeSessionId = currentTask?.sessionId;
    }

    // Convert selected images to API format
    const imageContents = await Promise.all(
      selectedImages.map((img) => fileToImageContent(img.file))
    );

    setPendingMessage(userMessage);
    setInput("");
    setSelectedImages([]);
    setIsTyping(true);

    try {
      const workingDir = currentRepository?.path || "/workspace";
      const newTask = await api.createTask(
        input || "Please analyze this image",
        workingDir,
        1,
        {
          resumeSessionId,
          newSession: isNewSession,
          images: imageContents.length > 0 ? imageContents : undefined,
        }
      );

      // If this was a new session (draft or empty), switch to the new task
      if (isNewSession) {
        if (wasDraftSession) {
          removeDraftSession(activeSession as `draft-${string}`);
        }
        // Switch to the new task's session
        if (newTask?.id) {
          setActiveSession(newTask.id);
        }
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
    if (!activeSession || isDraftSessionId(activeSession)) {
      return undefined;
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
  const currentSessionName = !activeSession
    ? "New Chat"
    : isDraftSessionId(activeSession)
    ? "New Session"
    : tasks.find((t) => t.id === activeSession)?.prompt.slice(0, 30) || "Session";

  // Filter messages based on search query
  const filteredMessages = searchQuery.trim()
    ? messages.filter((msg) =>
        msg.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : messages;

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
    <div className="flex-1 flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <ChatHeader isRunning={!!runningTask} sessionName={currentSessionName} onSearch={setSearchQuery} />

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="py-6">
          {/* Welcome Message */}
          <WelcomeSection />

          {/* Messages */}
          <div className="space-y-0">
            {filteredMessages.length === 0 && searchQuery.trim() ? (
              <p className="text-center text-muted-foreground py-8">
                No messages matching &quot;{searchQuery}&quot;
              </p>
            ) : (
              filteredMessages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  showHeader={
                    index === 0 ||
                    filteredMessages[index - 1].author.name !== message.author.name ||
                    new Date(message.timestamp).getTime() -
                      new Date(filteredMessages[index - 1].timestamp).getTime() >
                      300000
                  }
                  highlightText={searchQuery.trim() || undefined}
                />
              ))
            )}
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
        images={selectedImages}
        onImagesChange={setSelectedImages}
      />
    </div>
  );
}
