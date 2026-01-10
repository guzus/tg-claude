import { ClaudeExecutorInstance } from './IClaudeExecutor';
import { ClaudeExecutor } from './ClaudeExecutor';
import { AnthropicSdkExecutor } from './AnthropicSdkExecutor';
import { CodexSdkExecutor } from './CodexSdkExecutor';
import { EXECUTOR_TYPE, ExecutorType } from '../config';
import { logger } from '../utils/logger';

/**
 * Factory function to create the appropriate executor based on configuration.
 *
 * @param type - Override the executor type (defaults to EXECUTOR_TYPE from config)
 * @param apiKey - API key for SDK executor (optional, uses env var if not provided)
 * @returns A ClaudeExecutor or AnthropicSdkExecutor instance
 */
export function createExecutor(
  type: ExecutorType = EXECUTOR_TYPE,
  apiKey?: string
): ClaudeExecutorInstance {
  logger.info('Creating executor', { type });

  if (type === 'sdk') {
    return new AnthropicSdkExecutor(apiKey);
  }

  if (type === 'codex') {
    return new CodexSdkExecutor(apiKey);
  }

  // CLI mode is deprecated - warn but still allow
  logger.warn('CLI executor is deprecated and not maintained. Consider using SDK mode (EXECUTOR_TYPE=sdk)');
  return new ClaudeExecutor();
}

/**
 * Default executor instance using the configured type
 */
export const defaultExecutor = createExecutor();
