import { ChatInputCommandInteraction, Message, ButtonInteraction, MessageFlags } from 'discord.js';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { ConversationManager } from '../../../services/ConversationManager';
import { isDiscordAuthorized } from '../middleware/security';
import { logger } from '../../../utils/logger';
import { WORKSPACE_PATH } from '../../../config';
import * as fs from 'fs';
import * as path from 'path';
import { DiscordUIHelpers } from '../utils/UIHelpers';
import { toSafeDiscordId } from '../utils/ids';

/**
 * Base handler for Discord commands.
 * Uses channel-based workspace model (mono-repo per channel).
 */
export abstract class BaseHandler {
  constructor(
    protected executor: ClaudeExecutor,
    protected rateLimiter: RateLimiter,
    protected auditLogger: AuditLogger,
    protected conversationManager?: ConversationManager
  ) {}

  /**
   * Check if user is authorized and rate limited
   */
  protected async checkAccess(
    interaction: ChatInputCommandInteraction | ButtonInteraction | Message
  ): Promise<boolean> {
    const userId = interaction instanceof Message
      ? interaction.author.id
      : interaction.user.id;

    if (!isDiscordAuthorized(userId)) {
      const message = 'Unauthorized access';
      if (interaction instanceof Message) {
        await interaction.reply(message);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
      logger.warn('Discord unauthorized access attempt', { userId });
      return false;
    }

    // Use channel ID for rate limiting (mono-repo per channel)
    const channelId = interaction.channelId;
    const rateLimitResult = this.rateLimiter.checkRateLimit(toSafeDiscordId(channelId));
    if (!rateLimitResult.allowed) {
      const message = `Rate limit: ${rateLimitResult.reason}`;
      if (interaction instanceof Message) {
        await interaction.reply(message);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
      return false;
    }

    return true;
  }

  /**
   * Get or create the workspace directory for a Discord channel.
   * Each channel has its own mono-repo workspace.
   */
  protected getChannelWorkspace(channelId: string, channelName?: string): string {
    const safeName = channelName
      ? DiscordUIHelpers.sanitizeChannelName(channelName)
      : 'channel';
    const suffix = channelId.slice(-6);
    const folderName = `discord_${safeName}_${suffix}`;
    const workspacePath = path.join(WORKSPACE_PATH, folderName);

    // Ensure the workspace directory exists
    if (!fs.existsSync(workspacePath)) {
      fs.mkdirSync(workspacePath, { recursive: true });
      logger.info('Created Discord channel workspace', { channelId, workspacePath });
    }

    return workspacePath;
  }
}
