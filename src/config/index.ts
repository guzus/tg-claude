import { BotConfig } from '../types';

// Paths - configurable via env vars for Railway single-volume setup
// Railway: Set DATA_PATH=/persistent to use single volume
const DATA_PATH = process.env.DATA_PATH || '';
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH || `${DATA_PATH}/workspace`.replace(/^\/+/, '/');
export const CONFIG_PATH = process.env.CONFIG_PATH || `${DATA_PATH}/app/config`.replace(/^\/+/, '/');
export const LOGS_PATH = process.env.LOGS_PATH || `${DATA_PATH}/app/logs`.replace(/^\/+/, '/');
export const STATE_PATH = process.env.STATE_PATH || `${DATA_PATH}/app/data`.replace(/^\/+/, '/');

export const config: BotConfig = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  allowedUserIds: process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()))
    : [],
  maxConcurrentTasks: 10,
  taskTimeoutMs: 1800000, // 30 minutes
  maxOutputSize: 4096,
  logLevel: 'info',
  logFile: `${LOGS_PATH}/bot.log`,
  maxRequestsPerUserPerHour: 100,
  maxRequestsPerUserPerDay: 500,
  // Discord configuration
  discordToken: process.env.DISCORD_BOT_TOKEN || '',
  discordClientId: process.env.DISCORD_CLIENT_ID || '',
  discordGuildId: process.env.DISCORD_GUILD_ID || '',
  discordAllowedUserIds: process.env.DISCORD_ALLOWED_USER_IDS
    ? process.env.DISCORD_ALLOWED_USER_IDS.split(',').map(id => id.trim())
    : []
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.telegramToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  if (config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS must contain at least one user ID');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
