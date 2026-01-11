import { BotConfig } from '../types';

// Executor type: 'sdk' uses Anthropic SDK directly, 'cli' uses Claude Code CLI
export type ExecutorType = 'sdk' | 'cli';
export const EXECUTOR_TYPE: ExecutorType = (process.env.EXECUTOR_TYPE as ExecutorType) || 'sdk';

// Service enable flags - set to 'false' to disable
const parseBool = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() !== 'false' && value !== '0';
};

export const ENABLE_TELEGRAM = parseBool(process.env.ENABLE_TELEGRAM, true);
export const ENABLE_DISCORD = parseBool(process.env.ENABLE_DISCORD, true);
export const ENABLE_API = parseBool(process.env.ENABLE_API, true);

// Paths - configurable via env vars for Railway single-volume setup
// Railway: Set DATA_PATH=/persistent to use single volume
// Local: Uses ./data directory when DATA_PATH is not set
const DATA_PATH = process.env.DATA_PATH || './data';
export const WORKSPACE_PATH = process.env.WORKSPACE_PATH || `${DATA_PATH}/workspace`;
export const CONFIG_PATH = process.env.CONFIG_PATH || `${DATA_PATH}/config`;
export const LOGS_PATH = process.env.LOGS_PATH || `${DATA_PATH}/logs`;
export const STATE_PATH = process.env.STATE_PATH || `${DATA_PATH}/state`;

const parseNumberList = (value?: string): number[] => {
  if (!value) return [];
  return value
    .split(',')
    .map(id => Number(id.trim()))
    .filter(id => Number.isFinite(id));
};

const parseStringList = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
};

export const config: BotConfig = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  githubToken: process.env.GITHUB_TOKEN || '',
  allowedUserIds: parseNumberList(process.env.ALLOWED_USER_IDS),
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
  discordAllowedUserIds: parseStringList(process.env.DISCORD_ALLOWED_USER_IDS)
};

export function validateConfig(): void {
  const errors: string[] = [];

  // Only require Telegram token if Telegram is enabled
  if (ENABLE_TELEGRAM && !config.telegramToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required when ENABLE_TELEGRAM is true');
  }

  // Only require allowed users if Telegram is enabled
  if (ENABLE_TELEGRAM && config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS must contain at least one user ID when ENABLE_TELEGRAM is true');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
