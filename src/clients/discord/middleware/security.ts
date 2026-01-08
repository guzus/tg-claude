import { config } from '../../../config';

/**
 * Check if a Discord user is authorized to use the bot
 */
export function isDiscordAuthorized(userId: string): boolean {
  return config.discordAllowedUserIds?.includes(userId) ?? false;
}
