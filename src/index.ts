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
import { voiceCallService } from './services/VoiceCallService';

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
  { command: 'vibe', description: '🎸 Vibe coding - Auto call me on problems' },
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
bot.onText(/\/vibe(.*)/, (msg) => handlers.handleVibe(msg));
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

// Health check endpoint and voice webhooks
const app = express();
const healthPort = process.env.HEALTH_PORT || 3000;

// Parse URL-encoded bodies (for Twilio webhooks)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  const stats = auditLogger.getStats();
  const activeTaskCount = executor.getTaskCount();

  res.json({
    status: 'ok',
    uptime: process.uptime(),
    activeTasks: activeTaskCount,
    stats,
    voiceServiceConfigured: voiceCallService.isConfigured(),
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

// Voice call TwiML endpoint - returns voice prompt for the call
app.get('/voice/twiml', (req, res) => {
  const problem = req.query.problem as string || 'Unknown problem';
  const userId = parseInt(req.query.userId as string) || 0;

  const twiml = voiceCallService.generateTwiML(problem, userId);

  res.type('text/xml');
  res.send(twiml);

  logger.info('TwiML requested', { userId, problemLength: problem.length });
});

// Voice call response endpoint - processes user's speech
app.post('/voice/response', async (req, res) => {
  const userId = parseInt(req.query.userId as string) || 0;
  const speechResult = req.body.SpeechResult || '';
  const callSid = req.body.CallSid || '';

  logger.info('Voice response received', {
    userId,
    callSid,
    speechResult: speechResult.substring(0, 100)
  });

  // Process the response
  const refinedResponse = await voiceCallService.processVoiceResponse(callSid, speechResult);

  // Return TwiML to end the call with confirmation
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Got it. I'll continue with: ${refinedResponse.substring(0, 100).replace(/"/g, '&quot;')}</Say>
  <Pause length="1"/>
  <Say voice="alice">Check Telegram for updates. Goodbye!</Say>
  <Hangup/>
</Response>`;

  res.type('text/xml');
  res.send(twiml);
});

// Voice call status webhook - updates call status
app.post('/voice/status', (req, res) => {
  const callSid = req.body.CallSid || '';
  const status = req.body.CallStatus || '';

  voiceCallService.updateCallStatus(callSid, status);

  logger.info('Call status update', { callSid, status });

  res.sendStatus(200);
});

app.listen(healthPort, () => {
  logger.info(`Health check endpoint listening on port ${healthPort}`);
  if (voiceCallService.isConfigured()) {
    logger.info('Voice call service is configured and ready');
  } else {
    logger.info('Voice call service not configured - set TWILIO_* and GEMINI_API_KEY env vars');
  }
});

// Cleanup old tasks periodically (every hour)
setInterval(() => {
  const cleanedTasks = executor.cleanupOldTasks();
  const cleanedActivity = rateLimiter.cleanup();
  const cleanedConversations = conversationManager.cleanup();
  const cleanedCalls = voiceCallService.cleanupOldSessions();

  if (cleanedTasks > 0 || cleanedActivity > 0 || cleanedConversations > 0 || cleanedCalls > 0) {
    logger.info('Periodic cleanup completed', {
      cleanedTasks,
      cleanedActivity,
      cleanedConversations,
      cleanedCalls
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
