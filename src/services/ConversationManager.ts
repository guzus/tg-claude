import { logger } from '../utils/logger';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface ConversationSession {
  messages: ConversationMessage[];
  repositoryId?: string;
  lastActivity: Date;
}

/**
 * Manages conversation context for each user
 */
export class ConversationManager {
  private conversations: Map<number, ConversationSession> = new Map();
  private readonly MAX_MESSAGES = 20; // Keep last 20 messages
  private readonly SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  /**
   * Add a user message to conversation history
   */
  addUserMessage(userId: number, content: string, repositoryId?: string): void {
    const session = this.getOrCreateSession(userId);

    session.messages.push({
      role: 'user',
      content,
      timestamp: new Date()
    });

    if (repositoryId) {
      session.repositoryId = repositoryId;
    }

    session.lastActivity = new Date();
    this.trimMessages(session);

    logger.debug('Added user message to conversation', {
      userId,
      messageCount: session.messages.length
    });
  }

  /**
   * Add an assistant message to conversation history
   */
  addAssistantMessage(userId: number, content: string): void {
    const session = this.getOrCreateSession(userId);

    session.messages.push({
      role: 'assistant',
      content,
      timestamp: new Date()
    });

    session.lastActivity = new Date();
    this.trimMessages(session);

    logger.debug('Added assistant message to conversation', {
      userId,
      messageCount: session.messages.length
    });
  }

  /**
   * Get conversation context for AI prompt
   */
  getContext(userId: number): string {
    const session = this.conversations.get(userId);

    if (!session || session.messages.length === 0) {
      return '';
    }

    // Format conversation history for Claude
    const contextMessages = session.messages
      .slice(-10) // Last 10 messages for context
      .map(msg => {
        const role = msg.role === 'user' ? 'User' : 'Assistant';
        return `${role}: ${msg.content}`;
      })
      .join('\n\n');

    return contextMessages;
  }

  /**
   * Get conversation history as structured data
   */
  getHistory(userId: number): ConversationMessage[] {
    const session = this.conversations.get(userId);
    return session?.messages || [];
  }

  /**
   * Clear conversation history for a user
   */
  clearHistory(userId: number): void {
    this.conversations.delete(userId);
    logger.info('Cleared conversation history', { userId });
  }

  /**
   * Get or create a conversation session
   */
  private getOrCreateSession(userId: number): ConversationSession {
    let session = this.conversations.get(userId);

    if (!session) {
      session = {
        messages: [],
        lastActivity: new Date()
      };
      this.conversations.set(userId, session);
    }

    return session;
  }

  /**
   * Trim messages to keep only recent ones
   */
  private trimMessages(session: ConversationSession): void {
    if (session.messages.length > this.MAX_MESSAGES) {
      session.messages = session.messages.slice(-this.MAX_MESSAGES);
    }
  }

  /**
   * Clean up old conversations
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [userId, session] of this.conversations.entries()) {
      const timeSinceActivity = now - session.lastActivity.getTime();

      if (timeSinceActivity > this.SESSION_TIMEOUT) {
        this.conversations.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up old conversations', { count: cleaned });
    }

    return cleaned;
  }

  /**
   * Get stats about conversations
   */
  getStats(): {
    activeConversations: number;
    totalMessages: number;
  } {
    const activeConversations = this.conversations.size;
    const totalMessages = Array.from(this.conversations.values())
      .reduce((sum, session) => sum + session.messages.length, 0);

    return {
      activeConversations,
      totalMessages
    };
  }
}
