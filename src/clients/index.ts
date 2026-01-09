/**
 * Clients Module
 *
 * This module provides client implementations for different chat platforms.
 * Currently supported: Telegram, Discord
 *
 * The base client interface is defined in ./base/types.ts
 */

// Export base client interfaces
export * from './base';

// Export Telegram client
export * as telegram from './telegram';

// Export Discord client
export * as discord from './discord';
