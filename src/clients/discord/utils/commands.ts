import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';

/**
 * Define slash commands for the Discord bot
 */
export const commands = [
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands and usage'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show active tasks in this channel'),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel an active task')
    .addStringOption(option =>
      option.setName('task_id')
        .setDescription('The task ID to cancel')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('version')
    .setDescription('Show bot version'),
  new SlashCommandBuilder()
    .setName('ralph')
    .setDescription('Start a Ralph loop in this channel')
    .addStringOption(option =>
      option.setName('task')
        .setDescription('Task description for the loop')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('max_iterations')
        .setDescription('Stop after N iterations (max 100)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('promise')
        .setDescription('Completion promise token')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('timeout_minutes')
        .setDescription('Max duration in minutes (max 120)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('repo')
    .setDescription('Show repository info for this channel')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('What to show')
        .addChoices(
          { name: 'status', value: 'status' },
          { name: 'remotes', value: 'remotes' },
          { name: 'path', value: 'path' }
        )
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('repo_new')
    .setDescription('Create a new GitHub repo from this channel workspace')
    .addStringOption(option =>
      option.setName('name')
        .setDescription('New repository name')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('visibility')
        .setDescription('Visibility')
        .addChoices(
          { name: 'private', value: 'private' },
          { name: 'public', value: 'public' }
        )
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Show configuration for this channel'),
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('Switch AI provider')
    .addStringOption(option =>
      option.setName('provider')
        .setDescription('Provider to use')
        .addChoices(
          { name: 'Claude', value: 'anthropic' },
          { name: 'GLM', value: 'glm' },
          { name: 'OpenRouter', value: 'openrouter' }
        )
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('model')
    .setDescription('Set model for a slot')
    .addStringOption(option =>
      option.setName('slot')
        .setDescription('Model slot')
        .addChoices(
          { name: 'Haiku', value: 'haiku' },
          { name: 'Sonnet', value: 'sonnet' },
          { name: 'Opus', value: 'opus' }
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('model')
        .setDescription('Model identifier')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('mcp')
    .setDescription('Manage MCP servers for this channel')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Action to perform')
        .addChoices(
          { name: 'list', value: 'list' },
          { name: 'add', value: 'add' },
          { name: 'remove', value: 'remove' },
          { name: 'clear', value: 'clear' },
          { name: 'preset', value: 'preset' },
          { name: 'presets', value: 'presets' }
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('name')
        .setDescription('Server name or preset name')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('command')
        .setDescription('Command and args (for add)')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('plugin')
    .setDescription('Manage Claude plugins for this channel')
    .addStringOption(option =>
      option.setName('action')
        .setDescription('Action to perform')
        .addChoices(
          { name: 'list', value: 'list' },
          { name: 'install', value: 'install' },
          { name: 'remove', value: 'remove' },
          { name: 'preset', value: 'preset' },
          { name: 'presets', value: 'presets' }
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('spec')
        .setDescription('Plugin spec (name@registry) or preset name')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Show your Discord identity and channel workspace'),
];

/**
 * Register slash commands with Discord
 */
export async function registerCommands(): Promise<void> {
  if (!config.discordToken || !config.discordClientId) {
    logger.warn('Discord token or client ID not configured, skipping command registration');
    return;
  }

  const rest = new REST().setToken(config.discordToken);

  try {
    logger.info('Registering Discord slash commands...');

    const commandData = commands.map(cmd => cmd.toJSON());

    if (config.discordGuildId) {
      // Guild-specific commands (instant updates, good for development)
      await rest.put(
        Routes.applicationGuildCommands(config.discordClientId, config.discordGuildId),
        { body: commandData }
      );
      logger.info('Registered guild-specific slash commands', { guildId: config.discordGuildId });
    } else {
      // Global commands (up to 1 hour propagation)
      await rest.put(
        Routes.applicationCommands(config.discordClientId),
        { body: commandData }
      );
      logger.info('Registered global slash commands');
    }
  } catch (error) {
    logger.error('Failed to register Discord slash commands', {
      error: getErrorMessage(error)
    });
    throw error;
  }
}
