import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ClaudeTaskWithStreaming, TaskStatus } from '../../../types';
import { formatDuration } from '../../../utils/time';

/**
 * Discord-specific UI helpers for building embeds and components
 */
export class DiscordUIHelpers {
  /**
   * Create a help embed
   */
  static createHelpEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Claude Code Bot')
      .setDescription('Send any message to execute as a Claude task in this channel\'s workspace.')
      .addFields(
        { name: 'Commands', value: [
          '`/help` - Show this message',
          '`/status` - Show active tasks',
          '`/cancel <task_id>` - Cancel a task',
          '`/version` - Show bot version',
          '`/ralph <task>` - Start a Ralph loop',
          '`/repo [status|remotes|path]` - Repo info for this channel',
          '`/repo_new <name> [visibility]` - Create GitHub repo from this workspace',
          '`/config` - Show channel config',
          '`/ai <provider>` - Switch AI provider',
          '`/model <slot> <model>` - Set model for a slot',
          '`/mcp` - Manage MCP servers',
          '`/plugin` - Manage Claude plugins',
          '`/whoami` - Show identity and workspace',
        ].join('\n') },
        { name: 'Usage', value: 'Simply type your request and the bot will execute it using Claude Code.' }
      )
      .setFooter({ text: 'Each channel has its own workspace folder' });
  }

  /**
   * Create a status embed for a running task
   */
  static createTaskStatusEmbed(
    task: ClaudeTaskWithStreaming,
    elapsed: number,
    provider: string = 'Claude'
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(0xFFA500)
      .setTitle('Running Task')
      .addFields(
        { name: 'Task ID', value: `\`${task.id}\``, inline: true },
        { name: 'Elapsed', value: formatDuration(elapsed), inline: true },
        { name: 'Provider', value: provider, inline: true }
      );

    // Add current action if available
    if (task.currentAction) {
      embed.addFields({ name: 'Current Action', value: task.currentAction.title });
    }

    // Add recent actions
    if (task.actions && task.actions.length > 0) {
      const recentActions = task.actions.slice(-5).map(a => `- ${a.title}`).join('\n');
      embed.addFields({ name: 'Recent Actions', value: recentActions || 'None' });
    }

    return embed;
  }

  /**
   * Create a completion embed
   */
  static createCompletionEmbed(
    task: ClaudeTaskWithStreaming,
    success: boolean,
    executionTime: number,
    provider: string = 'Claude',
    gitSummary?: string
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(success ? 0x00FF00 : 0xFF0000)
      .setTitle(success ? 'Task Completed' : 'Task Failed')
      .addFields(
        { name: 'Duration', value: formatDuration(executionTime), inline: true },
        { name: 'Provider', value: provider, inline: true }
      );

    if (task.costUsd && task.costUsd > 0) {
      embed.addFields({ name: 'Cost', value: `$${task.costUsd.toFixed(2)}`, inline: true });
    }

    if (gitSummary) {
      embed.addFields({ name: 'Git', value: gitSummary, inline: false });
    }

    // Add answer preview if available
    const completedEvent = task.events?.find(e => e.type === 'completed');
    if (completedEvent && completedEvent.type === 'completed' && completedEvent.answer) {
      const answer = completedEvent.answer;
      const maxPreviewLength = 3800;
      const preview = answer.length > maxPreviewLength
        ? answer.substring(0, maxPreviewLength) + '...'
        : answer;
      embed.setDescription(preview);
    }

    return embed;
  }

  /**
   * Create cancel button row
   */
  static createTaskControlButtons(taskId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`cancel_task:${taskId}`)
          .setLabel('Cancel')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑'),
        new ButtonBuilder()
          .setCustomId(`view_log:${taskId}`)
          .setLabel('View Log')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋')
      );
  }

  /**
   * Create view log button
   */
  static createViewLogButton(taskId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`view_log:${taskId}`)
          .setLabel('View Log')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋')
      );
  }

  /**
   * Get status emoji
   */
  static getStatusEmoji(status: TaskStatus): string {
    switch (status) {
      case TaskStatus.PENDING: return '⏳';
      case TaskStatus.RUNNING: return '🔄';
      case TaskStatus.COMPLETED: return '✅';
      case TaskStatus.FAILED: return '❌';
      case TaskStatus.CANCELLED: return '🚫';
      case TaskStatus.TIMEOUT: return '⏰';
      default: return '❓';
    }
  }

  /**
   * Sanitize channel name for filesystem use
   */
  static sanitizeChannelName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_').toLowerCase();
  }
}
