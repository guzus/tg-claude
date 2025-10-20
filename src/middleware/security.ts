import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Check if user is authorized to use the bot
 */
export function isAuthorized(userId: number): boolean {
  return config.allowedUserIds.includes(userId);
}

/**
 * Middleware to check user authorization
 */
export function authorizationMiddleware(
  msg: TelegramBot.Message,
  next: () => void
): void {
  const userId = msg.from?.id;

  if (!userId) {
    logger.warn('Message received without user ID');
    return;
  }

  if (!isAuthorized(userId)) {
    logger.warn('Unauthorized access attempt', {
      userId,
      username: msg.from?.username,
      chatId: msg.chat.id
    });
    return;
  }

  next();
}

/**
 * Sanitize command input
 */
export function sanitizeInput(input: string): string {
  // Remove dangerous characters that could be used for command injection
  // Allow letters, numbers, spaces, and common punctuation
  return input.replace(/[;&|`$(){}[\]<>]/g, '').trim();
}

/**
 * Validate command arguments
 */
export function validateArgs(args: string[], minArgs: number = 0, maxArgs?: number): boolean {
  if (args.length < minArgs) {
    return false;
  }

  if (maxArgs !== undefined && args.length > maxArgs) {
    return false;
  }

  return true;
}

/**
 * Check if path is within allowed workspace
 */
export function isPathAllowed(targetPath: string): boolean {
  const path = require('path');
  const normalizedWorkspace = path.resolve(config.workspacePath);
  const normalizedTarget = path.resolve(targetPath);

  return normalizedTarget.startsWith(normalizedWorkspace);
}

/**
 * Extract command context from message
 */
export function extractCommandContext(msg: TelegramBot.Message, commandText: string) {
  const userId = msg.from?.id || 0;
  const chatId = msg.chat.id;
  const username = msg.from?.username;
  const args = commandText.trim().split(/\s+/).slice(1);
  const rawCommand = commandText.trim();

  return {
    userId,
    chatId,
    username,
    args,
    rawCommand
  };
}
