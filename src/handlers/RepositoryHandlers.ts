import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { RepositoryType } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';

/**
 * Handlers for repository management commands
 */
export class RepositoryHandlers extends BaseHandler {
  /**
   * /repo command - Repository management
   */
  async handleRepo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    if (!subcommand) {
      const repoMenuKeyboard = UIHelpers.createRepoActionMenu();

      await this.bot.sendMessage(
        chatId,
        `📁 *Repository Management*\n\n` +
        `Commands:\n` +
        `/repo clone <owner/repo | git-url> [name] [branch] - Clone a repository\n` +
        `/repo new <name> - Create new repository\n` +
        `/repo add <path> [name] - Add existing repository\n` +
        `/repo list - List all repositories\n` +
        `/repo switch <id> - Switch to repository\n` +
        `/repo current - Show current repository\n` +
        `/repo delete <id> - Delete repository\n\n` +
        `💡 Tip: Use \`/scan\` to discover existing repos\n\n` +
        `Examples:\n` +
        `\`/repo clone guzus/poly-mm\`\n` +
        `\`/repo clone https://github.com/user/repo.git\`\n` +
        `\`/repo new my-project\`\n` +
        `\`/repo list\``,
        {
          parse_mode: 'Markdown',
          reply_markup: repoMenuKeyboard
        }
      );
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'clone':
          await this.handleRepoClone(msg, args.slice(1));
          break;
        case 'new':
          await this.handleRepoNew(msg, args.slice(1));
          break;
        case 'add':
          await this.handleRepoAdd(msg, args.slice(1));
          break;
        case 'list':
          await this.handleRepoList(msg);
          break;
        case 'switch':
          await this.handleRepoSwitch(msg, args.slice(1));
          break;
        case 'current':
          await this.handleRepoCurrent(msg);
          break;
        case 'delete':
          await this.handleRepoDelete(msg, args.slice(1));
          break;
        default:
          await this.bot.sendMessage(
            chatId,
            `❌ Unknown subcommand: ${subcommand}\nUse /repo to see available commands.`
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      logger.error('Repository command failed', {
        userId: msg.from?.id,
        subcommand,
        error: errorMessage
      });
    }
  }

  /**
   * Clone repository
   */
  private async handleRepoClone(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: /repo clone <git-url|owner/repo> [name] [branch]\n\n' +
        'Examples:\n' +
        '• `/repo clone guzus/poly-mm`\n' +
        '• `/repo clone https://github.com/user/repo.git`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let gitUrl = args[0];
    const name = args[1];
    const branch = args[2];

    // Convert owner/repo format to full GitHub URL
    if (!gitUrl.includes('://') && !gitUrl.startsWith('git@')) {
      // Assume format is owner/repo
      if (gitUrl.includes('/')) {
        gitUrl = `https://github.com/${gitUrl}.git`;
        logger.info('Converted short format to GitHub URL', {
          original: args[0],
          converted: gitUrl
        });
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Invalid format. Use either:\n' +
          '• `owner/repo` (e.g., `guzus/poly-mm`)\n' +
          '• Full URL (e.g., `https://github.com/owner/repo.git`)',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    const statusMsg = await this.bot.sendMessage(
      chatId,
      `🔄 Cloning repository...\n\`${gitUrl}\``,
      { parse_mode: 'Markdown' }
    );

    try {
      const repo = await this.repositoryManager.cloneRepository(
        userId,
        gitUrl,
        name,
        branch
      );

      // Update pinned message with new repository
      await this.updatePinnedRepositoryInfo(chatId, userId);

      await this.bot.editMessageText(
        `✅ Repository cloned successfully!\n\n` +
        `📁 Name: ${repo.name}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${repo.path}\`\n` +
        `🌿 Branch: ${repo.branch || 'default'}\n\n` +
        `This repository is now active. Use /task to work on it.`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.editMessageText(`❌ Failed to clone repository:\n${errorMessage}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Create new repository
   */
  private async handleRepoNew(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo new <name>');
      return;
    }

    const name = args[0];

    try {
      const repo = await this.repositoryManager.createRepository(userId, name);

      // Update pinned message with new repository
      await this.updatePinnedRepositoryInfo(chatId, userId);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository created successfully!\n\n` +
        `📁 Name: ${repo.name}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${repo.path}\`\n\n` +
        `This repository is now active. Use /task to work on it.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to create repository:\n${errorMessage}`);
    }
  }

  /**
   * Add existing repository
   */
  private async handleRepoAdd(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo add <path> [name]');
      return;
    }

    const repoPath = args[0];
    const name = args[1];

    try {
      const repo = await this.repositoryManager.addExistingRepository(
        userId,
        repoPath,
        name
      );

      // Update pinned message with new repository
      await this.updatePinnedRepositoryInfo(chatId, userId);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository added successfully!\n\n` +
        `📁 Name: ${repo.name}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${repo.path}\`\n` +
        `${repo.gitUrl ? `🔗 Remote: ${repo.gitUrl}\n` : ''}\n` +
        `This repository is now active. Use /task to work on it.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to add repository:\n${errorMessage}`);
    }
  }

  /**
   * List repositories
   */
  private async handleRepoList(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const repositories = this.repositoryManager.listRepositories(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (repositories.length === 0) {
      const keyboard = UIHelpers.createRepoActionMenu();

      await this.bot.sendMessage(
        chatId,
        `📁 No repositories yet.\n\n` +
        `Use:\n` +
        `• /repo clone <url> to clone a repository\n` +
        `• /repo new <name> to create a new one\n` +
        `• /repo add <path> to add an existing one`,
        { reply_markup: keyboard }
      );
      return;
    }

    const keyboard = UIHelpers.createRepositoryListKeyboard(repositories, currentRepo?.id || null);

    let message = `📁 *Your Repositories (${repositories.length})*\n\n`;

    for (const repo of repositories) {
      const isCurrent = currentRepo?.id === repo.id;
      const typeEmoji =
        repo.type === RepositoryType.CLONED
          ? '📥'
          : repo.type === RepositoryType.NEW
            ? '✨'
            : '📂';

      message +=
        `${isCurrent ? '▶️ ' : ''}${typeEmoji} *${repo.name}*\n` +
        `   ID: \`${repo.id.substring(0, 8)}\`\n` +
        `   Path: \`${repo.path}\`\n`;

      if (repo.gitUrl) {
        message += `   Remote: ${repo.gitUrl}\n`;
      }

      message += `\n`;
    }

    message += `Tap a repository below to switch to it:`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Switch repository
   */
  private async handleRepoSwitch(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo switch <id>');
      return;
    }

    const partialId = args[0];

    // Find repository by partial ID
    const repositories = this.repositoryManager.listRepositories(userId);
    const repo = repositories.find((r) => r.id.startsWith(partialId));

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `❌ Repository not found with ID: ${partialId}\nUse /repo list to see available repositories.`
      );
      return;
    }

    try {
      this.repositoryManager.switchRepository(userId, repo.id);

      await this.bot.sendMessage(
        chatId,
        `✅ Switched to repository: *${repo.name}*\n\n` +
        `📂 Path: \`${repo.path}\`\n` +
        `${repo.gitUrl ? `🔗 Remote: ${repo.gitUrl}\n` : ''}\n` +
        `Use /task to work on this repository.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to switch repository:\n${errorMessage}`);
    }
  }

  /**
   * Show current repository
   */
  private async handleRepoCurrent(msg: Message): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const repo = this.repositoryManager.getCurrentRepository(userId);
    const { message, keyboard } = UIHelpers.createRepositoryDashboard(repo || null);

    if (!repo) {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      return;
    }

    const typeEmoji =
      repo.type === RepositoryType.CLONED
        ? '📥 Cloned'
        : repo.type === RepositoryType.NEW
          ? '✨ New'
          : '📂 Existing';

    // Convert git URL to web URL for display
    const webUrl = UIHelpers.convertGitUrlToWeb(repo.gitUrl);

    await this.bot.sendMessage(
      chatId,
      `▶️ *Current Repository*\n\n` +
      `📁 Name: ${repo.name}\n` +
      `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
      `📂 Path: \`${repo.path}\`\n` +
      `📝 Type: ${typeEmoji}\n` +
      `${webUrl ? `🔗 URL: ${webUrl}\n` : ''}` +
      `${repo.branch ? `🌿 Branch: ${repo.branch}\n` : ''}` +
      `🕒 Last used: ${repo.lastUsed.toLocaleString()}\n\n` +
      `${webUrl ? `💡 Tip: Use /link to quickly get the repository URL` : '⚠️ No remote URL configured'}`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  }

  /**
   * Delete repository
   */
  private async handleRepoDelete(msg: Message, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(chatId, '❌ Usage: /repo delete <id>');
      return;
    }

    const partialId = args[0];

    // Find repository by partial ID
    const repositories = this.repositoryManager.listRepositories(userId);
    const repo = repositories.find((r) => r.id.startsWith(partialId));

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `❌ Repository not found with ID: ${partialId}\nUse /repo list to see available repositories.`
      );
      return;
    }

    try {
      await this.repositoryManager.deleteRepository(userId, repo.id);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository deleted: *${repo.name}*\n\n` +
        `${repo.type !== RepositoryType.EXISTING ? 'Directory removed from disk.' : 'Reference removed (directory kept).'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to delete repository:\n${errorMessage}`);
    }
  }
}

