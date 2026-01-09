import fs from 'fs';
import path from 'path';
import { STATE_PATH } from '../config';
import { AIProviderConfig, McpServer, TaskStatus } from '../types';
import { logger } from '../utils/logger';

export interface PersistedTaskState {
  id: string;
  userId: number;
  chatId: number;
  messageId?: number;
  prompt: string;
  workingDir: string;
  status: TaskStatus;
  startTime: string;
  updatedAt: string;
  sessionId?: string;
  aiProvider?: AIProviderConfig;
  ralphLoop?: { completionPromise: string; maxIterations: number };
  mcpServers?: Record<string, McpServer>;
  resumeAttempts?: number;
  resumeLockedAt?: string;
  resumeLockId?: string;
  resumeNotifiedAt?: string;
}

const TASK_STATE_FILE = path.join(STATE_PATH, 'tasks.json');

export class TaskStateStore {
  private tasks: Map<string, PersistedTaskState> = new Map();
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    this.ensureStateDir();
    this.loadFromDisk();
  }

  getTask(taskId: string): PersistedTaskState | undefined {
    return this.tasks.get(taskId);
  }

  getActiveTasks(): PersistedTaskState[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === TaskStatus.PENDING || task.status === TaskStatus.RUNNING
    );
  }

  upsertTask(task: PersistedTaskState): void {
    const updatedAt = new Date().toISOString();
    this.tasks.set(task.id, { ...task, updatedAt });
    this.queueWrite();
  }

  updateTask(taskId: string, updates: Partial<PersistedTaskState>): void {
    const existing = this.tasks.get(taskId);
    if (!existing) return;
    this.tasks.set(taskId, {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    });
    this.queueWrite();
  }

  tryLockResume(taskId: string, lockId: string, ttlMs: number): boolean {
    const existing = this.tasks.get(taskId);
    if (!existing) return false;
    if (existing.resumeLockedAt && existing.resumeLockId && existing.resumeLockId !== lockId) {
      const lockedAt = new Date(existing.resumeLockedAt).getTime();
      if (Number.isFinite(lockedAt) && Date.now() - lockedAt < ttlMs) {
        return false;
      }
    }

    this.updateTask(taskId, {
      resumeLockedAt: new Date().toISOString(),
      resumeLockId: lockId,
    });
    return true;
  }

  markResumeNotified(taskId: string): void {
    this.updateTask(taskId, { resumeNotifiedAt: new Date().toISOString() });
  }

  incrementResumeAttempts(taskId: string): number {
    const existing = this.tasks.get(taskId);
    if (!existing) return 0;
    const nextAttempts = (existing.resumeAttempts || 0) + 1;
    this.updateTask(taskId, { resumeAttempts: nextAttempts });
    return nextAttempts;
  }

  removeTask(taskId: string): void {
    if (!this.tasks.has(taskId)) return;
    this.tasks.delete(taskId);
    this.queueWrite();
  }

  private ensureStateDir(): void {
    try {
      if (!fs.existsSync(STATE_PATH)) {
        fs.mkdirSync(STATE_PATH, { recursive: true });
      }
    } catch (error) {
      logger.warn('Failed to ensure task state directory', { error });
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(TASK_STATE_FILE)) return;
    try {
      const raw = fs.readFileSync(TASK_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as { tasks?: PersistedTaskState[] } | PersistedTaskState[];
      const tasksArray = Array.isArray(parsed) ? parsed : parsed.tasks;
      if (!tasksArray) return;
      for (const task of tasksArray) {
        if (task?.id) {
          this.tasks.set(task.id, task);
        }
      }
    } catch (error) {
      logger.warn('Failed to load task state', { error });
    }
  }

  private queueWrite(): void {
    const payload = { tasks: Array.from(this.tasks.values()) };
    this.writeChain = this.writeChain
      .then(() => fs.promises.writeFile(TASK_STATE_FILE, JSON.stringify(payload, null, 2), 'utf-8'))
      .catch((error) => {
        logger.warn('Failed to persist task state', { error });
      });
  }
}
