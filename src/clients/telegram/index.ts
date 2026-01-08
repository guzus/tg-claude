/**
 * Telegram Client Module
 *
 * This module contains all Telegram-specific code for the bot.
 * It can be used as a template for implementing other clients (Discord, Slack, etc.)
 */

// Export handlers
export { BotHandlers } from './handlers/BotHandlers';
export { BaseHandler } from './handlers/BaseHandler';
export { TaskHandlers } from './handlers/TaskHandlers';
export { RepositoryHandlers } from './handlers/RepositoryHandlers';
export { StatusHandlers } from './handlers/StatusHandlers';
export { UtilityHandlers } from './handlers/UtilityHandlers';
export { ConfigHandlers } from './handlers/ConfigHandlers';
export { CallbackQueryHandler } from './handlers/CallbackQueryHandler';
export { MothershipHandlers } from './handlers/MothershipHandlers';
export { ChamberHandlers } from './handlers/ChamberHandlers';
export { RalphWiggumHandler } from './handlers/RalphWiggumHandler';

// Export middleware
export { isAuthorized } from './middleware/security';

// Export utils
export { UIHelpers } from './utils/UIHelpers';
