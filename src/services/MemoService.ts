import { promises as fs } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Memo, MemoType, MemoStatus } from '../types';
import { logger } from '../utils/logger';

/**
 * Service for managing user memos (tasks done and to-do)
 */
export class MemoService {
  private memosPath: string;
  private memos: Map<number, Memo[]> = new Map();

  constructor(memosPath?: string) {
    this.memosPath = memosPath || path.join(process.cwd(), 'data', 'memos');
  }

  /**
   * Initialize the memo service
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.memosPath, { recursive: true });
      await this.loadAllMemos();

      logger.info('MemoService initialized', {
        memosPath: this.memosPath,
        usersWithMemos: this.memos.size
      });
    } catch (error) {
      logger.error('Failed to initialize MemoService', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Load all memos from disk
   */
  private async loadAllMemos(): Promise<void> {
    try {
      const files = await fs.readdir(this.memosPath);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const userId = parseInt(file.replace('memos_', '').replace('.json', ''));
          if (!isNaN(userId)) {
            await this.loadUserMemos(userId);
          }
        }
      }
    } catch (error) {
      logger.debug('No existing memos found', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Load memos for a specific user
   */
  private async loadUserMemos(userId: number): Promise<void> {
    try {
      const filePath = this.getMemosFilePath(userId);
      const data = await fs.readFile(filePath, 'utf-8');
      const memos = JSON.parse(data);

      // Convert date strings back to Date objects
      const parsedMemos = memos.map((memo: Memo) => ({
        ...memo,
        createdAt: new Date(memo.createdAt),
        updatedAt: new Date(memo.updatedAt),
        completedAt: memo.completedAt ? new Date(memo.completedAt) : undefined
      }));

      this.memos.set(userId, parsedMemos);

      logger.debug('Loaded user memos', { userId, count: parsedMemos.length });
    } catch (error) {
      logger.debug('Failed to load user memos', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Get memos file path for a user
   */
  private getMemosFilePath(userId: number): string {
    return path.join(this.memosPath, `memos_${userId}.json`);
  }

  /**
   * Save memos to disk
   */
  private async saveMemos(userId: number): Promise<void> {
    try {
      const filePath = this.getMemosFilePath(userId);
      const memos = this.memos.get(userId) || [];
      await fs.writeFile(filePath, JSON.stringify(memos, null, 2), 'utf-8');

      logger.debug('Saved user memos', { userId, count: memos.length });
    } catch (error) {
      logger.error('Failed to save user memos', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Add a new memo
   */
  async addMemo(
    userId: number,
    content: string,
    type: MemoType = MemoType.TODO,
    relatedTaskId?: string,
    relatedPR?: number
  ): Promise<Memo> {
    const now = new Date();
    const memo: Memo = {
      id: uuidv4(),
      userId,
      content,
      type,
      status: type === MemoType.DONE ? MemoStatus.COMPLETED : MemoStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      completedAt: type === MemoType.DONE ? now : undefined,
      relatedTaskId,
      relatedPR
    };

    const userMemos = this.memos.get(userId) || [];
    userMemos.push(memo);
    this.memos.set(userId, userMemos);

    await this.saveMemos(userId);

    logger.info('Added memo', { userId, memoId: memo.id, type });

    return memo;
  }

  /**
   * Get all memos for a user
   */
  getMemos(userId: number, type?: MemoType, status?: MemoStatus): Memo[] {
    const userMemos = this.memos.get(userId) || [];

    return userMemos.filter(memo => {
      if (type && memo.type !== type) return false;
      if (status && memo.status !== status) return false;
      return true;
    });
  }

  /**
   * Get pending todos for a user
   */
  getPendingTodos(userId: number): Memo[] {
    return this.getMemos(userId, MemoType.TODO, MemoStatus.PENDING);
  }

  /**
   * Get completed tasks for a user
   */
  getCompletedTasks(userId: number): Memo[] {
    return this.getMemos(userId, MemoType.DONE);
  }

  /**
   * Mark a memo as completed
   */
  async completeMemo(userId: number, memoId: string): Promise<Memo | null> {
    const userMemos = this.memos.get(userId) || [];
    const memo = userMemos.find(m => m.id === memoId);

    if (!memo) return null;

    memo.status = MemoStatus.COMPLETED;
    memo.completedAt = new Date();
    memo.updatedAt = new Date();

    await this.saveMemos(userId);

    logger.info('Completed memo', { userId, memoId });

    return memo;
  }

  /**
   * Delete a memo
   */
  async deleteMemo(userId: number, memoId: string): Promise<boolean> {
    const userMemos = this.memos.get(userId) || [];
    const index = userMemos.findIndex(m => m.id === memoId);

    if (index === -1) return false;

    userMemos.splice(index, 1);
    this.memos.set(userId, userMemos);

    await this.saveMemos(userId);

    logger.info('Deleted memo', { userId, memoId });

    return true;
  }

  /**
   * Update a memo
   */
  async updateMemo(userId: number, memoId: string, updates: Partial<Memo>): Promise<Memo | null> {
    const userMemos = this.memos.get(userId) || [];
    const memo = userMemos.find(m => m.id === memoId);

    if (!memo) return null;

    if (updates.content) memo.content = updates.content;
    if (updates.type) memo.type = updates.type;
    if (updates.status) memo.status = updates.status;
    if (updates.relatedTaskId) memo.relatedTaskId = updates.relatedTaskId;
    if (updates.relatedPR) memo.relatedPR = updates.relatedPR;

    memo.updatedAt = new Date();

    await this.saveMemos(userId);

    logger.info('Updated memo', { userId, memoId });

    return memo;
  }

  /**
   * Get summary of memos for a user
   */
  getSummary(userId: number): { todos: number; done: number; notes: number } {
    const userMemos = this.memos.get(userId) || [];

    return {
      todos: userMemos.filter(m => m.type === MemoType.TODO && m.status === MemoStatus.PENDING).length,
      done: userMemos.filter(m => m.type === MemoType.DONE || m.status === MemoStatus.COMPLETED).length,
      notes: userMemos.filter(m => m.type === MemoType.NOTE).length
    };
  }

  /**
   * Clear all memos for a user
   */
  async clearMemos(userId: number, type?: MemoType): Promise<number> {
    const userMemos = this.memos.get(userId) || [];

    if (type) {
      const remaining = userMemos.filter(m => m.type !== type);
      const cleared = userMemos.length - remaining.length;
      this.memos.set(userId, remaining);
      await this.saveMemos(userId);
      return cleared;
    }

    const cleared = userMemos.length;
    this.memos.set(userId, []);
    await this.saveMemos(userId);
    return cleared;
  }
}

export default MemoService;
