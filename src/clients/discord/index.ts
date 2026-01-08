/**
 * Discord client module for Claude Code bot.
 *
 * Key features:
 * - Channel-based workspace (mono-repo per channel)
 * - Slash commands (/help, /status, /cancel, /version)
 * - Plain text messages execute as Claude tasks
 * - Button interactions for task control
 */

export { DiscordClient } from './DiscordClient';
export { CommandDispatcher } from './handlers/CommandDispatcher';
export { TaskHandlers } from './handlers/TaskHandlers';
export { UtilityHandlers } from './handlers/UtilityHandlers';
export { ConfigHandlers } from './handlers/ConfigHandlers';
export { BaseHandler } from './handlers/BaseHandler';
export { isDiscordAuthorized } from './middleware/security';
export { registerCommands, commands } from './utils/commands';
export { DiscordUIHelpers } from './utils/UIHelpers';
