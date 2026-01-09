import { InlineKeyboardMarkup, InlineKeyboardButton } from 'node-telegram-bot-api';
import { Repository, StreamAction, ClaudeTaskWithStreaming, McpServer } from '../../../types';
import { formatDuration } from '../../../utils/time';

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
    lines.push(`⏳ *${formatDuration(elapsed)}* · ${provider}`);

    // Get all action events (both started and completed)
    const actionEvents = task.events
      .filter((e): e is { type: 'action'; action: StreamAction; phase: 'started' | 'completed'; ok?: boolean; message?: string } =>
        e.type === 'action'
      )
      .slice(-5);

    if (actionEvents.length > 0 || task.currentAction) {
      lines.push('');

      // Show recent actions
      for (const event of actionEvents) {
        const icon = event.phase === 'completed'
          ? (event.ok === false ? '✗' : '✓')
          : '›';
        const actionTitle = this.formatAction(event.action);
        lines.push(`${icon} ${actionTitle}`);
      }

      // Current action (if different from last event)
      if (task.currentAction) {
        const lastEvent = actionEvents[actionEvents.length - 1];
        if (!lastEvent || lastEvent.action.id !== task.currentAction.id) {
          lines.push(`› ${this.formatAction(task.currentAction)}...`);
        }
      }
    } else {
      lines.push('');
      lines.push('_Starting..._');
    }

    return lines.join('\n');
  }

  /**
   * Creates MCP server list keyboard with remove buttons
   */
  static createMcpServerListKeyboard(
    servers: Record<string, McpServer>,
    showPresets: boolean = true
  ): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [];

    // List current servers with remove buttons
    for (const serverName of Object.keys(servers)) {
      buttons.push([
        { text: `🔌 ${serverName}`, callback_data: `mcp_info_${serverName}` },
        { text: '×', callback_data: `mcp_remove_${serverName}` }
      ]);
    }

    // Action row
    if (showPresets) {
      buttons.push([
        { text: '➕ Add Preset', callback_data: 'mcp_presets' },
        { text: '🗑️ Clear All', callback_data: 'mcp_clear' }
      ]);
    }

    return { inline_keyboard: buttons };
  }

  /**
   * Creates MCP presets selection keyboard
   */
  static createMcpPresetsKeyboard(
    presets: Record<string, { description: string }>,
    existingServers: string[] = []
  ): InlineKeyboardMarkup {
    const buttons: InlineKeyboardButton[][] = [];

    for (const [name, { description }] of Object.entries(presets)) {
      const isInstalled = existingServers.includes(name);
      const icon = isInstalled ? '✓' : '○';
      const shortDesc = description.length > 25 ? description.substring(0, 22) + '...' : description;

      buttons.push([{
        text: `${icon} ${name} - ${shortDesc}`,
        callback_data: isInstalled ? `mcp_info_${name}` : `mcp_add_${name}`
      }]);
    }

    buttons.push([{ text: '← Back', callback_data: 'mcp_list' }]);

    return { inline_keyboard: buttons };
  }

  /**
   * Creates MCP main menu keyboard (when no servers configured)
   */
  static createMcpEmptyKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [{ text: '➕ Add Preset', callback_data: 'mcp_presets' }]
      ]
    };
  }
}
