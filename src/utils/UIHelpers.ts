import { InlineKeyboardMarkup, InlineKeyboardButton } from 'node-telegram-bot-api';
import { Repository } from '../types';

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
   * Creates an inline keyboard for repository list
   */
  static createRepositoryListKeyboard(
    repositories: Repository[],
    currentRepoId: string | null
  ): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [];

    repositories.forEach((repo) => {
      const isCurrent = repo.id === currentRepoId;
      const typeEmoji = this.getRepoTypeEmoji(repo.type);
      const prefix = isCurrent ? '▶️ ' : '';

      buttons.push([
        {
          text: `${prefix}${typeEmoji} ${repo.name}`,
          callback_data: `repo_select_${repo.id.substring(0, 8)}`
        }
      ]);
    });

    // Add action buttons at the bottom
    buttons.push([
      { text: '➕ Add New Repository', callback_data: 'repo_add_menu' }
    ]);

    buttons.push([
      { text: '🔙 Back to Main Menu', callback_data: 'main_menu' }
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
        { text: '🚀 Run Task', callback_data: 'task_menu' },
        { text: '💾 Commit', callback_data: 'commit_menu' }
      ]);
    }

    buttons.push([
      { text: '❓ Help', callback_data: 'show_help' }
    ]);

    return { inline_keyboard: buttons };
  }

  /**
   * Creates repository action menu
   */
  static createRepoActionMenu(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: '📋 List Repositories', callback_data: 'repo_list' },
          { text: '➕ Add Repository', callback_data: 'repo_add_menu' }
        ],
        [
          { text: '🔗 Link Repository', callback_data: 'repo_link' },
          { text: '📂 Current Repository', callback_data: 'repo_current' }
        ],
        [
          { text: '🔙 Back to Main Menu', callback_data: 'main_menu' }
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
    let cleanUrl = gitUrl.replace(/https:\/\/[^@]+@/, 'https://');

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
      return '\n\n━━━━━━━━━━━━━━━━━━\n📂 *No repository selected*';
    }

    const webUrl = this.convertGitUrlToWeb(currentRepo.gitUrl);
    const typeEmoji = this.getRepoTypeEmoji(currentRepo.type);

    // Escape special characters for Markdown
    const escapedName = this.escapeMarkdown(currentRepo.name);
    const escapedBranch = this.escapeMarkdown(currentRepo.branch || 'main');
    const escapedPath = this.escapeMarkdown(currentRepo.path);

    return (
      '\n\n━━━━━━━━━━━━━━━━━━\n' +
      `${typeEmoji} *${escapedName}*\n` +
      `🌿 ${escapedBranch} | ` +
      `${webUrl ? `[View on GitHub](${webUrl})` : escapedPath}`
    );
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
    return text.replace(/([_*\[\]`])/g, '\\$1');
  }

  /**
   * Truncates long text to fit Telegram's message limit
   */
  static truncateMessage(text: string, maxLength: number = 4096): string {
    if (text.length <= maxLength) return text;

    const truncated = text.substring(0, maxLength - 50);
    return truncated + '\n\n... (message truncated)';
  }
}
