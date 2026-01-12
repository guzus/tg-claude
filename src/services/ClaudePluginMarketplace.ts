import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
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

type InstalledPluginIndex = {
  version?: number;
  plugins?: Record<string, Array<{
    scope?: string;
    installPath?: string;
    version?: string;
    installedAt?: string;
    lastUpdated?: string;
  }>>;
};

export function getInstalledPluginPath(pluginSpec: string, homeDir: string = process.env.HOME || ''): string | null {
  if (!homeDir) return null;
  const indexPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(indexPath)) return null;

  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(raw) as InstalledPluginIndex;
    const entries = index.plugins?.[pluginSpec];
    if (!entries || entries.length === 0) return null;

    const latest = entries[entries.length - 1];
    const installPath = latest.installPath;
    if (!installPath || !fs.existsSync(installPath)) return null;
    return installPath;
  } catch (error) {
    logger.warn('Failed to read installed plugins index', {
      pluginSpec,
      indexPath,
      error: getErrorMessage(error)
    });
    return null;
  }
}

export type InstalledPluginEntry = {
  id: string;
  scope?: string;
  version?: string;
  installedAt?: string;
  installPath?: string;
};

/**
 * Install a plugin if not already installed
 * @param pluginSpec - Plugin specification in format "name@registry"
 * @param cwd - Working directory for the command
 * @returns true if plugin was installed or already exists, false on failure
 */
export function ensurePluginInstalled(pluginSpec: string, cwd?: string): boolean {
  // Check if already installed
  if (getInstalledPluginPath(pluginSpec)) {
    logger.debug('Plugin already installed', { pluginSpec });
    return true;
  }

  try {
    execClaude(`claude plugin install ${pluginSpec}`, cwd);
    logger.info('Installed Claude plugin', { pluginSpec, cwd });
    return true;
  } catch (error) {
    logger.warn('Failed to install Claude plugin', {
      pluginSpec,
      cwd,
      error: getErrorMessage(error)
    });
    return false;
  }
}

/**
 * Ensure all required plugins are installed
 * Called at startup to pre-install plugins
 */
export function ensureRequiredPlugins(cwd?: string): void {
  // First ensure marketplaces are added
  ensureDefaultPluginMarketplaces(cwd);

  // Install ralph-loop plugin (required for /ralph-loop command)
  ensurePluginInstalled('ralph-loop@claude-plugins-official', cwd);

  // Install other default plugins
  ensurePluginInstalled('commit-commands@claude-plugins-official', cwd);
  ensurePluginInstalled('github@claude-plugins-official', cwd);
  ensurePluginInstalled('frontend-design@claude-plugins-official', cwd);
}

export function listInstalledPlugins(homeDir: string = process.env.HOME || ''): InstalledPluginEntry[] {
  if (!homeDir) return [];
  const indexPath = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  if (!fs.existsSync(indexPath)) return [];

  try {
    const raw = fs.readFileSync(indexPath, 'utf-8');
    const index = JSON.parse(raw) as InstalledPluginIndex;
    const plugins = index.plugins || {};

    const entries: InstalledPluginEntry[] = [];
    for (const [id, installs] of Object.entries(plugins)) {
      for (const install of installs || []) {
        entries.push({
          id,
          scope: install.scope,
          version: install.version,
          installedAt: install.installedAt,
          installPath: install.installPath,
        });
      }
    }

    return entries;
  } catch (error) {
    logger.warn('Failed to read installed plugins list', {
      indexPath,
      error: getErrorMessage(error)
    });
    return [];
  }
}
