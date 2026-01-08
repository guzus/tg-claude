import { InlineKeyboardMarkup, InlineKeyboardButton } from 'node-telegram-bot-api';
import { Repository, StreamAction, ClaudeTaskWithStreaming } from '../types';

export class UIHelpers {
  /**
   * Creates a repository dashboard widget with current repo info and action buttons
   */
  static createRepositoryDashboard(
    currentRepo: Repository | null,
    showSwitchButton: boolean = true
  ): { message: string; keyboard: InlineKeyboardMarkup } {
    if (!currentRepo) {
      return {
        message: '📂 *Current Repository:* None\n\nUse /repo to set up a repository.',
        keyboard: {
          inline_keyboard: [
            [
              { text: '📁 Setup Repository', callback_data: 'repo_menu' }
            ]
          ]
        }
      };
    }

    const webUrl = this.convertGitUrlToWeb(currentRepo.gitUrl);
    const repoType = this.getRepoTypeEmoji(currentRepo.type);

    // Escape special characters for Markdown
    const escapedName = this.escapeMarkdown(currentRepo.name);
    const escapedBranch = this.escapeMarkdown(currentRepo.branch || 'main');
    const escapedPath = this.escapeMarkdown(currentRepo.path);

    const message =
      `📂 *Current Repository*\n\n` +
      `${repoType} *${escapedName}*\n` +
      `🌿 Branch: \`${escapedBranch}\`\n` +
      `📍 Path: \`${escapedPath}\``;

    const buttons: InlineKeyboardButton[][] = [];

    // First row: Open in browser button (always show if we have a git URL)
    if (webUrl) {
      buttons.push([
        { text: '🔗 Open in Browser', url: webUrl }
      ]);

      // If we have a URL, show switch and refresh on same row
      if (showSwitchButton) {
        buttons.push([
          { text: '🔄 Switch Repository', callback_data: 'repo_switch_menu' },
          { text: '♻️ Refresh', callback_data: 'refresh_dashboard' }
        ]);
      }
    } else {
      // No URL - show switch and refresh buttons, plus a setup remote button
      if (showSwitchButton) {
        buttons.push([
          { text: '🔄 Switch Repository', callback_data: 'repo_switch_menu' },
          { text: '♻️ Refresh', callback_data: 'refresh_dashboard' }
        ]);
      }
    }

    return {
      message,
      keyboard: { inline_keyboard: buttons }
    };
  }

  /**
   * Creates an inline keyboard for repository list - minimal design
   */
  static createRepositoryListKeyboard(
    repositories: Repository[],
    currentRepoId: string | null
  ): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [];

    repositories.forEach((repo) => {
      const isCurrent = repo.id === currentRepoId;
      const prefix = isCurrent ? '▸ ' : '';

      buttons.push([
        {
          text: `${prefix}${repo.name}`,
          callback_data: `repo_select_${repo.id.substring(0, 8)}`
        },
        {
          text: '×',
          callback_data: `repo_delete_${repo.id.substring(0, 8)}`
        }
      ]);
    });

    // Compact action row
    buttons.push([
      { text: 'Clone', callback_data: 'repo_clone_menu' },
      { text: 'New', callback_data: 'repo_new_menu' }
    ]);

    return { inline_keyboard: buttons };
  }

  /**
   * Creates main menu keyboard
   */
  static createMainMenuKeyboard(hasCurrentRepo: boolean): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [
      [
        { text: '📁 Repository', callback_data: 'repo_menu' },
        { text: '📊 Status', callback_data: 'status_menu' }
      ],
      [
        { text: '📋 Logs', callback_data: 'show_logs' },
        { text: '⚙️ Limits', callback_data: 'show_limits' }
      ]
    ];

    if (hasCurrentRepo) {
      buttons.unshift([
        { text: '🚀 Run Task', callback_data: 'task_menu' }
      ]);
    }

    buttons.push([
      { text: '❓ Help', callback_data: 'show_help' }
    ]);

    return { inline_keyboard: buttons };
  }

  /**
   * Creates repository action menu - minimal modern design
   */
  static createRepoActionMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'List', callback_data: 'repo_list' },
          { text: 'Clone', callback_data: 'repo_clone_menu' },
          { text: 'New', callback_data: 'repo_new_menu' }
        ]
      ]
    };
  }

  /**
   * Converts git URL to web URL (removes authentication tokens)
   */
  static convertGitUrlToWeb(gitUrl: string | undefined): string | null {
    if (!gitUrl) return null;

    // Remove any authentication tokens from HTTPS URLs
    // Pattern: https://token@github.com or https://user:token@github.com
    const cleanUrl = gitUrl.replace(/https:\/\/[^@]+@/, 'https://');

    // Handle github.com URLs
    if (cleanUrl.includes('github.com')) {
      return cleanUrl
        .replace('git@github.com:', 'https://github.com/')
        .replace('.git', '');
    }

    // Handle gitlab.com URLs
    if (cleanUrl.includes('gitlab.com')) {
      return cleanUrl
        .replace('git@gitlab.com:', 'https://gitlab.com/')
        .replace('.git', '');
    }

    // Handle bitbucket.org URLs
    if (cleanUrl.includes('bitbucket.org')) {
      return cleanUrl
        .replace('git@bitbucket.org:', 'https://bitbucket.org/')
        .replace('.git', '');
    }

    // If already HTTPS, just remove .git
    if (cleanUrl.startsWith('https://')) {
      return cleanUrl.replace('.git', '');
    }

    return null;
  }

  /**
   * Gets emoji for repository type
   */
  static getRepoTypeEmoji(type: string): string {
    switch (type) {
      case 'CLONED':
        return '📥';
      case 'NEW':
        return '✨';
      case 'EXISTING':
        return '📂';
      default:
        return '📁';
    }
  }

  /**
   * Creates a persistent footer with repository info for long messages
   */
  static createRepositoryFooter(currentRepo: Repository | null): string {
    if (!currentRepo) {
      return '';
    }

    const webUrl = this.convertGitUrlToWeb(currentRepo.gitUrl);

    // Escape special characters for Markdown
    const escapedName = this.escapeMarkdown(currentRepo.name);
    const escapedBranch = this.escapeMarkdown(currentRepo.branch || 'main');

    // Clean, minimal footer
    const repoLink = webUrl ? `[${escapedName}](${webUrl})` : escapedName;
    return `\n─────────\n📂 ${repoLink} · \`${escapedBranch}\``;
  }

  /**
   * Formats duration in seconds to a human-readable format with minutes
   * @param seconds - Duration in seconds
   * @returns Formatted string like "5m 30s" or "45s"
   */
  static formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (remainingSeconds === 0) {
      return `${minutes}m`;
    }

    return `${minutes}m ${remainingSeconds}s`;
  }

  /**
   * Escapes special Markdown characters for Telegram
   * @param text - Text to escape
   * @returns Escaped text safe for Telegram Markdown
   */
  static escapeMarkdown(text: string): string {
    if (!text) return text;
    // Escape special characters used in Telegram Markdown
    return text.replace(/([_*[\]`])/g, '\\$1');
  }

  /**
   * Truncates long text to fit Telegram's message limit
   */
  static truncateMessage(text: string, maxLength: number = 4096): string {
    if (text.length <= maxLength) return text;

    const truncated = text.substring(0, maxLength - 50);
    return truncated + '\n\n... (message truncated)';
  }

  /**
   * Formats a stream action for display
   */
  static formatAction(action: StreamAction): string {
    let title = action.title;

    // Truncate long titles
    if (title.length > 60) {
      title = title.substring(0, 57) + '...';
    }

    // Escape markdown special characters
    title = title.replace(/[_*`[\]]/g, '\\$&');

    return title;
  }

  /**
   * Build a status message from streaming events (reusable across handlers)
   */
  static buildStreamingStatusMessage(
    task: ClaudeTaskWithStreaming,
    elapsed: number,
    provider: string = 'Claude',
    extraHeader?: string
  ): string {
    const lines: string[] = [];

    // Clean header with time and provider
    if (extraHeader) {
      lines.push(extraHeader);
    }
    lines.push(`⏳ *${this.formatDuration(elapsed)}* · ${provider}`);

    // Recent completed actions (last 3, more compact)
    const recentEvents = task.events
      .filter((e): e is { type: 'action'; action: StreamAction; phase: 'completed'; ok?: boolean; message?: string } =>
        e.type === 'action' && e.phase === 'completed'
      )
      .slice(-3);

    if (recentEvents.length > 0 || task.currentAction) {
      lines.push('');

      // Show recent actions
      for (const event of recentEvents) {
        const icon = event.ok === false ? '✗' : '›';
        const actionTitle = this.formatAction(event.action);
        lines.push(`${icon} ${actionTitle}`);
      }

      // Current action (if any)
      if (task.currentAction) {
        lines.push(`› ${this.formatAction(task.currentAction)}...`);
      }
    } else {
      lines.push('');
      lines.push('_Starting..._');
    }

    return lines.join('\n');
  }
}
