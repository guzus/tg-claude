import { Message } from 'node-telegram-bot-api';
import { spawn, execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';
import { config } from '../config';

/**
 * Handlers for utility and diagnostic commands
 */
export class UtilityHandlers extends BaseHandler {
  /**
   * /version command - Show bot commit hash
   */
  async handleVersion(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;

    try {
      let commitHash: string;

      // Try reading from VERSION file (Docker build), fallback to git
      const versionPaths = ['/app/dist/VERSION', join(__dirname, 'VERSION')];
      const versionFile = versionPaths.find(p => existsSync(p));
      if (versionFile) {
        commitHash = readFileSync(versionFile, 'utf-8').trim();
      } else {
        commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      }

      const shortHash = commitHash.substring(0, 8);

      await this.bot.sendMessage(
        chatId,
        `🤖 *tg-claude*\n\n` +
        `Commit: \`${shortHash}\`\n` +
        `Full: \`${commitHash}\``,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await this.bot.sendMessage(chatId, '❌ Unable to get version info');
    }
  }

  /**
   * /start command
   */
  async handleStart(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const username = msg.from?.first_name || 'there';

    // Get current repository
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    // Send welcome message with main menu
    const welcomeMessage =
      `👋 Hello ${username}!\n\n` +
      `🤖 *Claude Code Remote Control Bot*\n\n` +
      `Available commands:\n\n` +
      `📁 *Repository Management:*\n` +
      `/repo - Manage repositories (clone/new/list/switch)\n\n` +
      `ℹ️ *Status & Help:*\n` +
      `/status - Check active tasks\n` +
      `/cancel <taskId> - Cancel a task\n` +
      `/limits - Check your rate limits\n` +
      `/help - Show this help message\n\n` +
      `💡 *Quick Start:*\n` +
      `1. Use \`/repo clone owner/repo\` to clone a repository\n` +
      `2. Send a plain message to start working on it\n` +
      `   Example: \`add error handling to the API\``;

    const mainMenuKeyboard = UIHelpers.createMainMenuKeyboard(currentRepo !== null);

    await this.bot.sendMessage(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: mainMenuKeyboard
    });

    // Send repository dashboard as a separate message
    const { message: repoMessage, keyboard: repoKeyboard } = UIHelpers.createRepositoryDashboard(currentRepo || null);

    await this.bot.sendMessage(chatId, repoMessage, {
      parse_mode: 'Markdown',
      reply_markup: repoKeyboard
    });
  }

  /**
   * /help command
   */
  async handleHelp(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;
    await this.handleStart(msg);
  }

  /**
   * /limits command - Show remaining rate limit quota
   */
  async handleLimits(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const remaining = this.rateLimiter.getRemainingRequests(userId);

    await this.bot.sendMessage(
      chatId,
      `⚙️ *Rate Limits*\n\n` +
      `Hourly: *${remaining.hourly}* remaining (max ${config.maxRequestsPerUserPerHour}/hr)\n` +
      `Daily: *${remaining.daily}* remaining (max ${config.maxRequestsPerUserPerDay}/day)\n\n` +
      `Tip: heavy usage? consider /beast for fewer back-and-forth messages.`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * /cancel command - Cancel an active task by ID prefix
   */
  async handleCancel(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const arg = match?.[1]?.trim();

    if (!arg) {
      await this.bot.sendMessage(
        chatId,
        `❌ Usage: \`/cancel <taskId>\`\n\n` +
        `Use /status to see active task IDs (first 8 chars).`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const prefix = arg.replace(/^#/, '').trim();
    const activeTasks = this.executor.getActiveTasksForUser(userId);
    const task = activeTasks.find(t => t.id.startsWith(prefix)) || activeTasks.find(t => t.id.substring(0, 8) === prefix);

    if (!task) {
      await this.bot.sendMessage(
        chatId,
        `❌ No active task found for \`${UIHelpers.escapeMarkdown(prefix)}\`.\n\nUse /status to list running tasks.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const cancelled = this.executor.cancelTask(task.id);
    if (!cancelled) {
      await this.bot.sendMessage(chatId, '❌ Failed to cancel. Task may have completed.');
      return;
    }

    const duration = UIHelpers.formatDuration(Math.round((Date.now() - task.startTime.getTime()) / 1000));
    await this.bot.sendMessage(
      chatId,
      `🛑 *Cancelled*\n\nID: \`${task.id.substring(0, 8)}\`\nTime: ${duration}`,
      { parse_mode: 'Markdown' }
    );
  }

  /**
   * /check command - Check Claude CLI installation and setup
   */
  async handleCheck(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    await this.bot.sendMessage(chatId, '🔍 Checking Claude CLI setup...');

    try {
      // Check if claude command exists
      const whichClaude = spawn('which', ['claude']);
      let claudePath = '';

      whichClaude.stdout?.on('data', (data: Buffer) => {
        claudePath += data.toString();
      });

      await new Promise((resolve) => {
        whichClaude.on('close', async (code: number) => {
          if (code !== 0 || !claudePath.trim()) {
            await this.bot.sendMessage(
              chatId,
              '❌ *Claude CLI not found*\n\n' +
              'Please install it first:\n' +
              '```bash\n' +
              'npm install -g @anthropic-ai/claude-code\n' +
              '# or\n' +
              'curl -fsSL https://claude.ai/install.sh | sh\n' +
              '```\n\n' +
              'Then authenticate:\n' +
              '```bash\nclaude login\n```',
              { parse_mode: 'Markdown' }
            );
          } else {
            // Check version
            const versionCheck = spawn('claude', ['--version']);
            let version = '';

            versionCheck.stdout?.on('data', (data: Buffer) => {
              version += data.toString();
            });

            versionCheck.on('close', async () => {
              const currentRepo = this.repositoryManager.getCurrentRepository(userId);

              // Check auth via environment variables
              const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
              const hasOpenRouterKey = !!process.env.OPENROUTER_API_KEY;
              const hasAuthToken = !!process.env.ANTHROPIC_AUTH_TOKEN;
              const hasOAuthToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
              const aiProvider = process.env.AI_PROVIDER || 'anthropic';

              let authStatus: string;
              if (hasAnthropicKey || hasOpenRouterKey || hasAuthToken || hasOAuthToken) {
                const provider = aiProvider === 'openrouter' ? 'OpenRouter' :
                  aiProvider === 'glm' ? 'GLM' :
                    hasOAuthToken ? 'OAuth' : 'Anthropic';
                authStatus = `✅ Configured (${provider})`;
              } else {
                authStatus = '❌ No API key configured\nSet ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or CLAUDE_CODE_OAUTH_TOKEN';
              }

              await this.bot.sendMessage(
                chatId,
                '✅ *Claude CLI Status*\n\n' +
                `📍 Path: \`${claudePath.trim()}\`\n` +
                `📦 Version: ${version.trim() || 'Unable to detect'}\n\n` +
                `🔐 *Auth Status:*\n${authStatus}\n\n` +
                `📁 Current Repo: ${currentRepo ? currentRepo.name : '❌ None (use /repo)'}\n` +
                `📂 Working Dir: ${currentRepo ? '`' + currentRepo.path + '`' : 'N/A'}`,
                { parse_mode: 'Markdown' }
              );
            });
          }
          resolve(null);
        });
      });
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        '❌ Error checking setup: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  }

}

