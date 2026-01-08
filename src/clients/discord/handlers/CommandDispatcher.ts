import { ChatInputCommandInteraction, ButtonInteraction, Message } from 'discord.js';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { ConversationManager } from '../../../services/ConversationManager';
import { UtilityHandlers } from './UtilityHandlers';
import { TaskHandlers } from './TaskHandlers';
import { logger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

/**
 * Central dispatcher for Discord commands and interactions.
 * Routes slash commands to appropriate handlers.
 */
export class CommandDispatcher {
  private utilityHandlers: UtilityHandlers;
  private taskHandlers: TaskHandlers;

  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    conversationManager?: ConversationManager
  ) {
    this.utilityHandlers = new UtilityHandlers(executor, rateLimiter, auditLogger, conversationManager);
    this.taskHandlers = new TaskHandlers(executor, rateLimiter, auditLogger, conversationManager);
  }

  /**
   * Handle slash command interactions
   */
  async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const { commandName } = interaction;

    logger.debug('Discord slash command received', {
      command: commandName,
      userId: interaction.user.id,
      channelId: interaction.channelId
    });

    try {
      switch (commandName) {
        case 'help':
          await this.utilityHandlers.handleHelp(interaction);
          break;
        case 'status':
          await this.utilityHandlers.handleStatus(interaction);
          break;
        case 'cancel':
          await this.utilityHandlers.handleCancel(interaction);
          break;
        case 'version':
          await this.utilityHandlers.handleVersion(interaction);
          break;
        default:
          await interaction.reply({
            content: `Unknown command: ${commandName}`,
            ephemeral: true
          });
      }
    } catch (error) {
      logger.error('Error handling Discord slash command', {
        command: commandName,
        error: getErrorMessage(error)
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred while processing your command.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handle button interactions
   */
  async handleButton(interaction: ButtonInteraction): Promise<void> {
    logger.debug('Discord button interaction received', {
      customId: interaction.customId,
      userId: interaction.user.id
    });

    try {
      await this.utilityHandlers.handleButton(interaction);
    } catch (error) {
      logger.error('Error handling Discord button', {
        customId: interaction.customId,
        error: getErrorMessage(error)
      });

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred.',
          ephemeral: true
        });
      }
    }
  }

  /**
   * Handle plain text messages (execute as Claude tasks)
   */
  async handleMessage(message: Message): Promise<void> {
    await this.taskHandlers.handleMessage(message);
  }
}
