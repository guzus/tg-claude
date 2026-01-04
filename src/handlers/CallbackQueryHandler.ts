import { CallbackQuery, InlineKeyboardButton } from 'node-telegram-bot-api';
import { readFileSync } from 'fs';
import { BaseHandler } from './BaseHandler';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';
import { RepositoryType } from '../types';
import { stateManager, PendingRepoCreation } from '../services/StateManager';
import { BeastModeExecutor } from '../services/BeastModeExecutor';
import { promisify } from 'util';
import { exec } from 'child_process';
import path from 'path';

const execAsync = promisify(exec);

export class CallbackQueryHandler extends BaseHandler {
  private beastModeExecutor: BeastModeExecutor | null = null;

  setBeastModeExecutor(executor: BeastModeExecutor): void {
    this.beastModeExecutor = executor;
  }

  async handleCallbackQuery(query: CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const messageId = query.message?.message_id;
    const data = query.data;

    if (!chatId || !messageId || !data) return;

    await this.bot.answerCallbackQuery(query.id);

    try {
      const [action, ...params] = data.split('_');
      const subAction = params.join('_');

      const handlers: Record<string, () => Promise<void>> = {
        main: () => this.showMainMenu(chatId, messageId, userId),
        repo: () => this.handleRepoAction(chatId, messageId, userId, subAction),
        status: () => this.showStatusMenu(chatId, messageId),
        task: () => this.showTaskHelp(chatId, messageId),
        show: () => this.handleShowAction(chatId, messageId, subAction),
        refresh: () => this.handleRefreshAction(chatId, messageId, userId, subAction),
        create: () => this.handleCreateRepoAction(chatId, messageId, userId, params),
        new: () => this.handleNewRepoAction(chatId, messageId, userId, params),
        newrepo: () => this.handleNewRepoCommandCallback(chatId, messageId, userId, subAction),
        config: () => this.handleConfigAction(chatId, messageId, userId, subAction),
        cancel: () => this.handleCancelTask(chatId, messageId, userId, subAction),
        view: () => this.handleViewAction(chatId, userId, subAction),
        beast: () => this.handleBeastModeAction(chatId, messageId, userId, subAction),
        ai: () => this.handleAiSwitch(chatId, messageId, userId, subAction)
      };

      const handler = handlers[action];
      if (handler) {
        await handler();
      } else {
        await this.bot.sendMessage(chatId, 'Unknown action');
      }
    } catch (error) {
      logger.error('Callback query error', { error: error instanceof Error ? error.message : String(error), userId, data });
      await this.bot.sendMessage(chatId, 'An error occurred. Please try again.');
    }
  }

  private async showMainMenu(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    await this.editMessage(chatId, messageId, '*Claude Code Remote Control*\n\nChoose an action:', UIHelpers.createMainMenuKeyboard(!!currentRepo));
  }

  private async handleRepoAction(chatId: number, messageId: number, userId: number, subAction: string): Promise<void> {
    const actions: Record<string, () => Promise<void>> = {
      menu: () => this.showRepoMenu(chatId, messageId),
      list: () => this.showRepoList(chatId, messageId, userId),
      current: () => this.showCurrentRepo(chatId, messageId, userId),
      switch_menu: () => this.showRepoList(chatId, messageId, userId),
      add_menu: () => this.showAddRepoInstructions(chatId, messageId),
      clone_menu: () => this.showCloneInstructions(chatId, messageId),
      new_menu: () => this.showNewRepoInstructions(chatId, messageId),
      link: () => this.showRepoLink(chatId, messageId, userId)
    };

    if (actions[subAction]) {
      await actions[subAction]();
    } else if (subAction.startsWith('select_')) {
      await this.selectRepository(chatId, messageId, userId, subAction.replace('select_', ''));
    } else if (subAction.startsWith('delete_')) {
      await this.deleteRepository(chatId, messageId, userId, subAction.replace('delete_', ''));
    }
  }

  private async showRepoMenu(chatId: number, messageId: number): Promise<void> {
    await this.editMessage(chatId, messageId, '*Repository Management*\n\nChoose an action:', UIHelpers.createRepoActionMenu());
  }

  private async showRepoList(chatId: number, messageId: number, userId: number): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (repositories.length === 0) {
      await this.editMessage(chatId, messageId,
        `No repositories yet\n\n` +
        `\`/repo clone owner/repo\`\n` +
        `\`/repo new name\``,
        UIHelpers.createRepoActionMenu()
      );
      return;
    }

    // Build compact list
    const lines: string[] = [];
    for (const repo of repositories) {
      const isCurrent = currentRepo?.id === repo.id;
      const escapedName = UIHelpers.escapeMarkdown(repo.name);
      const branch = repo.branch ? UIHelpers.escapeMarkdown(repo.branch) : 'main';
      const marker = isCurrent ? '▸ ' : '  ';
      lines.push(`${marker}*${escapedName}* · \`${branch}\``);
    }

    await this.editMessage(chatId, messageId,
      lines.join('\n'),
      UIHelpers.createRepositoryListKeyboard(repositories, currentRepo?.id || null)
    );
  }

  private async showCurrentRepo(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    const { message, keyboard } = UIHelpers.createRepositoryDashboard(currentRepo || null);
    await this.editMessage(chatId, messageId, message, keyboard);
  }

  private async showAddRepoInstructions(chatId: number, messageId: number): Promise<void> {
    await this.editMessage(chatId, messageId,
      '*Add New Repository*\n\n' +
      '*Clone:* `/repo clone <git-url>`\n' +
      '*Create:* `/repo new <name>`\n' +
      '*Add existing:* `/repo add <path>`',
      { inline_keyboard: [[{ text: 'Back', callback_data: 'repo_menu' }]] }
    );
  }

  private async showCloneInstructions(chatId: number, messageId: number): Promise<void> {
    await this.editMessage(chatId, messageId,
      `*Clone Repository*\n\n` +
      `\`/repo clone owner/repo\`\n` +
      `\`/repo clone https://github.com/...\``,
      { inline_keyboard: [[{ text: 'Back', callback_data: 'repo_list' }]] }
    );
  }

  private async showNewRepoInstructions(chatId: number, messageId: number): Promise<void> {
    await this.editMessage(chatId, messageId,
      `*Create Repository*\n\n` +
      `\`/repo new my-project\``,
      { inline_keyboard: [[{ text: 'Back', callback_data: 'repo_list' }]] }
    );
  }

  private async showRepoLink(chatId: number, messageId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.editMessage(chatId, messageId, 'No repository selected.\n\nUse /repo to set up a repository.',
        { inline_keyboard: [[{ text: 'Setup Repository', callback_data: 'repo_menu' }]] });
      return;
    }

    const webUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);
    const msg = webUrl
      ? `*Repository Link*\n\n*Name:* ${currentRepo.name}\n*Branch:* ${currentRepo.branch || 'main'}\n*URL:* [Open](${webUrl})`
      : `*Repository Info*\n\n*Name:* ${currentRepo.name}\n*Path:* \`${currentRepo.path}\``;

    const keyboard = webUrl
      ? { inline_keyboard: [[{ text: 'Open in Browser', url: webUrl }], [{ text: 'Back', callback_data: 'repo_current' }]] }
      : { inline_keyboard: [[{ text: 'Back', callback_data: 'repo_current' }]] };

    await this.editMessage(chatId, messageId, msg, keyboard);
  }

  private async selectRepository(chatId: number, messageId: number, userId: number, repoIdPrefix: string): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const selectedRepo = repositories.find(r => r.id.startsWith(repoIdPrefix));

    if (!selectedRepo) return;

    await this.repositoryManager.switchRepository(userId, selectedRepo.id);
    await this.updatePinnedRepositoryInfo(chatId, userId);

    const { message, keyboard } = UIHelpers.createRepositoryDashboard(selectedRepo);
    await this.editMessage(chatId, messageId, `Switched!\n\n${message}`, keyboard);
  }

  private async deleteRepository(chatId: number, messageId: number, userId: number, repoIdPrefix: string): Promise<void> {
    const repositories = await this.repositoryManager.listRepositories(userId);
    const repoToDelete = repositories.find(r => r.id.startsWith(repoIdPrefix));

    if (!repoToDelete) return;

    await this.repositoryManager.deleteRepository(userId, repoToDelete.id);
    await this.updatePinnedRepositoryInfo(chatId, userId);

    const msg = repoToDelete.type !== RepositoryType.EXISTING
      ? `Deleted: *${UIHelpers.escapeMarkdown(repoToDelete.name)}*\n\nDirectory removed.`
      : `Removed: *${UIHelpers.escapeMarkdown(repoToDelete.name)}*\n\nDirectory kept.`;

    await this.editMessage(chatId, messageId, msg, {
      inline_keyboard: [
        [{ text: 'View Repositories', callback_data: 'repo_list' }],
        [{ text: 'Main Menu', callback_data: 'main_menu' }]
      ]
    });
  }

  private async showStatusMenu(chatId: number, messageId: number): Promise<void> {
    const activeTaskCount = this.executor.getTaskCount();
    await this.editMessage(chatId, messageId,
      `*Status*\n\nActive tasks: ${activeTaskCount}\n\nUse /status for details`,
      { inline_keyboard: [[{ text: 'Back', callback_data: 'main_menu' }]] }
    );
  }

  private async showTaskHelp(chatId: number, messageId: number): Promise<void> {
    await this.editMessage(chatId, messageId,
      '*Run Task*\n\nUse `/task <description>` to execute.\n\nExample: `/task add error handling`',
      { inline_keyboard: [[{ text: 'Back', callback_data: 'main_menu' }]] }
    );
  }

  private async handleShowAction(chatId: number, messageId: number, subAction: string): Promise<void> {
    if (subAction === 'help') {
      await this.editMessage(chatId, messageId,
        '*Help*\n\n' +
        '*Repository:* `/repo`\n' +
        '*Task:* `/task <desc>`\n' +
        '*Status:* `/status`\n' +
        '*Logs:* `/logs <id>`',
        { inline_keyboard: [[{ text: 'Back', callback_data: 'main_menu' }]] }
      );
    }
  }

  private async handleRefreshAction(chatId: number, messageId: number, userId: number, subAction: string): Promise<void> {
    if (subAction === 'dashboard') {
      const currentRepo = this.repositoryManager.getCurrentRepository(userId);
      if (currentRepo) {
        await this.repositoryManager.refreshRepository(userId, currentRepo.id);
      }
      await this.showCurrentRepo(chatId, messageId, userId);
    } else {
      await this.showMainMenu(chatId, messageId, userId);
    }
  }

  private async handleCreateRepoAction(chatId: number, messageId: number, userId: number, params: string[]): Promise<void> {
    const action = params[1];
    const workingDir = params.slice(2).join('_');

    if (action === 'skip') {
      await this.editMessage(chatId, messageId, 'Skipped. Changes remain committed locally.');
      return;
    }

    const isPrivate = action === 'private';
    await this.editMessage(chatId, messageId, 'Creating GitHub repository...');

    try {
      const originalName = path.basename(workingDir);
      const result = await this.executor.createGitHubRepository(workingDir, isPrivate);

      if (result === 'success') {
        const currentRepo = this.repositoryManager.getCurrentRepository(userId);
        if (currentRepo) await this.repositoryManager.refreshRepository(userId, currentRepo.id);

        await this.editMessage(chatId, messageId,
          `*GitHub Repository Created!*\n\nVisibility: ${isPrivate ? 'Private' : 'Public'}`,
          { inline_keyboard: [[{ text: 'View Repository', callback_data: 'repo_current' }]] }
        );
      } else if (result === 'already_exists') {
        stateManager.setPendingRepoCreation(userId, { workingDir, isPrivate, userId, chatId, originalName });
        await this.editMessage(chatId, messageId,
          `*Repository Name Exists*\n\n\`${originalName}\` already exists. Reply with a different name:`
        );
      } else {
        await this.editMessage(chatId, messageId, '*Failed*\n\nCheck gh CLI and GitHub authentication.');
      }
    } catch (error) {
      await this.editMessage(chatId, messageId, `*Error*\n\n${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleNewRepoAction(chatId: number, messageId: number, userId: number, params: string[]): Promise<void> {
    const action = params[1];
    const visibility = params[2];
    const repoId = params.slice(action === 'create' ? 3 : 2).join('_');

    const repositories = await this.repositoryManager.listRepositories(userId);
    const repo = repositories.find(r => r.id === repoId);

    if (!repo) {
      await this.editMessage(chatId, messageId, 'Repository not found.');
      return;
    }

    if (action === 'skip') {
      await this.editMessage(chatId, messageId, 'Repository ready!\n\nConnect to GitHub later with `/remote set <url>`');
      return;
    }

    if (action === 'link') {
      await this.editMessage(chatId, messageId, '*Link Repository*\n\nUse `/remote set owner/repo`');
      return;
    }

    if (action === 'create') {
      const isPrivate = visibility === 'private';
      await this.editMessage(chatId, messageId, 'Creating GitHub repository...');

      try {
        await execAsync('git init', { cwd: repo.path, timeout: 5000 });
        await execAsync('git config user.name "tg-claude"', { cwd: repo.path, timeout: 5000 });
        await execAsync('git config user.email "claude-code@remote.machine"', { cwd: repo.path, timeout: 5000 });

        try {
          await execAsync('git log -1', { cwd: repo.path, timeout: 5000 });
        } catch {
          await execAsync('git add . || true', { cwd: repo.path, timeout: 5000 });
          await execAsync('git commit -m "Initial commit" --allow-empty', { cwd: repo.path, timeout: 5000 });
        }

        const result = await this.executor.createGitHubRepository(repo.path, isPrivate);

        if (result === 'success') {
          await this.repositoryManager.refreshRepository(userId, repo.id);
          await this.editMessage(chatId, messageId,
            `*GitHub Repository Created!*\n\n\`${repo.name}\` - ${isPrivate ? 'Private' : 'Public'}`,
            { inline_keyboard: [[{ text: 'View Repository', callback_data: 'repo_current' }]] }
          );
        } else {
          await this.editMessage(chatId, messageId, `Repository \`${repo.name}\` ${result === 'already_exists' ? 'already exists' : 'creation failed'}`);
        }
      } catch (error) {
        await this.editMessage(chatId, messageId, `Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async handleRepoNameResponse(userId: number, chatId: number, newRepoName: string): Promise<void> {
    const pending = stateManager.getPendingRepoCreation(userId);
    if (!pending) return;

    stateManager.clearPendingRepoCreation(userId);

    if (!/^[a-zA-Z0-9_-]+$/.test(newRepoName)) {
      await this.bot.sendMessage(chatId, `Invalid name: \`${newRepoName}\`\n\nUse letters, numbers, hyphens, underscores only.`, { parse_mode: 'Markdown' });
      return;
    }

    const statusMsg = await this.bot.sendMessage(chatId, `Creating: \`${newRepoName}\`...`, { parse_mode: 'Markdown' });

    try {
      const result = await this.executor.createGitHubRepository(pending.workingDir, pending.isPrivate, newRepoName);

      if (result === 'success') {
        const currentRepo = this.repositoryManager.getCurrentRepository(userId);
        if (currentRepo) await this.repositoryManager.refreshRepository(userId, currentRepo.id);

        await this.bot.editMessageText(
          `*Created!*\n\n\`${newRepoName}\` - ${pending.isPrivate ? 'Private' : 'Public'}`,
          {
            chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: 'View Repository', callback_data: 'repo_current' }]] }
          }
        );
      } else {
        await this.bot.editMessageText(`\`${newRepoName}\` also exists. Try /repo again.`,
          { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
      }
    } catch (error) {
      await this.bot.editMessageText(`Error: ${error instanceof Error ? error.message : String(error)}`,
        { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
    }
  }

  private async handleConfigAction(chatId: number, messageId: number, _userId: number, subAction: string): Promise<void> {
    const configKeyboard = {
      inline_keyboard: [
        [{ text: 'View Config', callback_data: 'config_show' }, { text: 'Reset', callback_data: 'config_reset_confirm' }],
        [{ text: 'Git Settings', callback_data: 'config_git' }, { text: 'Preferences', callback_data: 'config_preferences' }],
        [{ text: 'Tech Stack', callback_data: 'config_techstack' }, { text: 'Limits', callback_data: 'config_limits' }],
        [{ text: 'Back', callback_data: 'main_menu' }]
      ]
    };

    const backToConfig = { inline_keyboard: [[{ text: 'Back', callback_data: 'config_menu' }]] };

    const actions: Record<string, () => Promise<void>> = {
      menu: () => this.editMessage(chatId, messageId, '*Configuration*\n\nManage settings:', configKeyboard),
      show: () => this.editMessage(chatId, messageId, '*Your Configuration*\n\nUse `/config show` for details.', backToConfig),
      git: () => this.editMessage(chatId, messageId,
        '*Git Settings*\n\n`/config set git.userName "Name"`\n`/config set git.userEmail "email"`',
        backToConfig
      ),
      techstack: () => this.editMessage(chatId, messageId,
        '*Tech Stack*\n\n' +
        'TypeScript: `bun` | `npm` | `pnpm` | `yarn`\n' +
        'Python: `uv` | `pip` | `poetry` | `pipenv`\n\n' +
        '`/config set techStack.typescript bun`\n' +
        '`/config set techStack.python uv`',
        backToConfig
      ),
      preferences: () => this.editMessage(chatId, messageId,
        '*Preferences*\n\n`/config set preferences.notifyOnTaskComplete true`',
        backToConfig
      ),
      limits: () => this.editMessage(chatId, messageId,
        '*Limits*\n\n`/config set limits.maxConcurrentTasks 5`\n`/config set limits.taskTimeoutMs 900000`',
        backToConfig
      ),
      reset_confirm: () => this.editMessage(chatId, messageId,
        '*Reset Configuration?*\n\nThis resets all settings to defaults.',
        { inline_keyboard: [[{ text: 'Yes, Reset', callback_data: 'config_reset_yes' }, { text: 'Cancel', callback_data: 'config_reset_no' }]] }
      ),
      reset_yes: () => this.editMessage(chatId, messageId, '*Configuration Reset*\n\nSettings restored to defaults.', backToConfig),
      reset_no: () => this.editMessage(chatId, messageId, '*Configuration*\n\nManage settings:', configKeyboard)
    };

    await (actions[subAction] || (() => this.bot.sendMessage(chatId, 'Use /config')))();
  }

  private async handleAiSwitch(chatId: number, messageId: number, userId: number, subAction: string): Promise<void> {
    if (!this.userConfigManager) {
      await this.bot.sendMessage(chatId, '❌ Config manager not available');
      return;
    }

    // Extract provider from "switch_<provider>"
    const newProvider = subAction.replace('switch_', '') as 'anthropic' | 'glm' | 'openrouter';
    await this.userConfigManager.updateConfig(userId, { aiProvider: { provider: newProvider } });

    const providerLabels: Record<string, string> = {
      anthropic: 'Claude',
      glm: 'GLM',
      openrouter: 'OpenRouter'
    };

    // Build buttons for other providers
    const buttons = (['anthropic', 'glm', 'openrouter'] as const)
      .filter(p => p !== newProvider)
      .map(p => ({ text: providerLabels[p], callback_data: `ai_switch_${p}` }));

    await this.editMessage(
      chatId,
      messageId,
      `*${providerLabels[newProvider]}*`,
      { inline_keyboard: [buttons] }
    );
  }

  private async handleCancelTask(chatId: number, messageId: number, userId: number, taskId: string): Promise<void> {
    const actualTaskId = taskId.replace('task:', '');
    const task = this.executor.getTask(actualTaskId);

    if (!task || task.userId !== userId) {
      await this.editMessage(chatId, messageId, 'Task not found or already completed.');
      return;
    }

    if (this.executor.cancelTask(actualTaskId)) {
      const duration = UIHelpers.formatDuration(Math.round((Date.now() - task.startTime.getTime()) / 1000));
      await this.editMessage(chatId, messageId, `*Task Cancelled*\n\nID: \`${actualTaskId.substring(0, 8)}\`\nTime: ${duration}`);
      logger.info('Task cancelled', { taskId: actualTaskId, userId });
    } else {
      await this.editMessage(chatId, messageId, 'Failed to cancel. Task may have completed.');
    }
  }

  private async handleViewAction(chatId: number, userId: number, subAction: string): Promise<void> {
    if (subAction.startsWith('download:')) {
      await this.handleDownloadLog(chatId, userId, subAction.replace('download:', ''));
    } else {
      await this.handleViewLog(chatId, userId, subAction);
    }
  }

  private async handleViewLog(chatId: number, userId: number, taskId: string): Promise<void> {
    const actualTaskId = taskId.replace('log:', '');
    const task = this.executor.getTask(actualTaskId);

    if (!task || task.userId !== userId) {
      await this.bot.sendMessage(chatId, 'Task not found');
      return;
    }

    // Get log content
    const logFilePath = this.executor.getTaskLogFilePath(actualTaskId);
    let rawLog: string;

    if (logFilePath) {
      rawLog = readFileSync(logFilePath, 'utf-8');
    } else {
      rawLog = (task.output || '') + (task.errorOutput ? `\n\n[STDERR]\n${task.errorOutput}` : '') || 'No output.';
    }

    // Parse the log to extract meaningful content
    const parsedLog = this.parseLogContent(rawLog);

    // Telegram message limit is 4096 chars, reserve some for formatting
    const MAX_LENGTH = 3800;
    const shortId = actualTaskId.substring(0, 8);

    if (parsedLog.length <= MAX_LENGTH) {
      await this.bot.sendMessage(chatId, `📋 *Log* \`${shortId}\`\n\n${parsedLog}`, {
        parse_mode: 'Markdown'
      });
    } else {
      const truncated = parsedLog.substring(parsedLog.length - MAX_LENGTH);
      await this.bot.sendMessage(
        chatId,
        `📋 *Log* \`${shortId}\` (last ${MAX_LENGTH} chars)\n\n${truncated}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{ text: '📥 Download Full Log', callback_data: `view_download:${actualTaskId}` }]]
          }
        }
      );
    }
  }

  private parseLogContent(rawLog: string): string {
    const lines: string[] = [];
    const jsonLines = rawLog.split('\n');

    for (const line of jsonLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Try to parse as JSON (Claude Code stream format)
      try {
        const event = JSON.parse(trimmed);

        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              lines.push(block.text);
            } else if (block.type === 'tool_use') {
              const toolName = block.name || 'tool';
              lines.push(`🔧 ${toolName}`);
            }
          }
        } else if (event.type === 'result') {
          if (event.result) {
            lines.push(`\n✅ Result: ${event.result.substring(0, 500)}${event.result.length > 500 ? '...' : ''}`);
          }
          if (event.total_cost_usd) {
            lines.push(`💰 Cost: $${event.total_cost_usd.toFixed(4)}`);
          }
        }
      } catch {
        // Not JSON - check if it's meaningful text (not file content dump)
        // Skip lines that look like file content with line numbers (e.g., "   123→")
        if (!/^\s*\d+→/.test(trimmed) && !trimmed.startsWith('<') && trimmed.length < 200) {
          // Skip common noise patterns
          if (!trimmed.includes('system-reminder') && !trimmed.includes('tool_use_result')) {
            lines.push(trimmed);
          }
        }
      }
    }

    return lines.join('\n') || 'No parsed content available.';
  }

  private async handleDownloadLog(chatId: number, userId: number, taskId: string): Promise<void> {
    const task = this.executor.getTask(taskId);

    if (!task || task.userId !== userId) {
      await this.bot.sendMessage(chatId, 'Task not found');
      return;
    }

    const logFilePath = this.executor.getTaskLogFilePath(taskId);
    let logContent: string;

    if (logFilePath) {
      logContent = readFileSync(logFilePath, 'utf-8');
    } else {
      logContent = (task.output || '') + (task.errorOutput ? `\n\n[STDERR]\n${task.errorOutput}` : '') || 'No output.';
    }

    await this.bot.sendDocument(chatId, Buffer.from(logContent), {
      caption: `Log: \`${taskId.substring(0, 8)}\``,
      parse_mode: 'Markdown'
    }, { filename: `task-${taskId.substring(0, 8)}.log`, contentType: 'text/plain' });
  }

  private async handleBeastModeAction(chatId: number, messageId: number, userId: number, subAction: string): Promise<void> {
    if (subAction.startsWith('stop:')) {
      const sessionId = subAction.replace('stop:', '');

      if (!this.beastModeExecutor) {
        await this.bot.sendMessage(chatId, 'Beast mode not available');
        return;
      }

      if (this.beastModeExecutor.stopSession(sessionId)) {
        await this.editMessage(chatId, messageId, '*Beast Mode Stopped*\n\nUncommitted changes remain in working directory.');
        logger.info('Beast mode stopped', { sessionId, userId });
      } else {
        await this.bot.sendMessage(chatId, 'Could not stop. Session may have completed.');
      }
    }
  }

  private async handleNewRepoCommandCallback(chatId: number, messageId: number, userId: number, subAction: string): Promise<void> {
    if (subAction === 'cancel') {
      await this.editMessage(chatId, messageId, 'Cancelled.');
      return;
    }

    // Format: public_reponame or private_reponame
    const parts = subAction.split('_');
    const visibility = parts[0] as 'public' | 'private';
    const name = parts.slice(1).join('_');

    if (!name || (visibility !== 'public' && visibility !== 'private')) {
      await this.bot.sendMessage(chatId, 'Invalid action');
      return;
    }

    const isPrivate = visibility === 'private';

    // Update message to show progress
    await this.editMessage(chatId, messageId, `Creating \`${name}\`...`);

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

        await this.editMessage(chatId, messageId,
          `✅ *Repository created!*\n\n` +
          `📁 ${escapedName}\n` +
          `${isPrivate ? '🔒 Private' : '🌐 Public'}\n` +
          `📂 \`${escapedPath}\``,
          { inline_keyboard: [[{ text: '📂 View', callback_data: 'repo_current' }]] }
        );
      } else if (result === 'already_exists') {
        await this.editMessage(chatId, messageId,
          `Repository \`${name}\` already exists on GitHub.\n\nTry a different name with /new_repo`
        );
      } else {
        await this.editMessage(chatId, messageId,
          `Failed to create GitHub repository.\n\nLocal repo created at \`${repo.path}\``
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.editMessage(chatId, messageId, `Error: ${errorMessage}`);
      logger.error('Failed to create new repo via callback', { userId, name, error: errorMessage });
    }
  }

  private async editMessage(chatId: number, messageId: number, text: string, keyboard?: { inline_keyboard: InlineKeyboardButton[][] }): Promise<void> {
    await this.bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // Static methods for backward compatibility
  static hasPendingRepoCreation(userId: number): boolean {
    return stateManager.hasPendingRepoCreation(userId);
  }

  static getPendingRepoCreation(userId: number) {
    return stateManager.getPendingRepoCreation(userId);
  }

  static setPendingRepoCreation(userId: number, data: PendingRepoCreation): void {
    stateManager.setPendingRepoCreation(userId, data);
  }

  static clearPendingRepoCreation(userId: number): void {
    stateManager.clearPendingRepoCreation(userId);
  }
}
