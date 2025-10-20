# Claude Code Telegram Bot - TypeScript Implementation

Production-ready TypeScript implementation of a Telegram bot that controls Claude Code on a remote machine.

## Features

- ✅ Full TypeScript type safety
- ✅ Rate limiting per user
- ✅ Audit logging
- ✅ Task queue management
- ✅ Real-time output streaming
- ✅ Security middleware
- ✅ Health check endpoints
- ✅ Graceful shutdown
- ✅ Comprehensive error handling
- ✅ Automatic cleanup of old tasks

## Project Structure

```
src/
├── config/           # Configuration management
│   └── index.ts
├── handlers/         # Command handlers
│   └── BotHandlers.ts
├── middleware/       # Security middleware
│   └── security.ts
├── services/         # Core services
│   ├── ClaudeExecutor.ts
│   ├── RateLimiter.ts
│   └── AuditLogger.ts
├── types/            # TypeScript type definitions
│   └── index.ts
├── utils/            # Utility functions
│   └── logger.ts
└── index.ts          # Application entry point
```

## Installation

### 1. Install Dependencies

```bash
npm install
```

This will install:
- `node-telegram-bot-api` - Telegram Bot API wrapper
- `dotenv` - Environment variable management
- `winston` - Logging framework
- `express` - HTTP server for health checks
- `uuid` - Unique ID generation
- TypeScript and type definitions

### 2. Configure Environment

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token_from_botfather
CLAUDE_API_KEY=your_claude_api_key
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_PATH=/path/to/your/projects
MAX_CONCURRENT_TASKS=3
TASK_TIMEOUT_MS=600000
MAX_OUTPUT_SIZE=4096
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
MAX_REQUESTS_PER_USER_PER_HOUR=20
MAX_REQUESTS_PER_USER_PER_DAY=100
```

### 3. Build the Project

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `dist/` directory.

## Running the Bot

### Development Mode

```bash
npm run dev
```

This runs the bot directly with `ts-node` (no compilation needed).

### Development with Auto-Reload

```bash
npm run dev:watch
```

Uses `nodemon` to automatically restart on file changes.

### Production Mode

```bash
npm run build
npm start
```

Compiles and runs the optimized JavaScript.

## Available Commands

### Telegram Bot Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/start` | Show welcome message and help | `/start` |
| `/help` | Show help message | `/help` |
| `/task <description>` | Execute a custom task | `/task Fix the bug in auth.js` |
| `/commit <message>` | Commit and push changes | `/commit Add user authentication` |
| `/read <url>` | Read and summarize documentation | `/read https://docs.example.com` |
| `/review` | Review current code changes | `/review` |
| `/test` | Run all tests | `/test` |
| `/build` | Build the project | `/build` |
| `/status` | Show active tasks | `/status` |
| `/cancel <taskId>` | Cancel a running task | `/cancel abc123` |
| `/limits` | Check your rate limits | `/limits` |

### NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run the compiled bot |
| `npm run dev` | Run in development mode with ts-node |
| `npm run dev:watch` | Run with auto-reload on changes |
| `npm run watch` | Watch mode for compilation |
| `npm run lint` | Lint TypeScript code |
| `npm run lint:fix` | Lint and auto-fix issues |
| `npm run clean` | Remove compiled files |

## Architecture

### Services

#### ClaudeExecutor
Manages Claude Code process execution:
- Spawns and tracks Claude processes
- Handles stdout/stderr streaming
- Implements timeout handling
- Manages concurrent task limits
- Provides task cancellation

#### RateLimiter
Enforces rate limits:
- Per-user hourly limits
- Per-user daily limits
- Automatic reset tracking
- Usage statistics

#### AuditLogger
Logs all commands:
- Command history per user
- Success/failure tracking
- Execution time metrics
- Exportable audit trail

### Middleware

#### Security
- User authorization checks
- Input sanitization
- Path validation
- Command context extraction

### Type Safety

All core types defined in `src/types/index.ts`:
- `BotConfig` - Configuration interface
- `ClaudeTask` - Task representation
- `TaskStatus` - Task state enum
- `UserActivity` - Rate limit tracking
- `AuditLogEntry` - Audit log format

## Health Monitoring

### Health Check Endpoint

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 12345,
  "activeTasks": 2,
  "stats": {
    "totalCommands": 100,
    "successfulCommands": 95,
    "failedCommands": 5,
    "uniqueUsers": 3
  },
  "timestamp": "2025-01-20T10:30:00.000Z"
}
```

### Metrics Endpoint

```bash
curl http://localhost:3000/metrics
```

Response:
```json
{
  "commands": {
    "totalCommands": 100,
    "successfulCommands": 95,
    "failedCommands": 5,
    "uniqueUsers": 3
  },
  "activeTasks": 2,
  "uptime": 12345
}
```

## Logging

Logs are written to:
- `./logs/bot.log` - All logs
- `./logs/bot-error.log` - Error logs only
- Console - Colored output for development

Log levels: `error`, `warn`, `info`, `debug`

Example log entry:
```json
{
  "level": "info",
  "message": "Task completed",
  "taskId": "abc123",
  "status": "completed",
  "exitCode": 0,
  "executionTime": "5432ms",
  "timestamp": "2025-01-20 10:30:00"
}
```

## Security Features

### 1. User Authorization
Only users in `ALLOWED_USER_IDS` can use the bot.

### 2. Rate Limiting
- 20 requests per hour per user (configurable)
- 100 requests per day per user (configurable)
- Automatic reset tracking

### 3. Input Sanitization
All user inputs are sanitized to prevent command injection.

### 4. Path Validation
All file paths are validated to ensure they're within the workspace.

### 5. Audit Logging
All commands are logged with user ID, timestamp, and success status.

### 6. Timeout Protection
Tasks are automatically killed after timeout (default 10 minutes).

## Deployment

### Using PM2

```bash
npm install -g pm2

# Build the project
npm run build

# Start with PM2
pm2 start dist/index.js --name claude-bot

# Auto-restart on server reboot
pm2 startup
pm2 save

# Monitor
pm2 logs claude-bot
pm2 monit
```

### Using systemd

Create `/etc/systemd/system/claude-bot.service`:

```ini
[Unit]
Description=Claude Code Telegram Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/tg-claude
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable claude-bot
sudo systemctl start claude-bot
sudo systemctl status claude-bot
```

### Using Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source
COPY src ./src

# Build TypeScript
RUN npm run build

# Create logs directory
RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

Build and run:
```bash
docker build -t claude-bot .

docker run -d \
  --name claude-bot \
  --env-file .env \
  -v /path/to/workspace:/workspace \
  -p 3000:3000 \
  --restart unless-stopped \
  claude-bot
```

## Development

### Type Checking

```bash
npx tsc --noEmit
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Debugging

Add breakpoints and run with VS Code debugger, or use:

```bash
node --inspect dist/index.js
```

## Troubleshooting

### Bot Not Starting

Check logs:
```bash
tail -f logs/bot.log
```

Validate config:
```bash
npm run dev
# Will show configuration errors
```

### TypeScript Errors

Clean and rebuild:
```bash
npm run clean
npm run build
```

### Rate Limit Issues

Reset user limits by restarting the bot or modify limits in `.env`.

### Task Timeout

Increase `TASK_TIMEOUT_MS` in `.env` for longer tasks.

### Memory Issues

Monitor with:
```bash
pm2 monit
```

Restart if needed:
```bash
pm2 restart claude-bot
```

## Best Practices

1. **Use Environment Variables** - Never hardcode secrets
2. **Monitor Logs** - Check logs regularly for errors
3. **Rate Limiting** - Adjust based on your API limits
4. **Workspace Isolation** - Use dedicated workspace directory
5. **Git Branches** - Use separate branches for bot operations
6. **Backup** - Regular backups of workspace
7. **Updates** - Keep dependencies updated
8. **Health Checks** - Monitor health endpoint

## Performance

- Supports up to 3 concurrent tasks per user (configurable)
- Automatic cleanup of old tasks every hour
- Memory-efficient output streaming
- Non-blocking async operations

## Contributing

Feel free to submit issues and pull requests!

## License

MIT

---

**⚠️ Security Warning**: This bot executes arbitrary code on your machine with `--dangerously-skip-permission`. Use only in controlled environments with trusted users. Review all security features before deploying to production.
