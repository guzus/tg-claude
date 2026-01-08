import { execSync } from 'child_process';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

/**
 * Claude Code plugin marketplace helpers.
 *
 * Some plugins (e.g. official/community) require adding a marketplace first, e.g.:
 *   claude plugin marketplace add anthropics/claude-plugins-official
 */

export const DEFAULT_PLUGIN_MARKETPLACES: string[] = [
  'anthropics/claude-plugins-official'
];

function execClaude(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: 'utf-8',
    timeout: 60000,
    stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}

export function ensureDefaultPluginMarketplaces(cwd?: string): void {
  for (const source of DEFAULT_PLUGIN_MARKETPLACES) {
    ensurePluginMarketplace(source, cwd);
  }
}

export function ensurePluginMarketplace(source: string, cwd?: string): void {
  const shortName = source.split('/').pop() || source;

  try {
    const listOut = execClaude('claude plugin marketplace list', cwd);
    if (listOut.includes(source) || listOut.includes(shortName)) {
      return;
    }
  } catch (error) {
    // If list fails (older CLI?), we'll just try to add.
    logger.debug('Could not list plugin marketplaces', {
      cwd,
      error: getErrorMessage(error)
    });
  }

  try {
    execClaude(`claude plugin marketplace add ${source}`, cwd);
    logger.info('Added Claude plugin marketplace', { source, cwd });
  } catch (error) {
    // Don't hard-fail boot or tasks if marketplace add fails.
    logger.warn('Failed to add Claude plugin marketplace', {
      source,
      cwd,
      error: getErrorMessage(error)
    });
  }
}

