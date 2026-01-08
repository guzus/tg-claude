import { ChatInputCommandInteraction, ButtonInteraction, Message, MessageFlags } from 'discord.js';
import { ClaudeExecutor } from '../../../services/ClaudeExecutor';
import { RateLimiter } from '../../../services/RateLimiter';
import { AuditLogger } from '../../../services/AuditLogger';
import { ConversationManager } from '../../../services/ConversationManager';
import { UtilityHandlers } from './UtilityHandlers';
import { TaskHandlers } from './TaskHandlers';
import { ConfigHandlers } from './ConfigHandlers';
import { logger } from '../../../utils/logger';
import { RepositoryManager } from '../../../services/RepositoryManager';
import { UserConfigManager } from '../../../services/UserConfigManager';
import { getErrorMessage } from '../../../utils/errors';

/**
 * Central dispatcher for Discord commands and interactions.
 * Routes slash commands to appropriate handlers.
 */
export class CommandDispatcher {
  private utilityHandlers: UtilityHandlers;
  private taskHandlers: TaskHandlers;
  private configHandlers: ConfigHandlers;

  constructor(
    executor: ClaudeExecutor,
    rateLimiter: RateLimiter,
    auditLogger: AuditLogger,
    conversationManager?: ConversationManager,
    repositoryManager?: RepositoryManager,
    userConfigManager?: UserConfigManager
  ) {
    this.utilityHandlers = new UtilityHandlers(executor, rateLimiter, auditLogger, conversationManager);
    this.taskHandlers = new TaskHandlers(executor, rateLimiter, auditLogger, conversationManager);
    if (!repositoryManager || !userConfigManager) {
      throw new Error('RepositoryManager and UserConfigManager are required for Discord config commands.');
    }
    this.configHandlers = new ConfigHandlers(
      executor,
      rateLimiter,
      auditLogger,
      repositoryManager,
      userConfigManager,
      conversationManager
    );
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
        case 'repo':
          await this.configHandlers.handleRepo(interaction);
          break;
        case 'repo_new':
          await this.configHandlers.handleRepoNew(interaction);
          break;
        case 'config':
          await this.configHandlers.handleConfig(interaction);
          break;
        case 'ai':
          await this.configHandlers.handleAi(interaction);
          break;
        case 'model':
          await this.configHandlers.handleModel(interaction);
          break;
        case 'mcp':
          await this.configHandlers.handleMcp(interaction);
          break;
        case 'plugin':
          await this.configHandlers.handlePlugin(interaction);
          break;
        case 'whoami':
          await this.configHandlers.handleWhoAmI(interaction);
          break;
        default:
          await interaction.reply({
            content: `Unknown command: ${commandName}`,
            flags: MessageFlags.Ephemeral
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
          flags: MessageFlags.Ephemeral
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
          flags: MessageFlags.Ephemeral
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
