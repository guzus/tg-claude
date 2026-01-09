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
import { PromptBuilder } from '../../../utils/PromptBuilder';
import { Repository, RepositoryType } from '../../../types';
import * as path from 'path';

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

      // Build enhanced prompt to align with Telegram workflow and include git instructions.
      const enhancedPrompt = await this.buildEnhancedPrompt(prompt, workingDir, safeChannelId);

      // Send initial status message
      const statusMsg = await msg.reply({
        embeds: [{
          color: 0xFFA500,
          title: 'Starting Task...',
          description: 'Initializing Claude Code...'
        }]
      });

      // Execute task
      const task = await this.executor.executeTask(
        safeUserId,
        safeChannelId,
        enhancedPrompt,
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
          let gitSummary: string | undefined;
          if (success) {
            try {
              const summaryParts: string[] = [];
              const commitHash = await this.executor.autoCommitChanges(workingDir);
              let shouldPush = false;

              if (commitHash) {
                summaryParts.push(`Committed \`${commitHash.substring(0, 7)}\``);
                shouldPush = true;
              } else {
                const hasUnpushedCommits = await this.executor.hasUnpushedCommits(workingDir);
                if (hasUnpushedCommits) {
                  shouldPush = true;
                }
              }

              if (shouldPush) {
                const pushResult = await this.executor.autoPushChanges(workingDir);
                if (pushResult === 'success') {
                  summaryParts.push('Pushed ✓');
                } else if (pushResult === 'no_remote') {
                  summaryParts.push('No remote');
                } else if (pushResult === 'no_changes') {
                  summaryParts.push('Nothing to push');
                } else {
                  summaryParts.push('Push failed');
                }
              }

              if (summaryParts.length > 0) {
                gitSummary = summaryParts.join(' · ');
              }
            } catch (error) {
              logger.error('Discord auto-commit/push failed', {
                taskId: task.id,
                error: getErrorMessage(error)
              });
            }
          }

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

  private async buildEnhancedPrompt(
    prompt: string,
    workingDir: string,
    channelKey: number
  ): Promise<string> {
    try {
      const [remoteUrl, branch] = await Promise.all([
        gitService.getRemoteUrl(workingDir),
        gitService.getCurrentBranch(workingDir)
      ]);

      const repo: Repository = {
        id: `discord_${channelKey}`,
        name: path.basename(workingDir),
        path: workingDir,
        type: RepositoryType.EXISTING,
        gitUrl: remoteUrl || undefined,
        branch: branch || undefined,
        createdAt: new Date(),
        lastUsed: new Date()
      };

      const context = this.conversationManager?.getContext(channelKey) || '';
      return PromptBuilder.buildEnhancedPrompt(prompt, repo, context);
    } catch (error) {
      logger.debug('Failed to build enhanced prompt for Discord task', {
        workingDir,
        error: getErrorMessage(error)
      });
      return prompt;
    }
  }
}
