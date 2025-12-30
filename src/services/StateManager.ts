import { logger } from '../utils/logger';

/**
 * Pending repository creation state
 */
export interface PendingRepoCreation {
  workingDir: string;
  isPrivate: boolean;
  userId: number;
  chatId: number;
  originalName: string;
}

/**
 * Centralized state manager for all in-memory state
 */
export class StateManager {
  private pinnedMessages: Map<number, number> = new Map();
  private pendingRepoCreations: Map<number, PendingRepoCreation> = new Map();

  // Pinned Messages
  getPinnedMessageId(chatId: number): number | undefined {
    return this.pinnedMessages.get(chatId);
  }

  setPinnedMessageId(chatId: number, messageId: number): void {
    this.pinnedMessages.set(chatId, messageId);
  }

  deletePinnedMessage(chatId: number): void {
    this.pinnedMessages.delete(chatId);
  }

  // Pending Repo Creations
  hasPendingRepoCreation(userId: number): boolean {
    return this.pendingRepoCreations.has(userId);
  }

  getPendingRepoCreation(userId: number): PendingRepoCreation | undefined {
    return this.pendingRepoCreations.get(userId);
  }

  setPendingRepoCreation(userId: number, data: PendingRepoCreation): void {
    this.pendingRepoCreations.set(userId, data);
  }

  clearPendingRepoCreation(userId: number): void {
    this.pendingRepoCreations.delete(userId);
  }

  // Cleanup
  cleanup(): void {
    logger.debug('StateManager cleanup', {
      pinnedMessages: this.pinnedMessages.size,
      pendingRepoCreations: this.pendingRepoCreations.size
    });
  }
}

export const stateManager = new StateManager();
export default StateManager;
