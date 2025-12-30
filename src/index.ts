import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import { config, validateConfig } from './config';
import { logger } from './utils/logger';
import { ClaudeExecutor } from './services/ClaudeExecutor';
import { RateLimiter } from './services/RateLimiter';
import { AuditLogger } from './services/AuditLogger';
import { RepositoryManager } from './services/RepositoryManager';
import { ConversationManager } from './services/ConversationManager';
import { UserConfigManager } from './services/UserConfigManager';
import { GitHubService } from './services/GitHubService';
import { MothershipService } from './services/MothershipService';
import { BotHandlers } from './handlers/BotHandlers';

// Initialize GitHub service and authenticate
const githubService = new GitHubService(config.githubToken);
(async () => {
  await githubService.authenticate();
})();

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
const userConfigManager = new UserConfigManager();
const repositoryManager = new RepositoryManager(undefined, userConfigManager);
const conversationManager = new ConversationManager();
const mothershipService = new MothershipService();

// Initialize repository manager and user config manager (discover existing repos and configs)
(async () => {
  await Promise.all([
    repositoryManager.initialize(),
    userConfigManager.initialize()
  ]);

  const stats = repositoryManager.getStats();
  if (stats.totalRepositories > 0) {
    logger.info('Discovered existing repositories', {
      totalUsers: stats.totalUsers,
      totalRepositories: stats.totalRepositories,
      byType: stats.repositoriesByType
    });
  }

  logger.info('User config manager initialized', {
    configuredUsers: userConfigManager.getUserIds().length
  });
})();

// Initialize Telegram bot
const bot = new TelegramBot(config.telegramToken, { polling: true });
const handlers = new BotHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager, mothershipService);

// Initialize current repositories from pinned messages for all allowed users
(async () => {
  // Give the bot a moment to fully initialize
  await new Promise(resolve => setTimeout(resolve, 1000));

  logger.info('Initializing repositories from pinned messages');

  for (const userId of config.allowedUserIds) {
    try {
      // Fetch pinned message and switch to the repository
      const chatId = userId; // In private chats, chat ID equals user ID

      const chat = await bot.getChat(chatId);

      if (chat.pinned_message?.text) {
        const text = chat.pinned_message.text;

        // Extract repository name between asterisks on the first line
        // Format: "<emoji> *<repository-name>*\n🌿 <branch>..."
        const match = text.match(/^\S+\s+\*(.+?)\*/);
        if (match && match[1]) {
          const repoName = match[1].trim();

          // Find repository by name
          const repositories = await repositoryManager.listRepositories(userId);
          const matchingRepo = repositories.find(r => r.name === repoName);

          if (matchingRepo) {
            await repositoryManager.switchRepository(userId, matchingRepo.id);
            logger.info('Switched to repository from pinned message', {
              userId,
              repoName,
              repoId: matchingRepo.id
            });
          } else {
            logger.debug('Repository from pinned message not found', {
              userId,
              repoName,
              availableRepos: repositories.map(r => r.name)
            });
          }
        }
      }
    } catch (error) {
      logger.debug('Could not initialize repository from pinned message', {
        userId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  logger.info('Completed pinned message initialization');
})();

// Set bot commands in Telegram UI
bot.setMyCommands([
  { command: 'start', description: 'Welcome message and command list' },
  { command: 'task', description: 'Execute a coding task with Claude AI' },
  { command: 'beast', description: '🔥 Beast mode - Autonomous AI execution' },
  { command: 'repo', description: 'Manage repositories (clone/new/list/switch)' },
  { command: 'remote', description: 'Manage git remote (show/set/test/remove)' },
  { command: 'bot', description: '🤖 Manage bots via Mothership (run/status/logs)' },
  { command: 'check', description: 'Check Claude CLI installation and setup' },
  { command: 'status', description: 'Check active tasks' },
  { command: 'config', description: 'Manage user configuration' },
  { command: 'help', description: 'Show help message' }
]).catch((error) => {
  logger.error('Failed to set bot commands', { error: error.message });
});

// Register command handlers
bot.onText(/\/start/, (msg) => handlers.handleStart(msg));
bot.onText(/\/task (.+)/, (msg, match) => handlers.handleTask(msg, match));
bot.onText(/\/beast (.+)/, (msg, match) => handlers.handleBeast(msg, match));
bot.onText(/\/repo(.*)/, (msg, match) => handlers.handleRepo(msg, match));
bot.onText(/\/remote(.*)/, (msg, match) => handlers.handleRemote(msg, match));
bot.onText(/\/bot(.*)/, (msg, match) => handlers.handleBotCommand(msg, match));
bot.onText(/\/check/, (msg) => handlers.handleCheck(msg));
bot.onText(/\/status/, (msg) => handlers.handleStatus(msg));
bot.onText(/\/config(.*)/, (msg, match) => handlers.handleConfig(msg, match));
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
  maxConcurrentTasks: config.maxConcurrentTasks
});

console.log('🤖 Bot is running...');
console.log(`📊 Health check: http://localhost:${healthPort}/health`);
console.log(`📈 Metrics: http://localhost:${healthPort}/metrics`);
