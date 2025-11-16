import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export interface BotDeploymentConfig {
  name: string;
  dockerImage: string;
  token?: string;
  cpu?: number;
  memory?: number;
  useVault?: boolean;
  envVars?: Record<string, string>;
}

export interface BotStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'pending' | 'failed' | 'unknown';
  running?: number;
  desired?: number;
}

export interface BotInfo {
  name: string;
  path: string;
  type: 'typescript' | 'python';
  dockerImage?: string;
}

/**
 * Service for managing bots via Mothership CLI
 * Wraps mothership commands for bot lifecycle management on Nomad
 */
export class MothershipService {
  private mothershipPath: string;
  private botsDirectory: string;

  constructor(botsDirectory?: string, mothershipPath?: string) {
    this.mothershipPath = mothershipPath || 'mothership';
    this.botsDirectory = botsDirectory || path.join(process.cwd(), 'bots');

    // Ensure bots directory exists
    if (!fs.existsSync(this.botsDirectory)) {
      fs.mkdirSync(this.botsDirectory, { recursive: true });
      logger.info('Created bots directory', { path: this.botsDirectory });
    }
  }

  /**
   * Check if mothership CLI is available
   */
  async checkMothershipCli(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`${this.mothershipPath} --version`);
      logger.info('Mothership CLI detected', { version: stdout.trim() });
      return true;
    } catch (error) {
      logger.error('Mothership CLI not found', { error });
      return false;
    }
  }

  /**
   * Check Nomad connection
   */
  async checkNomad(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('nomad version');
      logger.info('Nomad detected', { version: stdout.trim() });
      return true;
    } catch (error) {
      logger.error('Nomad not found', { error });
      return false;
    }
  }

  /**
   * Create a new bot using mothership CLI
   */
  async createBot(name: string, language: 'typescript' | 'python' = 'typescript'): Promise<string> {
    try {
      logger.info('Creating new bot', { name, language });

      // mothership create command with auto-confirmation
      const createCommand = `cd ${this.botsDirectory} && echo "${language === 'typescript' ? '1' : '2'}" | ${this.mothershipPath} create ${name}`;

      const { stdout } = await execAsync(createCommand, {
        timeout: 30000 // 30 seconds
      });

      const botPath = path.join(this.botsDirectory, name);

      logger.info('Bot created successfully', {
        name,
        path: botPath,
        output: stdout
      });

      return botPath;
    } catch (error) {
      logger.error('Failed to create bot', {
        name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to create bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Deploy a bot to Nomad
   */
  async deployBot(config: BotDeploymentConfig): Promise<string> {
    try {
      logger.info('Deploying bot to Nomad', { config });

      const botPath = path.join(this.botsDirectory, config.name);

      if (!fs.existsSync(botPath)) {
        throw new Error(`Bot directory not found: ${botPath}`);
      }

      // Build deploy command
      let deployCommand = `${this.mothershipPath} deploy ${config.name}`;
      deployCommand += ` --path ${botPath}`;
      deployCommand += ` --docker-image ${config.dockerImage}`;

      if (config.cpu) {
        deployCommand += ` --cpu ${config.cpu}`;
      }

      if (config.memory) {
        deployCommand += ` --memory ${config.memory}`;
      }

      if (config.useVault) {
        deployCommand += ` --use-vault`;
      } else if (config.token) {
        deployCommand += ` --token "${config.token}"`;
      }

      const { stdout } = await execAsync(deployCommand, {
        timeout: 60000 // 60 seconds
      });

      logger.info('Bot deployed successfully', {
        name: config.name,
        output: stdout
      });

      return stdout;
    } catch (error) {
      logger.error('Failed to deploy bot', {
        name: config.name,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Failed to deploy bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List all deployed bots
   */
  async listBots(): Promise<BotStatus[]> {
    try {
      const { stdout } = await execAsync(`${this.mothershipPath} list`);

      // Parse mothership list output
      const bots: BotStatus[] = [];
      const lines = stdout.split('\n');

      // Find the table section (after the header)
      let inTable = false;
      for (const line of lines) {
        if (line.includes('Job ID')) {
          inTable = true;
          continue;
        }

        if (inTable && line.trim() && !line.includes('─')) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3) {
            bots.push({
              id: parts[0],
              name: parts[0].replace('mothership-bot-', ''),
              status: parts[1] === 'running' ? 'running' : 'stopped',
              running: parseInt(parts[2]) || 0,
              desired: parseInt(parts[3]) || 0
            });
          }
        }
      }

      logger.info('Listed bots', { count: bots.length });
      return bots;
    } catch (error) {
      logger.error('Failed to list bots', { error });
      return [];
    }
  }

  /**
   * Get bot status
   */
  async getBotStatus(name: string): Promise<BotStatus | null> {
    try {
      const { stdout } = await execAsync(`${this.mothershipPath} status ${name}`);

      // Parse status output
      const status: BotStatus = {
        id: name,
        name: name,
        status: 'unknown'
      };

      if (stdout.includes('running') || stdout.includes('healthy')) {
        status.status = 'running';
      } else if (stdout.includes('stopped') || stdout.includes('dead')) {
        status.status = 'stopped';
      } else if (stdout.includes('pending')) {
        status.status = 'pending';
      } else if (stdout.includes('failed')) {
        status.status = 'failed';
      }

      logger.info('Retrieved bot status', { name, status: status.status });
      return status;
    } catch (error) {
      logger.error('Failed to get bot status', { name, error });
      return null;
    }
  }

  /**
   * Get bot logs
   */
  async getBotLogs(name: string, tail: number = 50, follow: boolean = false): Promise<string> {
    try {
      let logsCommand = `${this.mothershipPath} logs ${name} --tail ${tail}`;

      if (follow) {
        logsCommand += ' --follow';
      }

      const { stdout } = await execAsync(logsCommand, {
        timeout: follow ? 0 : 30000 // No timeout for follow mode
      });

      logger.info('Retrieved bot logs', { name, lines: tail });
      return stdout;
    } catch (error) {
      logger.error('Failed to get bot logs', { name, error });
      throw new Error(`Failed to get logs: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Stop a bot
   */
  async stopBot(name: string, purge: boolean = false): Promise<string> {
    try {
      let stopCommand = `${this.mothershipPath} stop ${name}`;

      if (purge) {
        stopCommand += ' --purge';
      }

      const { stdout } = await execAsync(stopCommand, {
        timeout: 30000
      });

      logger.info('Stopped bot', { name, purge });
      return stdout;
    } catch (error) {
      logger.error('Failed to stop bot', { name, error });
      throw new Error(`Failed to stop bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Store secret in Vault
   */
  async setVaultSecret(key: string, value: string, botName?: string): Promise<void> {
    try {
      let vaultCommand = `${this.mothershipPath} vault:set ${key}="${value}"`;

      if (botName) {
        vaultCommand += ` --bot ${botName}`;
      }

      await execAsync(vaultCommand, {
        timeout: 10000
      });

      logger.info('Set Vault secret', { key, botName });
    } catch (error) {
      logger.error('Failed to set Vault secret', { key, error });
      throw new Error(`Failed to set Vault secret: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get bot information from local filesystem
   */
  async getBotInfo(name: string): Promise<BotInfo | null> {
    try {
      const botPath = path.join(this.botsDirectory, name);

      if (!fs.existsSync(botPath)) {
        return null;
      }

      // Detect bot type
      const isPython = fs.existsSync(path.join(botPath, '__init__.py')) ||
                       fs.existsSync(path.join(botPath, 'bot.py'));

      const type: 'typescript' | 'python' = isPython ? 'python' : 'typescript';

      return {
        name,
        path: botPath,
        type
      };
    } catch (error) {
      logger.error('Failed to get bot info', { name, error });
      return null;
    }
  }

  /**
   * List local bots (from filesystem)
   */
  async listLocalBots(): Promise<BotInfo[]> {
    try {
      const entries = fs.readdirSync(this.botsDirectory, { withFileTypes: true });
      const bots: BotInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const info = await this.getBotInfo(entry.name);
          if (info) {
            bots.push(info);
          }
        }
      }

      logger.info('Listed local bots', { count: bots.length });
      return bots;
    } catch (error) {
      logger.error('Failed to list local bots', { error });
      return [];
    }
  }

  /**
   * Build Docker image for a bot
   */
  async buildBotImage(name: string, tag: string = 'latest'): Promise<string> {
    try {
      const botPath = path.join(this.botsDirectory, name);

      if (!fs.existsSync(botPath)) {
        throw new Error(`Bot directory not found: ${botPath}`);
      }

      const imageName = `${name}:${tag}`;
      const buildCommand = `cd ${botPath} && docker build -t ${imageName} .`;

      logger.info('Building Docker image', { name, imageName });

      await execAsync(buildCommand, {
        timeout: 300000, // 5 minutes
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });

      logger.info('Docker image built successfully', { name, imageName });
      return imageName;
    } catch (error) {
      logger.error('Failed to build Docker image', { name, error });
      throw new Error(`Failed to build Docker image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get bots directory path
   */
  getBotsDirectory(): string {
    return this.botsDirectory;
  }
}
