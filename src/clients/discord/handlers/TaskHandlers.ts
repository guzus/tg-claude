import { Message, TextChannel } from 'discord.js';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { ConversationManager } from '../../../services/ConversationManager';
import { DiscordUIHelpers } from '../utils/UIHelpers';
import { TaskStatus, ClaudeTaskWithStreaming } from '../../../types';
import { logger } from '../../../utils/logger';
import { toSafeDiscordId } from '../utils/ids';
import { getErrorMessage } from '../../../utils/errors';
import { gitService } from '../../../services/GitService';

/**
 * Handlers for task execution in Discord.
 * Uses channel-based workspace (mono-repo per channel).
 */
export class TaskHandlers extends BaseHandler {
  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    conversationManager?: ConversationManager
  ) {
    super(executor, rateLimiter, auditLogger, conversationManager);
  }

  /**
   * Handle plain message as a Claude task
   */
  async handleMessage(msg: Message): Promise<void> {
    // Skip bot messages
    if (msg.author.bot) return;

    // Skip messages starting with /
    if (msg.content.startsWith('/')) return;

    const botUser = msg.client.user;
    if (!botUser) return;

    const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const mentionPattern = new RegExp(`<@!?${botUser.id}>`, 'g');
    const usernamePattern = new RegExp(`@${escapeRegex(botUser.username)}\\b`, 'gi');
    const globalNamePattern = botUser.globalName
      ? new RegExp(`@${escapeRegex(botUser.globalName)}\\b`, 'gi')
      : null;

    // Only respond when explicitly mentioned (or literal @username)
    const hasMention = msg.mentions.has(botUser, { ignoreRoles: true, ignoreEveryone: true })
      || mentionPattern.test(msg.content)
      || usernamePattern.test(msg.content)
      || (globalNamePattern ? globalNamePattern.test(msg.content) : false);
    if (!hasMention) return;

    if (!(await this.checkAccess(msg))) return;

    const userId = msg.author.id;
    const channelId = msg.channelId;
    const channel = msg.channel as TextChannel;
    const channelName = channel.name || 'unknown';
    let prompt = msg.content.replace(mentionPattern, '');
    prompt = prompt.replace(usernamePattern, '');
    if (globalNamePattern) {
      prompt = prompt.replace(globalNamePattern, '');
    }
    prompt = prompt.trim();
    if (!prompt) return;
    const startTime = Date.now();
    const safeUserId = toSafeDiscordId(userId);
    const safeChannelId = toSafeDiscordId(channelId);

    // Get channel workspace (mono-repo per channel)
    const workingDir = this.getChannelWorkspace(channelId, channelName);

    try {
      await this.ensureGitAuth(workingDir);

      // Add to conversation context
      this.conversationManager?.addUserMessage(safeChannelId, prompt);

      // Send initial status message
      const statusMsg = await msg.reply({
        embeds: [{
          color: 0xFFA500,
          title: 'Starting Task...',
          description: 'Initializing Claude Code...'
        }]
      });

      // Execute task
      const task = this.executor.startTask(
        safeUserId,
        safeChannelId,
        prompt,
        { workingDir }
      );

      // Poll for updates
      const updateInterval = setInterval(async () => {
        const currentTask = this.executor.getTask(task.id) as ClaudeTaskWithStreaming | undefined;
        if (!currentTask) {
          clearInterval(updateInterval);
          return;
        }

        if (currentTask.status === TaskStatus.RUNNING) {
          const elapsed = Math.round((Date.now() - startTime) / 1000);

          const embed = DiscordUIHelpers.createTaskStatusEmbed(currentTask, elapsed);
          const buttons = DiscordUIHelpers.createTaskControlButtons(task.id);

          try {
            await statusMsg.edit({
              embeds: [embed],
              components: [buttons]
            });
          } catch (error) {
            logger.debug('Failed to update Discord message', {
              taskId: task.id,
              error: getErrorMessage(error)
            });
          }
        } else {
          // Task completed
          clearInterval(updateInterval);

          const executionTime = currentTask.endTime
            ? Math.round((currentTask.endTime.getTime() - currentTask.startTime.getTime()) / 1000)
            : Math.round((Date.now() - startTime) / 1000);

          const success = currentTask.status === TaskStatus.COMPLETED;
          // Note: Commits are now handled by Claude using the /commit-commands:commit skill
          const gitSummary: string | undefined = undefined;

          const embed = DiscordUIHelpers.createCompletionEmbed(
            currentTask as ClaudeTaskWithStreaming,
            success,
            executionTime,
            'Claude',
            gitSummary
          );
          const buttons = DiscordUIHelpers.createViewLogButton(task.id);

          try {
            await statusMsg.edit({
              embeds: [embed],
              components: [buttons]
            });
          } catch (error) {
            logger.error('Failed to update completion message', {
              taskId: task.id,
              error: getErrorMessage(error)
            });
          }

          // Log audit entry
          this.auditLogger.logCommand({
            userId: safeUserId,
            username: msg.author.username,
            command: prompt.substring(0, 100),
            taskId: task.id,
            success,
            executionTime,
            error: !success ? currentTask.errorOutput : undefined,
            platform: 'discord'
          });
        }
      }, 2000); // Update every 2 seconds

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = getErrorMessage(error);

      await msg.reply({
        embeds: [{
          color: 0xFF0000,
          title: 'Error',
          description: errorMessage
        }]
      });

      this.auditLogger.logCommand({
        userId: safeUserId,
        username: msg.author.username,
        command: prompt.substring(0, 100),
        success: false,
        executionTime,
        error: errorMessage,
        platform: 'discord'
      });

      logger.error('Discord task execution failed', {
        userId,
        channelId,
        error: errorMessage
      });
    }
  }

  private async ensureGitAuth(workingDir: string): Promise<void> {
    await gitService.ensureAuthRemote(workingDir);
  }
}
