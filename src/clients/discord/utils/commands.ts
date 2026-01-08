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
