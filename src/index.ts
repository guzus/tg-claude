import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { ClaudeExecutor } from './services/ClaudeExecutor';
import { RateLimiter } from './services/RateLimiter';
import { AuditLogger } from './services/AuditLogger';
import { RepositoryManager } from './services/RepositoryManager';
import { ConversationManager } from './services/ConversationManager';
import { BotHandlers } from './handlers/BotHandlers';

// Validate configuration
try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed', {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
}

// Initialize services
const executor = new ClaudeExecutor();
const rateLimiter = new RateLimiter();
const auditLogger = new AuditLogger();
const repositoryManager = new RepositoryManager();
const conversationManager = new ConversationManager();

// Initialize repository manager (discover existing repos)
(async () => {
  await repositoryManager.initialize();

  const stats = repositoryManager.getStats();
  if (stats.totalRepositories > 0) {
    logger.info('Discovered existing repositories', {
      totalUsers: stats.totalUsers,
      totalRepositories: stats.totalRepositories,
      byType: stats.repositoriesByType
    });
  }
})();

// Initialize Telegram bot
const bot = new TelegramBot(config.telegramToken, { polling: true });
const handlers = new BotHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager);

// Set bot commands in Telegram UI
bot.setMyCommands([
  { command: 'start', description: 'Welcome message and command list' },
  { command: 'task', description: 'Execute a coding task with Claude AI' },
  { command: 'beast', description: '🔥 Beast mode - Autonomous AI execution' },
  { command: 'repo', description: 'Manage repositories (clone/new/list/switch)' },
  { command: 'link', description: 'Get repository URL link' },
  { command: 'scan', description: 'Scan workspace for existing repositories' },
  { command: 'check', description: 'Check Claude CLI installation and setup' },
  { command: 'debug', description: 'Run a simple test task' },
  { command: 'commit', description: 'Commit changes and push to git' },
  { command: 'read', description: 'Read and summarize documentation from URL' },
  { command: 'review', description: 'Review current code changes' },
  { command: 'test', description: 'Run all tests' },
  { command: 'build', description: 'Build the project' },
  { command: 'status', description: 'Check active tasks' },
  { command: 'logs', description: 'View full task logs' },
  { command: 'cancel', description: 'Cancel a running task' },
  { command: 'limits', description: 'Check your rate limits' },
  { command: 'help', description: 'Show help message' }
]).catch((error) => {
  logger.error('Failed to set bot commands', { error: error.message });
});

// Register command handlers
bot.onText(/\/start/, (msg) => handlers.handleStart(msg));
bot.onText(/\/task (.+)/, (msg, match) => handlers.handleTask(msg, match));
bot.onText(/\/beast (.+)/, (msg, match) => handlers.handleBeast(msg, match));
bot.onText(/\/repo(.*)/, (msg, match) => handlers.handleRepo(msg, match));
bot.onText(/\/scan/, (msg) => handlers.handleScan(msg));
bot.onText(/\/check/, (msg) => handlers.handleCheck(msg));
bot.onText(/\/debug/, (msg) => handlers.handleDebug(msg));
bot.onText(/\/commit (.+)/, (msg, match) => handlers.handleCommit(msg, match));
bot.onText(/\/read (.+)/, (msg, match) => handlers.handleRead(msg, match));
bot.onText(/\/review/, (msg) => handlers.handleReview(msg));
bot.onText(/\/test/, (msg) => handlers.handleTest(msg));
bot.onText(/\/build/, (msg) => handlers.handleBuild(msg));
bot.onText(/\/status/, (msg) => handlers.handleStatus(msg));
bot.onText(/\/logs (.+)/, (msg, match) => handlers.handleLogs(msg, match));
bot.onText(/\/cancel (.+)/, (msg, match) => handlers.handleCancel(msg, match));
bot.onText(/\/limits/, (msg) => handlers.handleLimits(msg));
bot.onText(/\/help/, (msg) => handlers.handleHelp(msg));

// Handle callback queries from inline keyboards
bot.on('callback_query', (query) => handlers.handleCallbackQuery(query));

// Handle plain text messages (treat as task commands)
bot.on('message', (msg) => {
  // Skip if it's a command or has no text
  if (!msg.text || msg.text.startsWith('/')) return;

  // Treat plain messages as task commands
  handlers.handlePlainMessage(msg);
});

// Handle polling errors
bot.on('polling_error', (error) => {
  logger.error('Telegram polling error', {
    error: error.message
  });
});

// Health check endpoint
const app = express();
const healthPort = process.env.HEALTH_PORT || 3000;

app.get('/health', (_req, res) => {
  const stats = auditLogger.getStats();
  const activeTaskCount = executor.getTaskCount();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeTasks: activeTaskCount,
    stats,
    timestamp: new Date().toISOString()
  });
});

app.get('/metrics', (_req, res) => {
  const stats = auditLogger.getStats();

  res.json({
    commands: stats,
    activeTasks: executor.getTaskCount(),
    uptime: process.uptime()
  });
});

app.listen(healthPort, () => {
  logger.info(`Health check endpoint listening on port ${healthPort}`);
});

// Cleanup old tasks periodically (every hour)
setInterval(() => {
  const cleanedTasks = executor.cleanupOldTasks();
  const cleanedActivity = rateLimiter.cleanup();
  const cleanedConversations = conversationManager.cleanup();

  if (cleanedTasks > 0 || cleanedActivity > 0 || cleanedConversations > 0) {
    logger.info('Periodic cleanup completed', {
      cleanedTasks,
      cleanedActivity,
      cleanedConversations
    });
  }
}, 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  bot.stopPolling();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  bot.stopPolling();
  process.exit(0);
});

logger.info('🤖 Claude Code Telegram Bot started successfully', {
  allowedUsers: config.allowedUserIds.length,
  workspacePath: config.workspacePath,
  maxConcurrentTasks: config.maxConcurrentTasks
});

console.log('🤖 Bot is running...');
console.log(`📊 Health check: http://localhost:${healthPort}/health`);
console.log(`📈 Metrics: http://localhost:${healthPort}/metrics`);
