import { CallbackQuery } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';
import { RepositoryType } from '../types';
import { promisify } from 'util';
import { exec } from 'child_process';
import { BeastModeExecutor } from '../services/BeastModeExecutor';
import { TaskQueue } from '../services/TaskQueue';

const execAsync = promisify(exec);

/**
 * Pending repository creation state
 */
interface PendingRepoCreation {
  workingDir: string;
  isPrivate: boolean;
  userId: number;
  chatId: number;
  originalName: string;
}

/**
 * Handles callback queries from inline keyboard buttons
 */
export class CallbackQueryHandler extends BaseHandler {
  // Static map to track pending repository creation requests
  private static pendingRepoCreations: Map<number, PendingRepoCreation> = new Map();

  // Beast mode executor reference (instance-based for proper DI)
  private beastModeExecutor: BeastModeExecutor | null = null;

  // Task queue reference
  private taskQueue: TaskQueue | null = null;

  /**
   * Set the beast mode executor (should be called after construction)
   */
  setBeastModeExecutor(executor: BeastModeExecutor): void {
    this.beastModeExecutor = executor;
  }

  /**
   * Set the task queue (should be called after construction)
   */
  setTaskQueue(queue: TaskQueue): void {
    this.taskQueue = queue;
  }

  async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const messageId = query.message?.message_id;
    const data = query.data;

    if (!chatId || !messageId || !data) {
      logger.warn('Invalid callback query received', { userId, data });
      return;
    }

    // Answer callback query to remove loading state
    await this.bot.answerCallbackQuery(query.id);

    // Note: We can't use checkAccess here as it requires a Message object
    // For now, we'll just check if user is authorized
    if (!query.message || !query.from) {
      return;
    }

    try {
      // Route to appropriate handler based on callback data
      const [action, ...params] = data.split('_');

      switch (action) {
        case 'main':
          await this.handleMainMenu(chatId, messageId, userId);
          break;

        case 'repo':
          await this.handleRepoAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'status':
          await this.handleStatusAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'task':
          await this.handleTaskAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'show':
          await this.handleShowAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'refresh':
          await this.handleRefreshAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'create':
          await this.handleCreateRepoAction(chatId, messageId, userId, params);
          break;

        case 'new':
          await this.handleNewRepoAction(chatId, messageId, userId, params);
          break;

        case 'config':
          await this.handleConfigAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'cancel':
          await this.handleCancelTask(chatId, messageId, userId, params.join('_'));
          break;

        case 'view':
          await this.handleViewLog(chatId, messageId, userId, params.join('_'));
          break;

        case 'beast':
          await this.handleBeastModeAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'queue':
          await this.handleQueueAction(chatId, messageId, userId, params.join('_'));
          break;

        default:
          logger.warn('Unknown callback action', { action, data });
          await this.bot.sendMessage(chatId, '❌ Unknown action. Please try again.');
      }
    } catch (error) {
      logger.error('Error handling callback query', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        data
      });

      await this.bot.sendMessage(
        chatId,
        '❌ An error occurred while processing your request. Please try again.'
      );
    }
  }

  /**
   * Show main menu
   */
  private async handleMainMenu(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    const keyboard = UIHelpers.createMainMenuKeyboard(currentRepo !== null);

    const message =
      '🤖 *Claude Code Remote Control Bot*\n\n' +
      'Choose an action from the menu below:';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Handle repository-related actions
   */
  private async handleRepoAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    switch (subAction) {
      case 'menu':
        await this.showRepoMenu(chatId, messageId);
        break;

      case 'list':
        await this.showRepoList(chatId, messageId, userId);
        break;

      case 'current':
        await this.showCurrentRepo(chatId, messageId, userId);
        break;

      case 'switch_menu':
        await this.showRepoList(chatId, messageId, userId);
        break;

      case 'add_menu':
        await this.showAddRepoInstructions(chatId, messageId);
        break;

      case 'link':
        await this.showRepoLink(chatId, messageId, userId);
        break;

      default:
        // Handle repo selection (format: repo_select_<repoId>)
        if (subAction.startsWith('select_')) {
          const repoIdPrefix = subAction.replace('select_', '');
          await this.selectRepository(chatId, messageId, userId, repoIdPrefix);
        }
        // Handle repo deletion (format: repo_delete_<repoId>)
        else if (subAction.startsWith('delete_')) {
          const repoIdPrefix = subAction.replace('delete_', '');
          await this.deleteRepository(chatId, messageId, userId, repoIdPrefix);
        }
    }
  }

  /**
   * Show repository menu
   */
  private async showRepoMenu(chatId: number, messageId: number): Promise<void> {
    const keyboard = UIHelpers.createRepoActionMenu();

    const message =
      '📁 *Repository Management*\n\n' +
      'Choose an action:';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Show repository list with inline buttons
   */
  private async showRepoList(chatId: number, messageId: number, userId: number): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (repositories.length === 0) {
      await this.bot.editMessageText(
        '📁 *Your Repositories*\n\n' +
        'No repositories found.\n\n' +
        'Use `/repo clone <url>` to clone a repository\n' +
        'Use `/repo new <name>` to create a new repository\n' +
        'Use `/repo add <path>` to add an existing repository',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: UIHelpers.createRepoActionMenu()
        }
      );
      return;
    }

    const keyboard = UIHelpers.createRepositoryListKeyboard(
      repositories,
      currentRepo?.id || null
    );

    const message =
      '📁 *Your Repositories*\n\n' +
      `Found ${repositories.length} ${repositories.length === 1 ? 'repository' : 'repositories'}.\n\n` +
      'Select a repository to switch to:';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Show current repository details
   */
  private async showCurrentRepo(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    const { message, keyboard } = UIHelpers.createRepositoryDashboard(currentRepo || null);

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Show instructions for adding a repository
   */
  private async showAddRepoInstructions(chatId: number, messageId: number): Promise<void> {
    const message =
      '➕ *Add New Repository*\n\n' +
      '*Clone from remote:*\n' +
      '`/repo clone <git-url>`\n\n' +
      '*Create new repository:*\n' +
      '`/repo new <name>`\n\n' +
      '*Add existing repository:*\n' +
      '`/repo add <path>`';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Repositories', callback_data: 'repo_menu' }]
        ]
      }
    });
  }

  /**
   * Show repository link
   */
  private async showRepoLink(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.editMessageText(
        '❌ No repository selected.\n\nUse /repo to set up a repository.',
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [
              [{ text: '📁 Setup Repository', callback_data: 'repo_menu' }]
            ]
          }
        }
      );
      return;
    }

    const webUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);

    if (webUrl) {
      await this.bot.editMessageText(
        `🔗 *Repository Link*\n\n` +
        `*Name:* ${currentRepo.name}\n` +
        `*Branch:* ${currentRepo.branch || 'main'}\n` +
        `*URL:* [Open in Browser](${webUrl})`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔗 Open in Browser', url: webUrl }],
              [{ text: '🔙 Back', callback_data: 'repo_current' }]
            ]
          }
        }
      );
    } else {
      await this.bot.editMessageText(
        `📂 *Repository Information*\n\n` +
        `*Name:* ${currentRepo.name}\n` +
        `*Path:* \`${currentRepo.path}\`\n` +
        `*Branch:* ${currentRepo.branch || 'main'}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Back', callback_data: 'repo_current' }]
            ]
          }
        }
      );
    }
  }

  /**
   * Select and switch to a repository
   */
  private async selectRepository(
    chatId: number,
    messageId: number,
    userId: number,
    repoIdPrefix: string
  ): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const selectedRepo = repositories.find((r: any) => r.id.startsWith(repoIdPrefix));

    if (!selectedRepo) {
      await this.bot.answerCallbackQuery(userId.toString(), {
        text: '❌ Repository not found',
        show_alert: true
      });
      return;
    }

    await this.repositoryManager.switchRepository(userId, selectedRepo.id);

    // Update pinned message with new repository
    await this.updatePinnedRepositoryInfo(chatId, userId);

    const { message, keyboard } = UIHelpers.createRepositoryDashboard(selectedRepo);

    await this.bot.editMessageText(
      `✅ Switched to repository!\n\n${message}`,
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  }

  /**
   * Delete a repository
   */
  private async deleteRepository(
    chatId: number,
    messageId: number,
    userId: number,
    repoIdPrefix: string
  ): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const repoToDelete = repositories.find((r: any) => r.id.startsWith(repoIdPrefix));

    if (!repoToDelete) {
      await this.bot.answerCallbackQuery(userId.toString(), {
        text: '❌ Repository not found',
        show_alert: true
      });
      return;
    }

    try {
      // Delete the repository
      await this.repositoryManager.deleteRepository(userId, repoToDelete.id);

      // Update pinned message if the deleted repo was current
      await this.updatePinnedRepositoryInfo(chatId, userId);

      // Show success message and refresh the list
      await this.bot.editMessageText(
        `✅ Repository deleted: *${UIHelpers.escapeMarkdown(repoToDelete.name)}*\n\n` +
        `${repoToDelete.type !== RepositoryType.EXISTING ? 'Directory removed from disk.' : 'Reference removed (directory kept).'}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '📋 View Repositories', callback_data: 'repo_list' }],
              [{ text: '🔙 Back to Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }
      );
    } catch (error) {
      logger.error('Error deleting repository', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        repoIdPrefix
      });

      await this.bot.answerCallbackQuery(userId.toString(), {
        text: '❌ Failed to delete repository',
        show_alert: true
      });
    }
  }

  /**
   * Handle status-related actions
   */
  private async handleStatusAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    switch (subAction) {
      case 'menu':
        await this.showStatusMenu(chatId, messageId, userId);
        break;

      default:
        await this.bot.sendMessage(chatId, 'Use /status to view active tasks');
    }
  }

  /**
   * Show status menu
   */
  private async showStatusMenu(chatId: number, messageId: number, _userId: number): Promise<void> {
    // Get task count instead of full task list
    const activeTaskCount = this.executor.getTaskCount();

    const message =
      '📊 *Status*\n\n' +
      `Active tasks: ${activeTaskCount}\n\n` +
      'Use /status to view detailed task information';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  /**
   * Handle task-related actions
   */
  private async handleTaskAction(
    chatId: number,
    messageId: number,
    _userId: number,
    _subAction: string
  ): Promise<void> {
    await this.bot.editMessageText(
      '🚀 *Run Task*\n\n' +
      'Use `/task <description>` to execute a task.\n\n' +
      'Example: `/task add error handling to API endpoints`',
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Back to Main Menu', callback_data: 'main_menu' }]
          ]
        }
      }
    );
  }

  /**
   * Handle show actions (help, logs, limits)
   */
  private async handleShowAction(
    chatId: number,
    messageId: number,
    _userId: number,
    subAction: string
  ): Promise<void> {
    switch (subAction) {
      case 'help':
        await this.showHelp(chatId, messageId);
        break;

      case 'logs':
        await this.bot.sendMessage(chatId, 'Use /logs <task-id> to view task logs');
        break;

      case 'limits':
        await this.bot.sendMessage(chatId, 'Use /limits to check your rate limits');
        break;
    }
  }

  /**
   * Show help message
   */
  private async showHelp(chatId: number, messageId: number): Promise<void> {
    const message =
      '❓ *Help*\n\n' +
      '*Repository Management:*\n' +
      '• `/repo` - Manage repositories\n\n' +
      '*Development:*\n' +
      '• `/task <desc>` - Execute task\n\n' +
      '*Status & Info:*\n' +
      '• `/status` - Check active tasks\n' +
      '• `/logs <id>` - View task logs\n' +
      '• `/limits` - Check rate limits\n' +
      '• `/help` - Show this help';

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Back to Main Menu', callback_data: 'main_menu' }]
        ]
      }
    });
  }

  /**
   * Handle refresh actions
   */
  private async handleRefreshAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    switch (subAction) {
      case 'dashboard':
        // Refresh the current repository info
        const currentRepo = this.repositoryManager.getCurrentRepository(userId);
        if (currentRepo) {
          try {
            // Refresh repository info (git URL, branch, etc.)
            await this.repositoryManager.refreshRepository(userId, currentRepo.id);

            // Show updated repository info
            await this.showCurrentRepo(chatId, messageId, userId);
          } catch (error) {
            await this.bot.answerCallbackQuery(userId.toString(), {
              text: '❌ Failed to refresh repository info',
              show_alert: true
            });
          }
        } else {
          await this.showCurrentRepo(chatId, messageId, userId);
        }
        break;

      default:
        await this.handleMainMenu(chatId, messageId, userId);
    }
  }

  /**
   * Handle repository creation action
   */
  private async handleCreateRepoAction(
    chatId: number,
    messageId: number,
    userId: number,
    params: string[]
  ): Promise<void> {
    // params[0] = 'repo'
    // params[1] = 'public' or 'private' or 'skip'
    // params[2...] = working directory path

    const action = params[1];
    const workingDir = params.slice(2).join('_');

    if (action === 'skip') {
      await this.bot.editMessageText(
        '✅ Skipped repository creation.\n\nYour changes remain committed locally.',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        }
      );
      return;
    }

    const isPrivate = action === 'private';

    // Show processing message
    await this.bot.editMessageText(
      '⏳ Creating GitHub repository...\n\nThis may take a few moments.',
      {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown'
      }
    );

    try {
      // Get original repository name
      const path = require('path');
      const originalName = path.basename(workingDir);

      // Create repository
      const result = await this.executor.createGitHubRepository(workingDir, isPrivate);

      if (result === 'success') {
        // Refresh repository info
        const currentRepo = this.repositoryManager.getCurrentRepository(userId);
        if (currentRepo) {
          await this.repositoryManager.refreshRepository(userId, currentRepo.id);
        }

        await this.bot.editMessageText(
          `✅ *GitHub Repository Created!*\n\n` +
          `Your changes have been pushed to GitHub.\n` +
          `Visibility: ${isPrivate ? '🔒 Private' : '✅ Public'}`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📂 View Repository', callback_data: 'repo_current' }]
              ]
            }
          }
        );
      } else if (result === 'already_exists') {
        // Repository name already exists, prompt user for new name
        CallbackQueryHandler.setPendingRepoCreation(userId, {
          workingDir,
          isPrivate,
          userId,
          chatId,
          originalName
        });

        await this.bot.editMessageText(
          `⚠️ *Repository Name Already Exists*\n\n` +
          `A repository named \`${originalName}\` already exists on your GitHub account.\n\n` +
          `Please reply with a different repository name you'd like to use:`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );
      } else {
        await this.bot.editMessageText(
          '❌ *Failed to Create Repository*\n\n' +
          'Please make sure:\n' +
          '• GitHub CLI (gh) is installed\n' +
          '• You are authenticated with GitHub\n' +
          '• You have internet connection\n\n' +
          'You can try creating the repository manually using:\n' +
          '`gh repo create`',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );
      }
    } catch (error) {
      logger.error('Error creating GitHub repository', {
        error: error instanceof Error ? error.message : String(error),
        workingDir,
        isPrivate
      });

      await this.bot.editMessageText(
        '❌ *Error Creating Repository*\n\n' +
        `${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        }
      );
    }
  }

  /**
   * Handle new repository setup action (create on GitHub or link existing)
   */
  private async handleNewRepoAction(
    chatId: number,
    messageId: number,
    userId: number,
    params: string[]
  ): Promise<void> {
    // params[0] = 'repo'
    // params[1] = 'create' or 'link' or 'skip'
    // params[2] = 'public' or 'private' (if create)
    // params[3+] = repository ID

    const action = params[1]; // create or link or skip
    const visibility = params[2]; // public or private (for create action)
    const repoId = params.slice(action === 'create' ? 3 : 2).join('_');

    // Get repository
    const repositories = await this.repositoryManager.listRepositories(userId);
    const repo = repositories.find(r => r.id === repoId);
    if (!repo) {
      await this.bot.editMessageText(
        '❌ Repository not found. It may have been deleted.',
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
      return;
    }

    if (action === 'skip') {
      await this.bot.editMessageText(
        '✅ Repository is ready to use!\n\n' +
        'You can connect it to GitHub later using:\n' +
        '• `/remote set <url>` to link existing repository\n' +
        '• Or create one when you commit changes',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        }
      );
      return;
    }

    if (action === 'link') {
      await this.bot.editMessageText(
        '🔗 Link to Existing Repository\n\n' +
        'Use the `/remote set` command to connect to your existing GitHub repository:\n\n' +
        'Examples:\n' +
        '• `/remote set owner/repo`\n' +
        '• `/remote set https://github.com/owner/repo.git`',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown'
        }
      );
      return;
    }

    if (action === 'create') {
      const isPrivate = visibility === 'private';

      await this.bot.editMessageText(
        `⏳ Creating GitHub repository...`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );

      try {
        // Initialize repository with git
        await execAsync('git init', {
          cwd: repo.path,
          timeout: 5000
        });

        // Configure git identity for this repository
        await execAsync('git config user.name "Claude Telegram Bot"', {
          cwd: repo.path,
          timeout: 5000
        });
        await execAsync('git config user.email "bot@claude-telegram.local"', {
          cwd: repo.path,
          timeout: 5000
        });

        // Create initial commit if none exists
        try {
          await execAsync('git log -1', {
            cwd: repo.path,
            timeout: 5000
          });
        } catch {
          // No commits, create initial commit
          await execAsync('git add . || true', {
            cwd: repo.path,
            timeout: 5000
          });

          await execAsync('git commit -m "Initial commit" --allow-empty', {
            cwd: repo.path,
            timeout: 5000
          });
        }

        // Create GitHub repository
        const result = await this.executor.createGitHubRepository(repo.path, isPrivate);

        if (result === 'success') {
          // Refresh repository info
          await this.repositoryManager.refreshRepository(userId, repo.id);

          await this.bot.editMessageText(
            `✅ *GitHub Repository Created!*\n\n` +
            `Repository: \`${repo.name}\`\n` +
            `Visibility: ${isPrivate ? '🔒 Private' : '✅ Public'}\n\n` +
            `Your repository is now connected to GitHub!`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📂 View Repository', callback_data: 'repo_current' }]
                ]
              }
            }
          );
        } else if (result === 'already_exists') {
          await this.bot.editMessageText(
            `⚠️ Repository \`${repo.name}\` already exists on GitHub!\n\n` +
            `Please use \`/remote set owner/repo\` to link to it.`,
            {
              chat_id: chatId,
              message_id: messageId,
              parse_mode: 'Markdown'
            }
          );
        } else {
          await this.bot.editMessageText(
            '❌ Failed to create GitHub repository\n\n' +
            'Please make sure:\n' +
            '• GitHub CLI (gh) is installed\n' +
            '• You are authenticated with GitHub\n' +
            '• You have internet connection',
            {
              chat_id: chatId,
              message_id: messageId
            }
          );
        }
      } catch (error) {
        logger.error('Error creating GitHub repository for new repo', {
          error: error instanceof Error ? error.message : String(error),
          repoId,
          repoPath: repo.path
        });

        await this.bot.editMessageText(
          '❌ Error creating repository\n\n' +
          `${error instanceof Error ? error.message : String(error)}`,
          {
            chat_id: chatId,
            message_id: messageId
          }
        );
      }
    }
  }

  /**
   * Handle repository name response from user
   */
  async handleRepoNameResponse(userId: number, chatId: number, newRepoName: string): Promise<void> {
    const pending = CallbackQueryHandler.getPendingRepoCreation(userId);
    if (!pending) {
      return;
    }

    // Clear pending state
    CallbackQueryHandler.clearPendingRepoCreation(userId);

    // Validate repository name
    const validNameRegex = /^[a-zA-Z0-9_-]+$/;
    if (!validNameRegex.test(newRepoName)) {
      await this.bot.sendMessage(
        chatId,
        `❌ Invalid repository name: \`${newRepoName}\`\n\n` +
        `Repository names can only contain:\n` +
        `• Letters (a-z, A-Z)\n` +
        `• Numbers (0-9)\n` +
        `• Hyphens (-)\n` +
        `• Underscores (_)\n\n` +
        `Please use /repo to try again.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const statusMsg = await this.bot.sendMessage(
      chatId,
      `⏳ Creating GitHub repository: \`${newRepoName}\`...`,
      { parse_mode: 'Markdown' }
    );

    try {
      // Create repository with custom name
      const result = await this.executor.createGitHubRepository(
        pending.workingDir,
        pending.isPrivate,
        newRepoName
      );

      if (result === 'success') {
        // Refresh repository info
        const currentRepo = this.repositoryManager.getCurrentRepository(userId);
        if (currentRepo) {
          await this.repositoryManager.refreshRepository(userId, currentRepo.id);
        }

        await this.bot.editMessageText(
          `✅ *GitHub Repository Created!*\n\n` +
          `Repository name: \`${newRepoName}\`\n` +
          `Your changes have been pushed to GitHub.\n` +
          `Visibility: ${pending.isPrivate ? '🔒 Private' : '✅ Public'}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '📂 View Repository', callback_data: 'repo_current' }]
              ]
            }
          }
        );
      } else if (result === 'already_exists') {
        await this.bot.editMessageText(
          `⚠️ Repository \`${newRepoName}\` also already exists!\n\n` +
          `Please choose a different name and use /repo to try again.`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      } else {
        await this.bot.editMessageText(
          '❌ *Failed to Create Repository*\n\n' +
          'Please make sure:\n' +
          '• GitHub CLI (gh) is installed\n' +
          '• You are authenticated with GitHub\n' +
          '• You have internet connection',
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
    } catch (error) {
      logger.error('Error creating GitHub repository with custom name', {
        error: error instanceof Error ? error.message : String(error),
        newRepoName,
        workingDir: pending.workingDir
      });

      await this.bot.editMessageText(
        '❌ *Error Creating Repository*\n\n' +
        `${error instanceof Error ? error.message : String(error)}`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
    }
  }

  /**
   * Handle config-related actions
   */
  private async handleConfigAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    switch (subAction) {
      case 'menu':
        await this.showConfigMenu(chatId, messageId, userId);
        break;

      case 'show':
        await this.showConfig(chatId, messageId, userId);
        break;

      case 'git':
        await this.showGitConfig(chatId, messageId, userId);
        break;

      case 'preferences':
        await this.showPreferencesConfig(chatId, messageId, userId);
        break;

      case 'limits':
        await this.showLimitsConfig(chatId, messageId, userId);
        break;

      case 'reset_confirm':
        await this.showResetConfirmation(chatId, messageId);
        break;

      case 'reset_yes':
        await this.performConfigReset(chatId, messageId, userId);
        break;

      case 'reset_no':
        await this.showConfigMenu(chatId, messageId, userId);
        break;

      default:
        await this.bot.sendMessage(chatId, 'Use /config to manage your settings');
    }
  }

  /**
   * Show config menu
   */
  private async showConfigMenu(chatId: number, messageId: number, _userId: number): Promise<void> {
    const message =
      `⚙️ *User Configuration*\n\n` +
      `Manage your personal settings:\n\n` +
      `• Git configuration (name, email, branch)\n` +
      `• Preferences (auto-commit, notifications)\n` +
      `• Limits (concurrent tasks, timeouts)\n\n` +
      `Use \`/config set <key> <value>\` to update settings directly.`;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📄 View Config', callback_data: 'config_show' },
            { text: '🔄 Reset Config', callback_data: 'config_reset_confirm' }
          ],
          [
            { text: '👤 Git Settings', callback_data: 'config_git' },
            { text: '⚙️ Preferences', callback_data: 'config_preferences' }
          ],
          [
            { text: '📊 Limits', callback_data: 'config_limits' }
          ],
          [
            { text: '🔙 Back to Main Menu', callback_data: 'main_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show current configuration
   */
  private async showConfig(chatId: number, messageId: number, _userId: number): Promise<void> {
    // For now, show a placeholder. In full implementation, this would load from UserConfigManager
    const message =
      `⚙️ *Your Configuration*\n\n` +
      `Use \`/config show\` command to see full details.\n\n` +
      `Or use the buttons below to edit specific sections:`;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👤 Git Settings', callback_data: 'config_git' },
            { text: '⚙️ Preferences', callback_data: 'config_preferences' }
          ],
          [
            { text: '📊 Limits', callback_data: 'config_limits' }
          ],
          [
            { text: '🔙 Back', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show git config section
   */
  private async showGitConfig(chatId: number, messageId: number, _userId: number): Promise<void> {
    const message =
      `👤 *Git Configuration*\n\n` +
      `Configure git settings for commits:\n\n` +
      `To update:\n` +
      `\`/config set git.userName "Your Name"\`\n` +
      `\`/config set git.userEmail "you@email.com"\`\n` +
      `\`/config set git.defaultBranch "main"\``;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔙 Back to Config', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show preferences config section
   */
  private async showPreferencesConfig(chatId: number, messageId: number, _userId: number): Promise<void> {
    const message =
      `⚙️ *Preferences*\n\n` +
      `Configure bot behavior:\n\n` +
      `To update:\n` +
      `\`/config set preferences.autoCommit true\`\n` +
      `\`/config set preferences.autoPush false\`\n` +
      `\`/config set preferences.notifyOnTaskComplete true\`\n` +
      `\`/config set preferences.dangerModeEnabled false\``;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔙 Back to Config', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show limits config section
   */
  private async showLimitsConfig(chatId: number, messageId: number, _userId: number): Promise<void> {
    const message =
      `📊 *Limits*\n\n` +
      `Configure resource limits:\n\n` +
      `To update:\n` +
      `\`/config set limits.maxConcurrentTasks 5\`\n` +
      `\`/config set limits.taskTimeoutMs 900000\``;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🔙 Back to Config', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Show reset confirmation
   */
  private async showResetConfirmation(chatId: number, messageId: number): Promise<void> {
    const message =
      `⚠️ *Reset Configuration?*\n\n` +
      `This will reset all your settings to defaults:\n\n` +
      `• Git settings\n` +
      `• Preferences\n` +
      `• Limits\n\n` +
      `Are you sure?`;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Yes, Reset', callback_data: 'config_reset_yes' },
            { text: '❌ Cancel', callback_data: 'config_reset_no' }
          ]
        ]
      }
    });
  }

  /**
   * Perform config reset
   */
  private async performConfigReset(chatId: number, messageId: number, _userId: number): Promise<void> {
    // For now, show a placeholder. In full implementation, this would call UserConfigManager.resetConfig
    const message =
      `✅ *Configuration Reset*\n\n` +
      `Your settings have been reset to defaults.\n\n` +
      `Use \`/config show\` to see the default values.`;

    await this.bot.editMessageText(message, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📄 View Config', callback_data: 'config_show' }
          ],
          [
            { text: '🔙 Back to Config', callback_data: 'config_menu' }
          ]
        ]
      }
    });
  }

  /**
   * Handle cancel task button
   */
  private async handleCancelTask(
    chatId: number,
    messageId: number,
    userId: number,
    taskId: string
  ): Promise<void> {
    try {
      // Extract task ID from params (format: "task:taskId")
      const actualTaskId = taskId.replace('task:', '');

      const task = this.executor.getTask(actualTaskId);
      if (!task) {
        await this.bot.editMessageText('❌ Task not found or already completed.', {
          chat_id: chatId,
          message_id: messageId
        });
        return;
      }

      // Check if task belongs to user
      if (task.userId !== userId) {
        await this.bot.sendMessage(chatId, '❌ You can only cancel your own tasks');
        return;
      }

      // Cancel the task
      const cancelled = this.executor.cancelTask(actualTaskId);

      if (cancelled) {
        await this.bot.editMessageText(
          `🛑 *Task Cancelled*\n\n` +
          `Task ID: \`${actualTaskId.substring(0, 8)}\`\n` +
          `Status: Cancelled by user\n` +
          `Time: ${UIHelpers.formatDuration(Math.round((Date.now() - task.startTime.getTime()) / 1000))}`,
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );

        logger.info('Task cancelled by user', {
          taskId: actualTaskId,
          userId
        });
      } else {
        await this.bot.editMessageText('❌ Failed to cancel task. It may have already completed.', {
          chat_id: chatId,
          message_id: messageId
        });
      }
    } catch (error) {
      logger.error('Error cancelling task', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        taskId
      });

      await this.bot.sendMessage(chatId, '❌ Error cancelling task.');
    }
  }

  /**
   * Handle view log button - sends full task log
   */
  private async handleViewLog(
    chatId: number,
    _messageId: number,
    userId: number,
    taskId: string
  ): Promise<void> {
    try {
      // Extract task ID from params (format: "log:taskId")
      const actualTaskId = taskId.replace('log:', '');

      const task = this.executor.getTask(actualTaskId);
      if (!task) {
        await this.bot.sendMessage(chatId, '❌ Task not found');
        return;
      }

      // Check if task belongs to user
      if (task.userId !== userId) {
        await this.bot.sendMessage(chatId, '❌ You can only view your own task logs');
        return;
      }

      // Try to send log file if it exists
      const logFilePath = this.executor.getTaskLogFilePath(actualTaskId);

      if (logFilePath) {
        await this.bot.sendDocument(chatId, logFilePath, {
          caption: `📋 Full log for task \`${actualTaskId.substring(0, 8)}\``,
          parse_mode: 'Markdown'
        }, {
          filename: `task-${actualTaskId.substring(0, 8)}.log`,
          contentType: 'text/plain'
        });
      } else {
        // Fallback to in-memory output
        const fullOutput = task.output || '';
        const errorOutput = task.errorOutput || '';
        let combinedOutput = '';

        if (fullOutput) {
          combinedOutput += '=== STDOUT ===\n' + fullOutput;
        }
        if (errorOutput) {
          combinedOutput += '\n\n=== STDERR ===\n' + errorOutput;
        }
        if (!combinedOutput.trim()) {
          combinedOutput = 'No output captured yet.';
        }

        // Send as document
        await this.bot.sendDocument(
          chatId,
          Buffer.from(combinedOutput),
          {
            caption: `📋 Full log for task \`${actualTaskId.substring(0, 8)}\``,
            parse_mode: 'Markdown'
          },
          {
            filename: `task-${actualTaskId.substring(0, 8)}.log`,
            contentType: 'text/plain'
          }
        );
      }

      logger.info('Task log sent to user', {
        taskId: actualTaskId,
        userId
      });
    } catch (error) {
      logger.error('Error sending task log', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        taskId
      });

      await this.bot.sendMessage(chatId, '❌ Error retrieving log. Please try again.');
    }
  }

  /**
   * Handle beast mode actions (stop, etc.)
   */
  private async handleBeastModeAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    // Format: beast_stop:sessionId
    if (subAction.startsWith('stop:')) {
      const sessionId = subAction.replace('stop:', '');

      if (!this.beastModeExecutor) {
        await this.bot.sendMessage(chatId, '❌ Beast mode executor not available');
        return;
      }

      const stopped = this.beastModeExecutor.stopSession(sessionId);

      if (stopped) {
        await this.bot.editMessageText(
          '🛑 **Beast Mode Stopped**\n\n' +
          'The autonomous execution has been stopped.\n' +
          'Any uncommitted changes remain in the working directory.',
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
          }
        );

        logger.info('Beast mode session stopped via callback', {
          sessionId,
          userId
        });
      } else {
        await this.bot.sendMessage(
          chatId,
          '❌ Could not stop beast mode. Session may have already completed.'
        );
      }
    } else {
      logger.warn('Unknown beast mode action', { subAction, userId });
    }
  }

  /**
   * Handle queue-related actions
   */
  private async handleQueueAction(
    chatId: number,
    messageId: number,
    userId: number,
    subAction: string
  ): Promise<void> {
    if (!this.taskQueue) {
      await this.bot.sendMessage(chatId, '❌ Task queue not available');
      return;
    }

    // Handle queue_cancel:<taskId>
    if (subAction.startsWith('cancel:')) {
      const taskId = subAction.replace('cancel:', '');
      const cancelled = await this.taskQueue.cancelQueuedTask(taskId, chatId);

      if (cancelled) {
        logger.info('Queued task cancelled via callback', { taskId, userId });
      } else {
        await this.bot.sendMessage(chatId, '❌ Task not found in queue or already started');
      }
      return;
    }

    // Handle queue_clear
    if (subAction === 'clear') {
      const clearedCount = await this.taskQueue.clearQueueForUser(userId);

      await this.bot.editMessageText(
        clearedCount > 0
          ? `✅ Cleared ${clearedCount} task${clearedCount > 1 ? 's' : ''} from queue`
          : '✅ Queue is already empty',
        {
          chat_id: chatId,
          message_id: messageId
        }
      );

      logger.info('Queue cleared via callback', { userId, clearedCount });
      return;
    }

    // Handle queue_refresh
    if (subAction === 'refresh') {
      const queueInfo = this.taskQueue.getQueueInfo(userId);
      const userQueue = this.taskQueue.getQueueForUser(userId);

      const keyboard = userQueue.length > 0
        ? {
            inline_keyboard: [
              [{ text: '🗑️ Clear Queue', callback_data: 'queue_clear' }],
              [{ text: '🔄 Refresh', callback_data: 'queue_refresh' }]
            ]
          }
        : undefined;

      await this.bot.editMessageText(
        `📋 *Task Queue*\n\n${queueInfo}`,
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        }
      );
      return;
    }

    logger.warn('Unknown queue action', { subAction, userId });
  }

  /**
   * Check if user has a pending repository creation
   */
  static hasPendingRepoCreation(userId: number): boolean {
    return CallbackQueryHandler.pendingRepoCreations.has(userId);
  }

  /**
   * Get pending repository creation for user
   */
  static getPendingRepoCreation(userId: number): PendingRepoCreation | undefined {
    return CallbackQueryHandler.pendingRepoCreations.get(userId);
  }

  /**
   * Set pending repository creation for user
   */
  static setPendingRepoCreation(userId: number, data: PendingRepoCreation): void {
    CallbackQueryHandler.pendingRepoCreations.set(userId, data);
  }

  /**
   * Clear pending repository creation for user
   */
  static clearPendingRepoCreation(userId: number): void {
    CallbackQueryHandler.pendingRepoCreations.delete(userId);
  }
}
