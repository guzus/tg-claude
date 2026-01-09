import { ChatInputCommandInteraction, ButtonInteraction, MessageFlags } from 'discord.js';
import { BaseHandler } from './BaseHandler';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { toSafeDiscordId } from '../utils/ids';
import { DiscordRalphLoopExecutor, DiscordRalphLoopStatus, DiscordRalphLoopConfig } from '../../../services/DiscordRalphLoopExecutor';
import { getErrorMessage } from '../../../utils/errors';
import { gitService } from '../../../services/GitService';
import { logger } from '../../../utils/logger';

export class RalphHandlers extends BaseHandler {
  private ralphExecutor: DiscordRalphLoopExecutor;
  private userConfigManager?: UserConfigManager;

  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    userConfigManager?: UserConfigManager
  ) {
    super(executor, rateLimiter, auditLogger);
    this.userConfigManager = userConfigManager;
    this.ralphExecutor = new DiscordRalphLoopExecutor(executor);
  }

  async handleRalph(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!(await this.checkAccess(interaction))) return;

    const task = interaction.options.getString('task', true).trim();
    const maxIterations = interaction.options.getInteger('max_iterations');
    const completionPromise = interaction.options.getString('promise');
    const timeoutMinutes = interaction.options.getInteger('timeout_minutes');

    const channel = interaction.channel;
    if (!channel || !channel.isTextBased()) {
      await interaction.reply({ content: 'This command must be used in a text channel.', flags: MessageFlags.Ephemeral });
      return;
    }

    const channelName = 'name' in channel ? channel.name : 'channel';
    const workingDir = this.getChannelWorkspace(interaction.channelId, channelName);

    const safeUserId = toSafeDiscordId(interaction.user.id);
    const safeChannelId = toSafeDiscordId(interaction.channelId);

    const existingSession = this.ralphExecutor.getUserSession(safeUserId);
    if (existingSession && existingSession.status === DiscordRalphLoopStatus.RUNNING) {
      await interaction.reply({
        content: `Ralph loop already running: ${existingSession.iteration}/${existingSession.config.maxIterations}.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const config: Partial<DiscordRalphLoopConfig> = {};
    if (maxIterations) config.maxIterations = Math.min(maxIterations, 100);
    if (completionPromise) config.completionPromise = completionPromise;
    if (timeoutMinutes) config.maxDurationMs = Math.min(timeoutMinutes, 120) * 60 * 1000;

    try {
      await this.ensureGitAuth(workingDir);

      const aiProvider = this.userConfigManager
        ? (await this.userConfigManager.getConfig(safeUserId)).aiProvider
        : undefined;

      await interaction.reply({
        content: 'Starting Ralph loop…',
        flags: MessageFlags.Ephemeral
      });

      await this.ralphExecutor.startSession(
        safeUserId,
        safeChannelId,
        channel,
        task,
        workingDir,
        config,
        aiProvider
      );

      this.auditLogger.logCommand({
        userId: safeUserId,
        username: interaction.user.username,
        command: '/ralph',
        success: true
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: `Failed to start Ralph loop: ${errorMessage}`,
          flags: MessageFlags.Ephemeral
        });
      } else {
        await interaction.reply({
          content: `Failed to start Ralph loop: ${errorMessage}`,
          flags: MessageFlags.Ephemeral
        });
      }
      logger.error('Failed to start Discord Ralph loop', {
        userId: safeUserId,
        error: errorMessage
      });
    }
  }

  async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    if (!interaction.customId.startsWith('ralph_stop:')) return false;

    const safeUserId = toSafeDiscordId(interaction.user.id);
    const stopped = this.ralphExecutor.stopSessionByUser(safeUserId);

    await interaction.reply({
      content: stopped ? 'Ralph loop stopped.' : 'No active Ralph loop to stop.',
      flags: MessageFlags.Ephemeral
    });

    return true;
  }

  private async ensureGitAuth(workingDir: string): Promise<void> {
    await gitService.ensureAuthRemote(workingDir);
  }
}
