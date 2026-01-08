import { ChatInputCommandInteraction, ButtonInteraction } from 'discord.js';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { ConversationManager } from '../../../services/ConversationManager';
import { DiscordUIHelpers } from '../utils/UIHelpers';
import { TaskStatus } from '../../../types';
import * as fs from 'fs';
import * as path from 'path';
import { toSafeDiscordId } from '../utils/ids';

/**
 * Handlers for utility commands: /help, /status, /cancel, /version
 */
export class UtilityHandlers extends BaseHandler {
  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    conversationManager?: ConversationManager
  ) {
    super(executor, rateLimiter, auditLogger, conversationManager);
  }

  /**
   * Handle /help command
   */
  async handleHelp(interaction: ChatInputCommandInteraction): Promise<void> {
    const embed = DiscordUIHelpers.createHelpEmbed();
    await interaction.reply({ embeds: [embed] });
  }

  /**
   * Handle /status command
   */
  async handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const channelId = interaction.channelId;
    const safeChannelId = toSafeDiscordId(channelId);
    const activeTasks = this.executor.getActiveTasks();

    // Filter tasks for this channel
    const channelTasks = activeTasks.filter(task => task.chatId === safeChannelId);

    if (channelTasks.length === 0) {
      await interaction.reply({ content: 'No active tasks in this channel.', ephemeral: true });
      return;
    }

    const taskList = channelTasks.map(task => {
      const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000);
      const emoji = DiscordUIHelpers.getStatusEmoji(task.status);
      return `${emoji} \`${task.id}\` - ${DiscordUIHelpers.formatDuration(elapsed)}`;
    }).join('\n');

    await interaction.reply({
      content: `**Active Tasks (${channelTasks.length})**\n${taskList}`,
      ephemeral: true
    });
  }

  /**
   * Handle /cancel command
   */
  async handleCancel(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const taskId = interaction.options.getString('task_id', true);
    const task = this.executor.getTask(taskId);

    if (!task) {
      await interaction.reply({ content: `Task \`${taskId}\` not found.`, ephemeral: true });
      return;
    }

    if (task.status !== TaskStatus.RUNNING) {
      await interaction.reply({
        content: `Task \`${taskId}\` is not running (status: ${task.status}).`,
        ephemeral: true
      });
      return;
    }

    const cancelled = this.executor.cancelTask(taskId);
    if (cancelled) {
      await interaction.reply({ content: `Task \`${taskId}\` cancelled.` });
      this.auditLogger.logCommand({
        userId: toSafeDiscordId(interaction.user.id),
        username: interaction.user.username,
        command: `/cancel ${taskId}`,
        taskId,
        success: true
      });
    } else {
      await interaction.reply({ content: `Failed to cancel task \`${taskId}\`.`, ephemeral: true });
    }
  }

  /**
   * Handle /version command
   */
  async handleVersion(interaction: ChatInputCommandInteraction): Promise<void> {
    let commitHash = 'unknown';

    try {
      const versionPaths = ['/app/dist/VERSION', path.join(__dirname, '../../../../VERSION')];
      const versionFile = versionPaths.find(p => fs.existsSync(p));
      if (versionFile) {
        commitHash = fs.readFileSync(versionFile, 'utf-8').trim();
      } else {
        const { execSync } = await import('child_process');
        commitHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
      }
    } catch {
      // Ignore errors
    }

    const shortHash = commitHash.substring(0, 8);
    await interaction.reply({
      content: `**Claude Code Bot**\nCommit: \`${shortHash}\``,
      ephemeral: true
    });
  }

  /**
   * Handle button interactions
   */
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    const [action, ...params] = interaction.customId.split(':');

    switch (action) {
      case 'cancel_task': {
        const taskId = params[0];
        const cancelled = this.executor.cancelTask(taskId);
        if (cancelled) {
          await interaction.reply({ content: `Task \`${taskId}\` cancelled.` });
        } else {
          await interaction.reply({ content: `Failed to cancel task.`, ephemeral: true });
        }
        break;
      }
      case 'view_log': {
        const taskId = params[0];
        const output = this.executor.getTaskOutput(taskId);
        if (output) {
          // Truncate if too long
          const truncated = output.length > 1900
            ? output.substring(0, 1900) + '\n... (truncated)'
            : output;
          await interaction.reply({
            content: `\`\`\`\n${truncated}\n\`\`\``,
            ephemeral: true
          });
        } else {
          await interaction.reply({ content: 'No output available.', ephemeral: true });
        }
        break;
      }
      default:
        await interaction.reply({ content: 'Unknown action.', ephemeral: true });
    }
  }
}
