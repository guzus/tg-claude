// Acknowledge we're following telegram-bot-api file sending best practices (Buffer + contentType)
process.env.NTBA_FIX_350 = '1';

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import { config, validateConfig, EXECUTOR_TYPE, ENABLE_TELEGRAM, ENABLE_DISCORD } from './config';
import { logger, log } from './utils/logger';
import { createExecutor } from './services/ExecutorFactory';
import { RateLimiter } from './services/RateLimiter';
import { AuditLogger } from './services/AuditLogger';
import { RepositoryManager } from './services/RepositoryManager';
import { ConversationManager } from './services/ConversationManager';
import { UserConfigManager } from './services/UserConfigManager';
import { GitHubService } from './services/GitHubService';
import { MothershipService } from './services/MothershipService';
import { ensureDefaultPluginMarketplaces } from './services/ClaudePluginMarketplace';
import { BotHandlers, ChamberHandlers } from './clients/telegram';
import { DiscordClient } from './clients/discord';
import { getVersionHash } from './utils/version';
import { getErrorMessage } from './utils/errors';
import { AIProviderConfig, ClaudeTaskWithStreaming } from './types';
import { createApiRoutes } from './api/routes';

// Initialize GitHub service and authenticate
const githubService = new GitHubService(config.githubToken);
(async () => {
  await githubService.authenticate();
})();

// Validate configuration
try {
  validateConfig();
  log.success('Configuration validated');
} catch (error) {
  log.error('Configuration validation failed', {
    error: getErrorMessage(error)
  });
  process.exit(1);
}

// Best-effort: ensure default Claude plugin marketplaces exist for this runtime
try {
  ensureDefaultPluginMarketplaces(process.cwd());
} catch (error) {
  logger.debug('Skipping plugin marketplace bootstrap', {
    error: getErrorMessage(error)
  });
}

// Initialize services
const executor = createExecutor();
logger.info('Executor initialized', { type: EXECUTOR_TYPE });
const rateLimiter = new RateLimiter();
const auditLogger = new AuditLogger();
const userConfigManager = new UserConfigManager();
const repositoryManager = new RepositoryManager(undefined, userConfigManager);
const conversationManager = new ConversationManager();
const mothershipService = new MothershipService();

// Initialize repository manager and user config manager (discover existing repos and configs)
(async () => {
  await userConfigManager.initialize();
  await repositoryManager.initialize();

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

// Initialize Telegram bot (if enabled)
let bot: TelegramBot | null = null;
let handlers: BotHandlers | null = null;
let chamberHandlers: ChamberHandlers | null = null;

if (ENABLE_TELEGRAM && config.telegramToken) {
  bot = new TelegramBot(config.telegramToken, { polling: true });
  handlers = new BotHandlers(bot, executor, rateLimiter, auditLogger, repositoryManager, conversationManager, userConfigManager, mothershipService);
  chamberHandlers = new ChamberHandlers(bot, repositoryManager, userConfigManager);

  // Handle task resume notifications for Telegram
  executor.on('taskResumed', async (
    _taskId: string,
    task: ClaudeTaskWithStreaming,
    meta?: { aiProvider?: AIProviderConfig }
  ) => {
    const chatId = task.chatId;
    const userId = task.userId;
    const workingDir = task.workingDir;
    let messageId = task.messageId;

    try {
      await bot!.sendMessage(
        chatId,
        `🔄 Task resumed after restart\n\nID: \`${task.id.substring(0, 8)}\``,
        { parse_mode: 'Markdown' }
      );
    } catch {
      logger.debug('Failed to send resume notification', { taskId: task.id });
    }

    if (messageId) {
      try {
        await bot!.editMessageText('🔄 Resuming task...', {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🛑 Cancel', callback_data: `cancel_task:${task.id}` },
              { text: '📋 Full Log', callback_data: `view_log:${task.id}` }
            ]]
          }
        });
      } catch {
        messageId = undefined;
      }
    }

    if (!messageId) {
      try {
        const statusMsg = await bot!.sendMessage(chatId, '🔄 Resuming task...', {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '🛑 Cancel', callback_data: `cancel_task:${task.id}` },
              { text: '📋 Full Log', callback_data: `view_log:${task.id}` }
            ]]
          }
        });
        messageId = statusMsg.message_id;
        executor.setTaskMessageId(task.id, messageId);
      } catch (error) {
        logger.debug('Failed to attach resume status message', { taskId: task.id, error: getErrorMessage(error) });
        return;
      }
    }

    handlers!.resumeTaskMonitor({
      taskId: task.id,
      userId,
      chatId,
      messageId,
      workingDir,
      aiProvider: meta?.aiProvider
    });
  });
} // End of ENABLE_TELEGRAM block

// Initialize Discord client (if enabled)
let discordClient: DiscordClient | null = null;
if (ENABLE_DISCORD && config.discordToken) {
  discordClient = new DiscordClient(
    executor,
    rateLimiter,
    auditLogger,
    conversationManager,
    repositoryManager,
    userConfigManager
  );

  // Start Discord client
  discordClient.start().then(() => {
    logger.info('Discord client started');
  }).catch((error) => {
    logger.error('Failed to start Discord client', {
      error: getErrorMessage(error)
    });
  });
}

// Initialize current repositories from pinned messages for all allowed users
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const initializeRepositoriesFromPinnedMessages = async (): Promise<void> => {
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
        error: getErrorMessage(error)
      });
    }
  }

  logger.info('Completed pinned message initialization');
};

const notifyDeploy = async (): Promise<void> => {
  const shortHash = getVersionHash().substring(0, 8);
  for (const userId of config.allowedUserIds) {
    try {
      await bot.sendMessage(userId, `🚀 *tg-claude deployed*\n\nCommit: \`${shortHash}\``, { parse_mode: 'Markdown' });
    } catch {
      logger.debug('Could not send deploy notification', { userId });
    }
  }
};

(async () => {
  // Give the bot a moment to fully initialize
  await delay(1000);
  await initializeRepositoriesFromPinnedMessages();
  await notifyDeploy();
})();

// Register Telegram commands (if enabled)
if (ENABLE_TELEGRAM && bot && handlers && chamberHandlers) {
  type TelegramCommandHandler = (msg: TelegramBot.Message, match?: RegExpExecArray | null) => void;

  const telegramCommands: Array<{
    command: string;
    description: string;
    pattern: RegExp;
    handler: TelegramCommandHandler;
  }> = [
    {
      command: 'start',
      description: 'Welcome message and command list',
      pattern: /\/start/,
      handler: (msg: TelegramBot.Message) => handlers.handleStart(msg)
    },
    {
      command: 'ralph',
      description: '🔄 Ralph loop (ralph-loop plugin)',
      pattern: /\/ralph(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleRalph(msg, match || null)
    },
    {
      command: 'new_repo',
      description: '📁 Create new GitHub repository',
      pattern: /\/new_repo(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleNewRepo(msg, match || null)
    },
    {
      command: 'repo',
      description: 'Manage repositories (clone/new/list/switch)',
      pattern: /\/repo(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleRepo(msg, match || null)
    },
    {
      command: 'scan',
      description: 'Scan for existing repositories',
      pattern: /\/scan/,
      handler: (msg: TelegramBot.Message) => handlers.handleScan(msg)
    },
    {
      command: 'remote',
      description: 'Manage git remote (show/set/test/remove)',
      pattern: /\/remote(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleRemote(msg, match || null)
    },
    {
      command: 'bot',
      description: '🤖 Manage bots via Mothership (in development)',
      pattern: /\/bot(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleBotCommand(msg, match || null)
    },
    {
      command: 'chamber',
      description: '🏛️ Chamber mode - GLM ↔ Anthropic conversation',
      pattern: /\/chamber(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => chamberHandlers.handleChamber(msg, match || null)
    },
    {
      command: 'check',
      description: 'Check Claude CLI installation and setup',
      pattern: /\/check/,
      handler: (msg: TelegramBot.Message) => handlers.handleCheck(msg)
    },
    {
      command: 'status',
      description: 'Check active tasks',
      pattern: /\/status/,
      handler: (msg: TelegramBot.Message) => handlers.handleStatus(msg)
    },
    {
      command: 'cancel',
      description: 'Cancel an active task by ID',
      pattern: /\/cancel(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleCancel(msg, match || null)
    },
    {
      command: 'limits',
      description: 'Show your remaining rate limits',
      pattern: /\/limits/,
      handler: (msg: TelegramBot.Message) => handlers.handleLimits(msg)
    },
    {
      command: 'config',
      description: 'Manage user configuration',
      pattern: /\/config(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleConfig(msg, match || null)
    },
    {
      command: 'ai',
      description: 'Quick toggle AI provider',
      pattern: /\/ai/,
      handler: (msg: TelegramBot.Message) => handlers.handleAi(msg)
    },
    {
      command: 'mcp',
      description: '🔌 Manage MCP servers (per-repository)',
      pattern: /\/mcp(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handleMcp(msg, match || null)
    },
    {
      command: 'plugin',
      description: '🧩 Manage Claude plugins (ralph-loop, etc.)',
      pattern: /\/plugin(.*)/,
      handler: (msg: TelegramBot.Message, match?: RegExpExecArray | null) => handlers.handlePlugin(msg, match || null)
    },
    {
      command: 'version',
      description: 'Show bot version/commit hash',
      pattern: /\/version/,
      handler: (msg: TelegramBot.Message) => handlers.handleVersion(msg)
    },
    {
      command: 'help',
      description: 'Show help message',
      pattern: /\/help/,
      handler: (msg: TelegramBot.Message) => handlers.handleHelp(msg)
    }
  ];

  bot.setMyCommands(telegramCommands.map(({ command, description }) => ({ command, description })))
    .catch((error) => {
      logger.error('Failed to set bot commands', { error: getErrorMessage(error) });
    });

  telegramCommands.forEach(({ pattern, handler }) => {
    bot.onText(pattern, handler);
  });

  // Handle callback queries from inline keyboards
  bot.on('callback_query', (query) => handlers.handleCallbackQuery(query));

  // Handle plain text messages (treat as task commands)
  bot.on('message', (msg) => {
    // Skip if it's a command or has no text
    if (!msg.text || msg.text.startsWith('/')) return;

    // Treat plain messages as task commands
    handlers.handlePlainMessage(msg);
  });

  // Handle photo messages (image input for Claude)
  bot.on('photo', (msg) => {
    handlers.handlePhotoMessage(msg);
  });

  // Handle polling errors
  bot.on('polling_error', (error) => {
    logger.error('Telegram polling error', {
      error: getErrorMessage(error)
    });
  });
} // End of Telegram commands block

// API server (health, metrics, API routes)
const app = express();
const apiServerPort = process.env.API_SERVER_PORT || 5555;

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

// API routes for frontend
app.use(express.json());
const apiRoutes = createApiRoutes(executor, repositoryManager, userConfigManager, auditLogger);
app.use('/api', apiRoutes);

app.listen(apiServerPort, () => {
  log.success(`Server listening on port ${apiServerPort}`);
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
const shutdown = async (signal: string): Promise<void> => {
  logger.info(`${signal} received, shutting down gracefully`);
  if (bot) {
    bot.stopPolling();
  }
  if (discordClient) {
    await discordClient.stop();
  }
  process.exit(0);
};

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

// Startup banner
log.startup(`Claude Code Bot v${getVersionHash().slice(0, 7)}`);

log.section('Configuration');
log.success(`Executor: ${EXECUTOR_TYPE}`);
log.info(`Telegram users: ${config.allowedUserIds.length}`);
log.info(`Discord users: ${config.discordAllowedUserIds?.length || 0}`);
log.info(`Max concurrent tasks: ${config.maxConcurrentTasks}`);

log.section('Services');
log.success(`Telegram: ${ENABLE_TELEGRAM && config.telegramToken ? 'enabled' : 'disabled'}`);
log.success(`Discord: ${ENABLE_DISCORD && config.discordToken ? 'enabled' : 'disabled'}`);
log.success(`API: enabled`);

log.section('Endpoints');
log.info(`Health:   http://localhost:${apiServerPort}/health`);
log.info(`Metrics:  http://localhost:${apiServerPort}/metrics`);
log.info(`API:      http://localhost:${apiServerPort}/api`);

logger.info('Bot started successfully');
