import { config } from '../config';

/**
 * Check if user is authorized to use the bot
 */
export function isAuthorized(userId: number): boolean {
  return config.allowedUserIds.includes(userId);
}
