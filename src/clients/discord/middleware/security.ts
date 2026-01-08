import { config } from '../../../config';

/**
 * Check if a Discord user is authorized to use the bot.
 * If DISCORD_ALLOWED_USER_IDS is not set, all users are allowed.
 */
export function isDiscordAuthorized(userId: string): boolean {
  // If no allowlist configured, allow all users
  if (!config.discordAllowedUserIds || config.discordAllowedUserIds.length === 0) {
    return true;
  }
  return config.discordAllowedUserIds.includes(userId);
}
