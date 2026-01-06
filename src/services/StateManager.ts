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
interface PendingNewRepoName {
  userId: number;
  chatId: number;
  messageId: number;  // Message to update
}

/**
 * Pending API key entry state (waiting for user to paste a provider key)
 */
export interface PendingApiKeyEntry {
  userId: number;
  chatId: number;
  messageId: number; // Message to update (usually the /ai message)
  provider: 'glm' | 'openrouter';
}

/**
 * Pending model entry state (waiting for user to paste a model ID string)
 */
export interface PendingModelEntry {
  userId: number;
  chatId: number;
  messageId: number;
  provider: 'openrouter';
  slot: 'haiku' | 'sonnet' | 'opus';
}

/**
 * Centralized state manager for all in-memory state
 */
class StateManager {
  private pinnedMessages: Map<number, number> = new Map();
  private pendingRepoCreations: Map<number, PendingRepoCreation> = new Map();
  private pendingNewRepoNames: Map<number, PendingNewRepoName> = new Map();
  private pendingApiKeys: Map<number, PendingApiKeyEntry> = new Map();
  private pendingModels: Map<number, PendingModelEntry> = new Map();

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

  // Pending API Key Entry
  hasPendingApiKeyEntry(userId: number): boolean {
    return this.pendingApiKeys.has(userId);
  }

  getPendingApiKeyEntry(userId: number): PendingApiKeyEntry | undefined {
    return this.pendingApiKeys.get(userId);
  }

  setPendingApiKeyEntry(userId: number, data: PendingApiKeyEntry): void {
    this.pendingApiKeys.set(userId, data);
  }

  clearPendingApiKeyEntry(userId: number): void {
    this.pendingApiKeys.delete(userId);
  }

  // Pending Model Entry
  hasPendingModelEntry(userId: number): boolean {
    return this.pendingModels.has(userId);
  }

  getPendingModelEntry(userId: number): PendingModelEntry | undefined {
    return this.pendingModels.get(userId);
  }

  setPendingModelEntry(userId: number, data: PendingModelEntry): void {
    this.pendingModels.set(userId, data);
  }

  clearPendingModelEntry(userId: number): void {
    this.pendingModels.delete(userId);
  }

  // Cleanup
  cleanup(): void {
    logger.debug('StateManager cleanup', {
      pinnedMessages: this.pinnedMessages.size,
      pendingRepoCreations: this.pendingRepoCreations.size,
      pendingNewRepoNames: this.pendingNewRepoNames.size,
      pendingApiKeys: this.pendingApiKeys.size,
      pendingModels: this.pendingModels.size
    });
  }
}

export const stateManager = new StateManager();
