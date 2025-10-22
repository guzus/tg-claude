import dotenv from 'dotenv';
import { BotConfig } from '../types';

dotenv.config();

export const config: BotConfig = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  claudeApiKey: process.env.CLAUDE_API_KEY || '',
  allowedUserIds: process.env.ALLOWED_USER_IDS
    ? process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id.trim()))
    : [],
  workspacePath: process.env.WORKSPACE_PATH || process.cwd(),
  maxConcurrentTasks: parseInt(process.env.MAX_CONCURRENT_TASKS || '3'),
  taskTimeoutMs: parseInt(process.env.TASK_TIMEOUT_MS || '1800000'), // 30 minutes
  maxOutputSize: parseInt(process.env.MAX_OUTPUT_SIZE || '4096'),
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || './logs/bot.log',
  maxRequestsPerUserPerHour: parseInt(process.env.MAX_REQUESTS_PER_USER_PER_HOUR || '20'),
  maxRequestsPerUserPerDay: parseInt(process.env.MAX_REQUESTS_PER_USER_PER_DAY || '100')
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.telegramToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  // Claude API key is optional - Claude CLI can use its own authentication
  if (!config.claudeApiKey) {
    console.log('⚠️  CLAUDE_API_KEY not set - Claude CLI will use its own authentication');
  }

  if (config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS must contain at least one user ID');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
