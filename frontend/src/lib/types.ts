/**
 * Centralized type definitions for the frontend
 */

// Session Types
export type SessionId = string;

export interface DraftSession {
  id: `draft-${string}`;
  name: string;
  createdAt: string;
}

export interface TaskSession {
  id: string;
  name: string;
  status: "running" | "completed" | "idle";
  timestamp?: string;
}

export type Session = TaskSession;

// Type guards
export function isDraftSessionId(id: SessionId | undefined | null): id is `draft-${string}` {
  return typeof id === "string" && id.startsWith("draft-");
}

export function isTaskSession(id: SessionId | undefined | null): boolean {
  return typeof id === "string" && !isDraftSessionId(id);
}

// Message Types
export interface MessageAuthor {
  name: string;
  avatar?: string;
  isBot?: boolean;
}

export interface TaskMetadata {
  durationSeconds?: number;
  costUsd?: number;
  status?: "completed" | "failed" | "cancelled" | "timeout";
}

export interface Message {
  id: string;
  author: MessageAuthor;
  content: string;
  timestamp: string;
  type?: "text" | "code" | "action";
  actionType?: "command" | "file_change" | "tool";
  metadata?: TaskMetadata;
}

// Re-export API types for convenience
export type { Task, Repository, UserConfig, FileNode, FileContent } from "./api";
