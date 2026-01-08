/**
 * Base types for client abstraction layer.
 * These types allow different chat clients (Telegram, Discord, etc.) to integrate
 * with the core services through a unified interface.
 */

/**
 * Represents a user across any client platform
 */
export interface ClientUser {
  id: string | number;
  username?: string;
  displayName?: string;
}

/**
 * Represents a message from any client platform
 */
export interface ClientMessage {
  id: string | number;
  chatId: string | number;
  user: ClientUser;
  text?: string;
  replyToMessageId?: string | number;
  timestamp: Date;
}

/**
 * Options for sending messages
 */
export interface SendMessageOptions {
  parseMode?: 'Markdown' | 'HTML' | 'plain';
  disablePreview?: boolean;
  replyToMessageId?: string | number;
  keyboard?: ClientKeyboard;
}

/**
 * Options for editing messages
 */
export interface EditMessageOptions {
  parseMode?: 'Markdown' | 'HTML' | 'plain';
  disablePreview?: boolean;
  keyboard?: ClientKeyboard;
}

/**
 * Keyboard button for interactive elements
 */
export interface ClientKeyboardButton {
  text: string;
  callbackData?: string;
  url?: string;
}

/**
 * Keyboard layout for interactive messages
 */
export interface ClientKeyboard {
  inline: boolean;
  buttons: ClientKeyboardButton[][];
}

/**
 * Callback query from interactive elements
 */
export interface ClientCallbackQuery {
  id: string;
  user: ClientUser;
  chatId: string | number;
  messageId: string | number;
  data?: string;
}

/**
 * Result of sending a message
 */
export interface SentMessage {
  id: string | number;
  chatId: string | number;
}

/**
 * Abstract client interface that all platform clients must implement
 */
export interface IClient {
  /**
   * Send a text message to a chat
   */
  sendMessage(
    chatId: string | number,
    text: string,
    options?: SendMessageOptions
  ): Promise<SentMessage>;

  /**
   * Edit an existing message
   */
  editMessage(
    chatId: string | number,
    messageId: string | number,
    text: string,
    options?: EditMessageOptions
  ): Promise<void>;

  /**
   * Delete a message
   */
  deleteMessage(chatId: string | number, messageId: string | number): Promise<void>;

  /**
   * Answer a callback query (acknowledge button press)
   */
  answerCallbackQuery(queryId: string, options?: { text?: string; showAlert?: boolean }): Promise<void>;

  /**
   * Pin a message in a chat
   */
  pinMessage(chatId: string | number, messageId: string | number, silent?: boolean): Promise<void>;

  /**
   * Get information about a chat
   */
  getChatInfo(chatId: string | number): Promise<{ pinnedMessage?: ClientMessage }>;

  /**
   * Start the client (polling, websocket, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop the client gracefully
   */
  stop(): Promise<void>;

  /**
   * Register a handler for text commands
   */
  onCommand(pattern: RegExp, handler: (msg: ClientMessage, match: RegExpMatchArray | null) => void): void;

  /**
   * Register a handler for callback queries
   */
  onCallbackQuery(handler: (query: ClientCallbackQuery) => void): void;

  /**
   * Register a handler for plain text messages
   */
  onMessage(handler: (msg: ClientMessage) => void): void;

  /**
   * Get the platform name (e.g., 'telegram', 'discord')
   */
  getPlatform(): string;
}

/**
 * Configuration for client initialization
 */
export interface ClientConfig {
  /** Platform-specific token/credentials */
  token: string;
  /** Allowed user IDs for this client */
  allowedUserIds: (string | number)[];
  /** Additional platform-specific options */
  options?: Record<string, unknown>;
}
