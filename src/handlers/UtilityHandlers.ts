import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';

/**
 * Handlers for utility and diagnostic commands
 */
export class UtilityHandlers extends BaseHandler {
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
      `🛠️ *Development:*\n` +
      `/task <description> - Execute a task\n` +
      `/commit <message> - Commit and push changes\n` +
      `/read <url> - Read documentation\n` +
      `/review - Review code changes\n` +
      `/test - Run tests\n` +
      `/build - Build project\n\n` +
      `ℹ️ *Status & Help:*\n` +
      `/status - Check active tasks\n` +
      `/cancel <taskId> - Cancel a task\n` +
      `/limits - Check your rate limits\n` +
      `/help - Show this help message\n\n` +
      `💡 *Quick Start:*\n` +
      `1. Use \`/repo clone owner/repo\` to clone a repository\n` +
      `2. Use \`/task <description>\` to execute tasks`;

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
   * /check command - Check Claude CLI installation and setup
   */
  async handleCheck(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    await this.bot.sendMessage(chatId, '🔍 Checking Claude CLI setup...');

    try {
      const { spawn } = require('child_process');

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

              await this.bot.sendMessage(
                chatId,
                '✅ *Claude CLI Status*\n\n' +
                `📍 Path: \`${claudePath.trim()}\`\n` +
                `📦 Version: ${version.trim() || 'Unable to detect'}\n\n` +
                `📁 Current Repo: ${currentRepo ? currentRepo.name : '❌ None (use /repo)'}\n` +
                `📂 Working Dir: ${currentRepo ? '`' + currentRepo.path + '`' : 'N/A'}\n\n` +
                `🔐 API Key: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '⚠️ Using CLI auth'}\n\n` +
                `To test, try:\n\`/task say hello\``,
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

  /**
   * /debug command - Run a simple test to debug Claude CLI
   */
  async handleDebug(msg: Message, taskHandlers: { executeAndStream: (msg: Message, prompt: string) => Promise<void> }): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '⚠️ No active repository! Create one first:\n`/repo new test-debug`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await this.bot.sendMessage(
      chatId,
      '🐛 *Debug Mode - Running Test*\n\n' +
      'Testing Claude CLI directly...\n' +
      `Working directory: \`${currentRepo.path}\`\n\n` +
      'This will test if Claude CLI responds at all.',
      { parse_mode: 'Markdown' }
    );

    // Try running claude with --version first to see if it responds
    const { spawn } = require('child_process');
    const versionTest = spawn('claude', ['--version'], { cwd: currentRepo.path });

    let versionOutput = '';
    versionTest.stdout?.on('data', (data: Buffer) => {
      versionOutput += data.toString();
    });

    versionTest.on('close', async (code: number) => {
      if (code === 0 && versionOutput) {
        await this.bot.sendMessage(
          chatId,
          `✅ Claude CLI responds!\n\`\`\`\n${versionOutput}\n\`\`\`\n\nNow testing actual task execution...`,
          { parse_mode: 'Markdown' }
        );

        // Now try a real task
        await taskHandlers.executeAndStream(msg, 'say hello');
      } else {
        await this.bot.sendMessage(
          chatId,
          `❌ Claude CLI not responding properly\n\nExit code: ${code}\nOutput: ${versionOutput || 'none'}\n\nCheck that Claude is installed and authenticated.`
        );
      }
    });
  }

  /**
   * /scan command - Rescan for repositories
   */
  async handleScan(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;

    await this.bot.sendMessage(chatId, '🔍 Scanning for repositories...');

    try {
      const result = await this.repositoryManager.rescan();

      await this.bot.sendMessage(
        chatId,
        `✅ *Repository Scan Complete*\n\n` +
        `👥 Users: ${result.usersFound}\n` +
        `📁 New repositories found: ${result.reposFound}\n\n` +
        `Use \`/repo list\` to see all repositories.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      await this.bot.sendMessage(
        chatId,
        '❌ Scan failed: ' + (error instanceof Error ? error.message : String(error))
      );
    }
  }
}

