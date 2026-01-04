import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { RepositoryType, Repository } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { stateManager } from '../services/StateManager';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

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
        `Examples:\n` +
        `\`/repo clone owner/repo\`\n` +
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
        '• `/repo clone owner/repo`\n' +
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
          '• `owner/repo` (e.g., `facebook/react`)\n' +
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

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);
      const escapedBranch = UIHelpers.escapeMarkdown(repo.branch || 'default');

      await this.bot.editMessageText(
        `✅ Repository cloned successfully!\n\n` +
        `📁 Name: ${escapedName}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${escapedPath}\`\n` +
        `🌿 Branch: ${escapedBranch}\n\n` +
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

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);

      // Ask user if they want to link existing or create new GitHub repository
      await this.bot.sendMessage(
        chatId,
        `✅ Local repository created!\n\n` +
        `📁 Name: ${escapedName}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${escapedPath}\`\n\n` +
        `Would you like to connect this to GitHub?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Create New Public Repo', callback_data: `new_repo_create_public_${repo.id}` },
                { text: '🔒 Create New Private Repo', callback_data: `new_repo_create_private_${repo.id}` }
              ],
              [
                { text: '🔗 Link to Existing Repo', callback_data: `new_repo_link_${repo.id}` }
              ],
              [
                { text: '❌ Skip for Now', callback_data: `new_repo_skip_${repo.id}` }
              ]
            ]
          }
        }
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

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);
      const escapedUrl = repo.gitUrl ? UIHelpers.escapeMarkdown(repo.gitUrl) : '';

      await this.bot.sendMessage(
        chatId,
        `✅ Repository added successfully!\n\n` +
        `📁 Name: ${escapedName}\n` +
        `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
        `📂 Path: \`${escapedPath}\`\n` +
        `${repo.gitUrl ? `🔗 Remote: ${escapedUrl}\n` : ''}\n` +
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

    const repositories = await this.repositoryManager.listRepositories(userId);
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

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);

      message +=
        `${isCurrent ? '▶️ ' : ''}${typeEmoji} *${escapedName}*\n` +
        `   ID: \`${repo.id.substring(0, 8)}\`\n` +
        `   Path: \`${escapedPath}\`\n`;

      if (repo.gitUrl) {
        const escapedUrl = UIHelpers.escapeMarkdown(repo.gitUrl);
        message += `   Remote: ${escapedUrl}\n`;
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
    const repositories = await this.repositoryManager.listRepositories(userId);
    const repo = repositories.find((r) => r.id.startsWith(partialId));

    if (!repo) {
      await this.bot.sendMessage(
        chatId,
        `❌ Repository not found with ID: ${partialId}\nUse /repo list to see available repositories.`
      );
      return;
    }

    try {
      await this.repositoryManager.switchRepository(userId, repo.id);

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);
      const escapedUrl = repo.gitUrl ? UIHelpers.escapeMarkdown(repo.gitUrl) : '';

      await this.bot.sendMessage(
        chatId,
        `✅ Switched to repository: *${escapedName}*\n\n` +
        `📂 Path: \`${escapedPath}\`\n` +
        `${repo.gitUrl ? `🔗 Remote: ${escapedUrl}\n` : ''}\n` +
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

    // Escape special characters for Markdown
    const escapedName = UIHelpers.escapeMarkdown(repo.name);
    const escapedPath = UIHelpers.escapeMarkdown(repo.path);
    const escapedBranch = repo.branch ? UIHelpers.escapeMarkdown(repo.branch) : '';

    await this.bot.sendMessage(
      chatId,
      `▶️ *Current Repository*\n\n` +
      `📁 Name: ${escapedName}\n` +
      `🆔 ID: \`${repo.id.substring(0, 8)}\`\n` +
      `📂 Path: \`${escapedPath}\`\n` +
      `📝 Type: ${typeEmoji}\n` +
      `${webUrl ? `🔗 URL: ${webUrl}\n` : ''}` +
      `${repo.branch ? `🌿 Branch: ${escapedBranch}\n` : ''}` +
      `🕒 Last used: ${repo.lastUsed.toLocaleString()}\n\n` +
      `${webUrl ? `💡 Repository URL available above` : '⚠️ No remote URL configured'}`,
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
    const repositories = await this.repositoryManager.listRepositories(userId);
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

      // Escape special characters for Markdown
      const escapedName = UIHelpers.escapeMarkdown(repo.name);

      await this.bot.sendMessage(
        chatId,
        `✅ Repository deleted: *${escapedName}*\n\n` +
        `${repo.type !== RepositoryType.EXISTING ? 'Directory removed from disk.' : 'Reference removed (directory kept).'}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to delete repository:\n${errorMessage}`);
    }
  }

  /**
   * /remote command - Manage git remote
   */
  async handleRemote(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0];

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '❌ No repository selected.\n\nUse /repo to select or create a repository first.'
      );
      return;
    }

    if (!subcommand) {
      await this.bot.sendMessage(
        chatId,
        `🔗 *Remote Management*\n\n` +
        `Commands:\n` +
        `/remote show - Show current remote configuration\n` +
        `/remote set <url> - Set remote URL\n` +
        `/remote test - Test remote connection\n` +
        `/remote remove - Remove remote\n\n` +
        `Current repository: \`${currentRepo.name}\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    try {
      switch (subcommand.toLowerCase()) {
        case 'show':
          await this.handleRemoteShow(msg, currentRepo);
          break;
        case 'set':
          await this.handleRemoteSet(msg, currentRepo, args.slice(1));
          break;
        case 'test':
          await this.handleRemoteTest(msg, currentRepo);
          break;
        case 'remove':
          await this.handleRemoteRemove(msg, currentRepo);
          break;
        default:
          await this.bot.sendMessage(
            chatId,
            `❌ Unknown subcommand: ${subcommand}\nUse /remote to see available commands.`
          );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);
      logger.error('Remote command failed', {
        userId: msg.from?.id,
        subcommand,
        error: errorMessage
      });
    }
  }

  /**
   * Show current remote configuration
   */
  private async handleRemoteShow(msg: Message, repo: Repository): Promise<void> {
    const chatId = msg.chat.id;

    try {
      const { stdout } = await execAsync('git remote -v', {
        cwd: repo.path,
        timeout: 5000
      });

      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const escapedPath = UIHelpers.escapeMarkdown(repo.path);

      if (!stdout.trim()) {
        await this.bot.sendMessage(
          chatId,
          `📁 *Repository:* ${escapedName}\n` +
          `📂 *Path:* \`${escapedPath}\`\n\n` +
          `⚠️ No remote configured\n\n` +
          `Use \`/remote set <url>\` to add a remote.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      const lines = stdout.trim().split('\n');
      let remoteInfo = '';
      for (const line of lines) {
        const [name, url, type] = line.split(/\s+/);
        if (type === '(fetch)') {
          const escapedUrl = UIHelpers.escapeMarkdown(url);
          remoteInfo += `🔗 *${name}:* \`${escapedUrl}\`\n`;
        }
      }

      await this.bot.sendMessage(
        chatId,
        `📁 *Repository:* ${escapedName}\n` +
        `📂 *Path:* \`${escapedPath}\`\n\n` +
        `*Remote Configuration:*\n${remoteInfo}`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to get remote info:\n${errorMessage}`);
    }
  }

  /**
   * Set remote URL
   */
  private async handleRemoteSet(msg: Message, repo: Repository, args: string[]): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (args.length === 0) {
      await this.bot.sendMessage(
        chatId,
        '❌ Usage: /remote set <url>\n\n' +
        'Examples:\n' +
        '• `/remote set https://github.com/user/repo.git`\n' +
        '• `/remote set git@github.com:user/repo.git`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let remoteUrl = args[0];

    // Convert owner/repo format to full GitHub URL
    if (!remoteUrl.includes('://') && !remoteUrl.startsWith('git@')) {
      if (remoteUrl.includes('/')) {
        remoteUrl = `https://github.com/${remoteUrl}.git`;
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Invalid format. Use either:\n' +
          '• `owner/repo` (e.g., `facebook/react`)\n' +
          '• Full URL (e.g., `https://github.com/owner/repo.git`)',
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    try {
      // Check if origin remote exists
      let remoteExists = false;
      try {
        await execAsync('git remote get-url origin', {
          cwd: repo.path,
          timeout: 5000
        });
        remoteExists = true;
      } catch {
        // Remote doesn't exist
      }

      if (remoteExists) {
        // Update existing remote
        await execAsync(`git remote set-url origin ${remoteUrl}`, {
          cwd: repo.path,
          timeout: 5000
        });
      } else {
        // Add new remote
        await execAsync(`git remote add origin ${remoteUrl}`, {
          cwd: repo.path,
          timeout: 5000
        });
      }

      // Refresh repository info
      await this.repositoryManager.refreshRepository(userId, repo.id);

      const escapedUrl = UIHelpers.escapeMarkdown(remoteUrl);
      await this.bot.sendMessage(
        chatId,
        `✅ Remote ${remoteExists ? 'updated' : 'added'} successfully!\n\n` +
        `🔗 URL: \`${escapedUrl}\`\n\n` +
        `You can now push/pull from this remote.`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to set remote:\n${errorMessage}`);
    }
  }

  /**
   * Test remote connection
   */
  private async handleRemoteTest(msg: Message, repo: Repository): Promise<void> {
    const chatId = msg.chat.id;

    const statusMsg = await this.bot.sendMessage(chatId, '🔄 Testing remote connection...');

    try {
      await execAsync('git ls-remote origin', {
        cwd: repo.path,
        timeout: 15000
      });

      await this.bot.editMessageText(
        '✅ Remote connection successful!\n\n' +
        'The remote is properly configured and accessible.',
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.editMessageText(
        '❌ Remote connection failed!\n\n' +
        `Error: ${errorMessage}\n\n` +
        'Please check:\n' +
        '• Remote URL is correct\n' +
        '• You have network connectivity\n' +
        '• You have proper authentication',
        {
          chat_id: chatId,
          message_id: statusMsg.message_id
        }
      );
    }
  }

  /**
   * Remove remote
   */
  private async handleRemoteRemove(msg: Message, repo: Repository): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    try {
      await execAsync('git remote remove origin', {
        cwd: repo.path,
        timeout: 5000
      });

      // Refresh repository info
      await this.repositoryManager.refreshRepository(userId, repo.id);

      await this.bot.sendMessage(
        chatId,
        '✅ Remote removed successfully!\n\n' +
        'The repository is now disconnected from the remote.'
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.sendMessage(chatId, `❌ Failed to remove remote:\n${errorMessage}`);
    }
  }

  /**
   * /new_repo command - Create new repository with interactive prompts
   */
  async handleNewRepoCommand(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const name = match?.[1]?.trim();

    if (name) {
      // Name provided, ask for visibility
      await this.askVisibility(chatId, name);
    } else {
      // No name provided, ask for name first
      const statusMsg = await this.bot.sendMessage(
        chatId,
        '📁 *Create New Repository*\n\nWhat should the repository be named?',
        { parse_mode: 'Markdown' }
      );

      // Store pending state
      stateManager.setPendingNewRepoName(userId, {
        userId,
        chatId,
        messageId: statusMsg.message_id
      });
    }
  }

  /**
   * Handle name input for /new_repo
   */
  async handleNewRepoNameInput(userId: number, chatId: number, name: string): Promise<void> {
    const pending = stateManager.getPendingNewRepoName(userId);
    if (!pending) return;

    stateManager.clearPendingNewRepoName(userId);

    // Validate name
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      await this.bot.sendMessage(
        chatId,
        `Invalid name: \`${name}\`\n\nUse only letters, numbers, hyphens, and underscores.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await this.askVisibility(chatId, name);
  }

  /**
   * Ask for repository visibility (public/private)
   */
  private async askVisibility(chatId: number, name: string): Promise<void> {
    await this.bot.sendMessage(
      chatId,
      `📁 *${UIHelpers.escapeMarkdown(name)}*\n\nChoose visibility:`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🌐 Public', callback_data: `newrepo_public_${name}` },
              { text: '🔒 Private', callback_data: `newrepo_private_${name}` }
            ],
            [
              { text: '❌ Cancel', callback_data: 'newrepo_cancel' }
            ]
          ]
        }
      }
    );
  }

  /**
   * Handle visibility callback for /new_repo
   */
  async handleNewRepoVisibility(
    chatId: number,
    messageId: number,
    userId: number,
    visibility: 'public' | 'private',
    name: string
  ): Promise<void> {
    const isPrivate = visibility === 'private';

    // Update message to show progress
    await this.bot.editMessageText(
      `Creating \`${name}\`...`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
    );

    try {
      // Create local repository first
      const repo = await this.repositoryManager.createRepository(userId, name);

      // Initialize git
      await execAsync('git init', { cwd: repo.path, timeout: 5000 });
      await execAsync('git config user.name "tg-claude"', { cwd: repo.path, timeout: 5000 });
      await execAsync('git config user.email "claude-code@remote.machine"', { cwd: repo.path, timeout: 5000 });

      // Create initial commit
      await execAsync('git add . || true', { cwd: repo.path, timeout: 5000 });
      await execAsync('git commit -m "Initial commit" --allow-empty', { cwd: repo.path, timeout: 5000 });

      // Create GitHub repository
      const result = await this.executor.createGitHubRepository(repo.path, isPrivate);

      if (result === 'success') {
        await this.repositoryManager.refreshRepository(userId, repo.id);
        await this.updatePinnedRepositoryInfo(chatId, userId);

        const escapedName = UIHelpers.escapeMarkdown(repo.name);
        const escapedPath = UIHelpers.escapeMarkdown(repo.path);

        await this.bot.editMessageText(
          `✅ *Repository created!*\n\n` +
          `📁 ${escapedName}\n` +
          `${isPrivate ? '🔒 Private' : '🌐 Public'}\n` +
          `📂 \`${escapedPath}\``,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[{ text: '📂 View', callback_data: 'repo_current' }]]
            }
          }
        );
      } else if (result === 'already_exists') {
        await this.bot.editMessageText(
          `Repository \`${name}\` already exists on GitHub.\n\nTry a different name with /new_repo`,
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
      } else {
        await this.bot.editMessageText(
          `Failed to create GitHub repository.\n\nLocal repo created at \`${repo.path}\``,
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.bot.editMessageText(
        `Error: ${errorMessage}`,
        { chat_id: chatId, message_id: messageId }
      );
      logger.error('Failed to create new repo', { userId, name, error: errorMessage });
    }
  }
}

