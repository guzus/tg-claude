import fs from 'fs';
import path from 'path';
import { STATE_PATH } from '../config';
import { logger } from '../utils/logger';

const SESSION_STATE_FILE = path.join(STATE_PATH, 'sessions.json');

/**
 * Persists chat session IDs to disk for conversation continuity across restarts.
 * Maps chatId -> sessionId (Claude Agent SDK session identifier)
 */
export class SessionStore {
  private sessions: Map<number, string> = new Map();
  private writeChain: Promise<void> = Promise.resolve();

  constructor() {
    this.ensureStateDir();
    this.loadFromDisk();
  }

  getSession(chatId: number): string | undefined {
    return this.sessions.get(chatId);
  }

  setSession(chatId: number, sessionId: string): void {
    this.sessions.set(chatId, sessionId);
    this.queueWrite();
  }

  clearSession(chatId: number): boolean {
    if (!this.sessions.has(chatId)) return false;
    this.sessions.delete(chatId);
    this.queueWrite();
    return true;
  }

  getAllSessions(): Map<number, string> {
    return new Map(this.sessions);
  }

  private ensureStateDir(): void {
    try {
      if (!fs.existsSync(STATE_PATH)) {
        fs.mkdirSync(STATE_PATH, { recursive: true });
      }
    } catch (error) {
      logger.warn('Failed to ensure session state directory', { error });
    }
  }

  private loadFromDisk(): void {
    if (!fs.existsSync(SESSION_STATE_FILE)) return;
    try {
      const raw = fs.readFileSync(SESSION_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as { sessions?: Array<{ chatId: number; sessionId: string }> };
      if (parsed.sessions) {
        for (const { chatId, sessionId } of parsed.sessions) {
          if (chatId && sessionId) {
            this.sessions.set(chatId, sessionId);
          }
        }
        logger.info('Loaded chat sessions from disk', { count: this.sessions.size });
      }
    } catch (error) {
      logger.warn('Failed to load session state', { error });
    }
  }

  private queueWrite(): void {
    const sessions = Array.from(this.sessions.entries()).map(([chatId, sessionId]) => ({
      chatId,
      sessionId,
    }));
    const payload = { sessions };
    this.writeChain = this.writeChain
      .then(() => fs.promises.writeFile(SESSION_STATE_FILE, JSON.stringify(payload, null, 2), 'utf-8'))
      .catch((error) => {
        logger.warn('Failed to persist session state', { error });
      });
  }
}
