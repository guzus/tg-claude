import dotenv from 'dotenv';
import { BotConfig, LLMProvider, LLMProviderConfig } from '../types';

dotenv.config();

// DeepSeek Anthropic-compatible API endpoint
// See: https://api-docs.deepseek.com/guides/anthropic_api
const DEEPSEEK_ANTHROPIC_BASE_URL = 'https://api.deepseek.com/anthropic';

/**
 * Build LLM provider configuration based on environment
 * Priority: LLM_PROVIDER env var > DEEPSEEK_API_KEY presence > CLAUDE_API_KEY
 */
function buildLLMProviderConfig(): LLMProviderConfig | undefined {
  const providerEnv = process.env.LLM_PROVIDER as LLMProvider | undefined;
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY;
  const claudeApiKey = process.env.CLAUDE_API_KEY;

  // Explicit provider selection
  if (providerEnv === 'deepseek' || (!providerEnv && deepseekApiKey)) {
    if (!deepseekApiKey) {
      console.log('⚠️  DeepSeek provider selected but DEEPSEEK_API_KEY not set');
      return undefined;
    }
    return {
      provider: 'deepseek',
      apiKey: deepseekApiKey,
      baseUrl: DEEPSEEK_ANTHROPIC_BASE_URL,
      model: 'deepseek-chat'
    };
  }

  // Default to Anthropic if API key is set
  if (claudeApiKey && !claudeApiKey.includes('your_claude_api_key_here')) {
    return {
      provider: 'anthropic',
      apiKey: claudeApiKey,
      baseUrl: undefined,  // Use default Anthropic URL
      model: undefined     // Use default model
    };
  }

  return undefined;  // No provider configured - CLI will use its own auth
}

export const config: BotConfig = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  claudeApiKey: process.env.CLAUDE_API_KEY || '',  // Legacy support
  githubToken: process.env.GITHUB_TOKEN || '',
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
  maxRequestsPerUserPerDay: parseInt(process.env.MAX_REQUESTS_PER_USER_PER_DAY || '100'),
  llmProvider: buildLLMProviderConfig()
};

export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.telegramToken) {
    errors.push('TELEGRAM_BOT_TOKEN is required');
  }

  // Log LLM provider configuration
  if (config.llmProvider) {
    const { provider, baseUrl } = config.llmProvider;
    console.log(`✓ LLM Provider: ${provider.toUpperCase()}`);
    if (baseUrl) {
      console.log(`  Base URL: ${baseUrl}`);
    }
  } else if (!config.claudeApiKey) {
    console.log('⚠️  No LLM API key set - Claude CLI will use its own authentication');
  }

  if (config.allowedUserIds.length === 0) {
    errors.push('ALLOWED_USER_IDS must contain at least one user ID');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n${errors.join('\n')}`);
  }
}

export default config;
