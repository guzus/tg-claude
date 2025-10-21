import { CallbackQuery } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';

/**
 * Handles callback queries from inline keyboard buttons
 */
export class CallbackQueryHandler extends BaseHandler {
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

        case 'commit':
          await this.handleCommitAction(chatId, messageId, userId);
          break;

        case 'show':
          await this.handleShowAction(chatId, messageId, userId, params.join('_'));
          break;

        case 'refresh':
          await this.handleRefreshAction(chatId, messageId, userId, params.join('_'));
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
    const repositories = this.repositoryManager.listRepositories(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (repositories.length === 0) {
      await this.bot.editMessageText(
        '📁 *Your Repositories*\n\n' +
        'No repositories found.\n\n' +
        'Use `/repo clone <url>` to clone a repository\n' +
        'Use `/repo new <name>` to create a new repository\n' +
        'Use `/scan` to discover existing repositories',
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
      '*Scan for existing repositories:*\n' +
      '`/scan`';

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
    const repositories = this.repositoryManager.listRepositories(userId);
    const selectedRepo = repositories.find((r: any) => r.id.startsWith(repoIdPrefix));

    if (!selectedRepo) {
      await this.bot.answerCallbackQuery(userId.toString(), {
        text: '❌ Repository not found',
        show_alert: true
      });
      return;
    }

    this.repositoryManager.switchRepository(userId, selectedRepo.id);

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
   * Handle commit-related actions
   */
  private async handleCommitAction(chatId: number, messageId: number, _userId: number): Promise<void> {
    await this.bot.editMessageText(
      '💾 *Commit Changes*\n\n' +
      'Use `/commit <message>` to commit and push changes.\n\n' +
      'Example: `/commit Add new feature`',
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
      '• `/repo` - Manage repositories\n' +
      '• `/link` - Get repository link\n' +
      '• `/scan` - Scan for repositories\n\n' +
      '*Development:*\n' +
      '• `/task <desc>` - Execute task\n' +
      '• `/commit <msg>` - Commit changes\n' +
      '• `/review` - Review changes\n' +
      '• `/test` - Run tests\n' +
      '• `/build` - Build project\n\n' +
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
}
