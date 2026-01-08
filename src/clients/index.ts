/**
 * Clients Module
 *
 * This module provides client implementations for different chat platforms.
 * Currently supported: Telegram
 *
 * To add a new client (e.g., Discord):
 * 1. Create a new folder: src/clients/discord/
 * 2. Implement handlers following the patterns in telegram/handlers/
 * 3. Export the client from this file
 *
 * The base client interface is defined in ./base/types.ts
 */

// Export base client interfaces
export * from './base';

// Export Telegram client
export * as telegram from './telegram';
