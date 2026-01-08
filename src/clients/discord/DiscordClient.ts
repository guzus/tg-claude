import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  ChatInputCommandInteraction,
  ButtonInteraction,
  Message
} from 'discord.js';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { ClaudeExecutor } from '../../services/ClaudeExecutor';
import { RateLimiter } from '../../services/RateLimiter';
import { AuditLogger } from '../../services/AuditLogger';
import { ConversationManager } from '../../services/ConversationManager';
import { RepositoryManager } from '../../services/RepositoryManager';
import { UserConfigManager } from '../../services/UserConfigManager';
import { CommandDispatcher } from './handlers/CommandDispatcher';
import { registerCommands } from './utils/commands';
import { getErrorMessage } from '../../utils/errors';

/**
 * Discord client that integrates with Claude Code.
 * Uses channel-based workspace model (mono-repo per channel).
 */
export class DiscordClient {
  private client: Client;
  private dispatcher: CommandDispatcher;
  private isReady: boolean = false;

  constructor(
    private executor: ClaudeExecutor,
    private rateLimiter: RateLimiter,
    private auditLogger: AuditLogger,
    private conversationManager?: ConversationManager,
    private repositoryManager?: RepositoryManager,
    private userConfigManager?: UserConfigManager
  ) {
    // Create Discord client with necessary intents
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
      ],
      partials: [Partials.Channel]
    });

    // Create command dispatcher
    this.dispatcher = new CommandDispatcher(
      executor,
      rateLimiter,
      auditLogger,
      conversationManager,
      repositoryManager,
      userConfigManager
    );

    this.setupEventHandlers();
  }

  /**
   * Set up Discord event handlers
   */
  private setupEventHandlers(): void {
    // Ready event
    this.client.once(Events.ClientReady, async (readyClient) => {
      logger.info('Discord client ready', {
        username: readyClient.user.tag,
        guildCount: readyClient.guilds.cache.size
      });

      // Register slash commands
      try {
        await registerCommands();
      } catch (error) {
        logger.error('Failed to register Discord commands on ready', {
          error: getErrorMessage(error)
        });
      }

      this.isReady = true;
    });

    // Interaction event (slash commands and buttons)
    this.client.on(Events.InteractionCreate, async (interaction) => {
      try {
        if (interaction.isChatInputCommand()) {
          await this.dispatcher.handleSlashCommand(interaction as ChatInputCommandInteraction);
        } else if (interaction.isButton()) {
          await this.dispatcher.handleButton(interaction as ButtonInteraction);
        }
      } catch (error) {
        logger.error('Error handling Discord interaction', {
          type: interaction.type,
          error: getErrorMessage(error)
        });
      }
    });

    // Message event (plain text messages for task execution)
    this.client.on(Events.MessageCreate, async (message: Message) => {
      try {
        await this.dispatcher.handleMessage(message);
      } catch (error) {
        logger.error('Error handling Discord message', {
          channelId: message.channelId,
          error: getErrorMessage(error)
        });
      }
    });

    // Error handling
    this.client.on(Events.Error, (error) => {
      logger.error('Discord client error', {
        error: error.message
      });
    });

    this.client.on(Events.Warn, (warning) => {
      logger.warn('Discord client warning', { warning });
    });
  }

  /**
   * Start the Discord client
   */
  async start(): Promise<void> {
    if (!config.discordToken) {
      logger.warn('Discord token not configured, skipping Discord client');
      return;
    }

    try {
      await this.client.login(config.discordToken);
      logger.info('Discord client logged in');
    } catch (error) {
      logger.error('Failed to start Discord client', {
        error: getErrorMessage(error)
      });
      throw error;
    }
  }

  /**
   * Stop the Discord client gracefully
   */
  async stop(): Promise<void> {
    if (this.isReady) {
      logger.info('Stopping Discord client');
      await this.client.destroy();
      this.isReady = false;
    }
  }

  /**
   * Get the underlying Discord.js client
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Check if the client is ready
   */
  getIsReady(): boolean {
    return this.isReady;
  }
}
