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
 * Pending /new_repo command state (waiting for name input)
 */
export interface PendingNewRepoName {
  userId: number;
  chatId: number;
  messageId: number;  // Message to update
}

/**
 * Centralized state manager for all in-memory state
 */
export class StateManager {
  private pinnedMessages: Map<number, number> = new Map();
  private pendingRepoCreations: Map<number, PendingRepoCreation> = new Map();
  private pendingNewRepoNames: Map<number, PendingNewRepoName> = new Map();

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

  // Pending New Repo Name (for /new_repo command)
  hasPendingNewRepoName(userId: number): boolean {
    return this.pendingNewRepoNames.has(userId);
  }

  getPendingNewRepoName(userId: number): PendingNewRepoName | undefined {
    return this.pendingNewRepoNames.get(userId);
  }

  setPendingNewRepoName(userId: number, data: PendingNewRepoName): void {
    this.pendingNewRepoNames.set(userId, data);
  }

  clearPendingNewRepoName(userId: number): void {
    this.pendingNewRepoNames.delete(userId);
  }

  // Cleanup
  cleanup(): void {
    logger.debug('StateManager cleanup', {
      pinnedMessages: this.pinnedMessages.size,
      pendingRepoCreations: this.pendingRepoCreations.size,
      pendingNewRepoNames: this.pendingNewRepoNames.size
    });
  }
}

export const stateManager = new StateManager();
export default StateManager;
