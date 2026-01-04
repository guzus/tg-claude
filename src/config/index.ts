import { BotConfig } from '../types';

// Hardcoded workspace path - mounted via Docker volume
export const WORKSPACE_PATH = '/workspace';

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
  logFile: './logs/bot.log',
  maxRequestsPerUserPerHour: 100,
  maxRequestsPerUserPerDay: 500
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
