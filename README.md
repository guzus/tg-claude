# Claude Code Telegram Bot

Complete TypeScript implementation for controlling Claude Code remotely via Telegram with unlimited usage through your Claude subscription.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Overview](#overview)
3. [Features](#features)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [Usage](#usage)
7. [Architecture](#architecture)
8. [Development](#development)
9. [Deployment](#deployment)
10. [Security](#security)
11. [Troubleshooting](#troubleshooting)
12. [API Reference](#api-reference)

---

## Quick Start

Get up and running in 5 minutes.

### Prerequisites

- Node.js 18+
- Claude Code CLI installed
- Telegram account
- Claude API key

### Setup Steps

```bash
# 1. Install dependencies
npm install

# 2. Create configuration
cp .env.example .env
nano .env  # Add your credentials

# 3. Build and run
npm run build
npm start
```

### Get Credentials

**Telegram Bot Token:**
- Message [@BotFather](https://t.me/botfather)
- Send: `/newbot`
- Copy token

**Your Telegram User ID:**
- Message [@userinfobot](https://t.me/userinfobot)
- Copy your ID

**Claude API Key:**
- Visit [console.anthropic.com](https://console.anthropic.com/)
- Create API key
- Copy key

**GitHub Token (Optional):**
- Visit [github.com/settings/tokens](https://github.com/settings/tokens)
- Click "Generate new token" → "Generate new token (classic)"
- Set expiration (recommended: 90 days)
- Select scopes:
  - `repo` (Full control of private repositories)
  - `read:org` (Read org and team membership)
- Click "Generate token"
- Copy token immediately (won't be shown again)

### Configure .env

```env
TELEGRAM_BOT_TOKEN=your_bot_token_here
CLAUDE_API_KEY=your_claude_api_key_here
ALLOWED_USER_IDS=123456789
WORKSPACE_PATH=/path/to/your/projects
```

### Test

1. Open Telegram
2. Find your bot
3. Send: `/start`
4. Try: `/task Tell me about this directory`

---

## Overview

Control Claude Code through Telegram:

- Execute coding tasks remotely
- Commit and push to git automatically
- Read and implement from documentation
- Review code, run tests, build projects
- All via Telegram commands
- Uses `--dangerously-skip-permission` for autonomous operation

**Architecture:**

```
Telegram Client ↔ TypeScript Bot ↔ Claude Code CLI
                        ↓
                 Git Repo & Files
```

---

## Features

✅ **Claude Code Execution**
- Spawn and manage Claude processes
- Real-time output streaming to Telegram
- Automatic timeout handling (10 min default)
- Task cancellation support
- Concurrent task management (3 per user)

✅ **Telegram Commands**
- `/start` - Welcome and help
- `/task <description>` - Execute custom tasks
- `/status` - Show active tasks
- `/cancel <id>` - Cancel tasks
- `/limits` - Check rate limits

✅ **Security**
- User authorization by Telegram ID
- Rate limiting (20/hour, 100/day)
- Input sanitization
- Path validation
- Audit logging

✅ **Monitoring**
- Health check endpoint (`:3000/health`)
- Metrics endpoint (`:3000/metrics`)
- Winston logging (file + console)
- Task statistics

✅ **Production Ready**
- TypeScript with full type safety
- Graceful shutdown handling
- Automatic cleanup
- Error handling and recovery
- PM2/Docker deployment support

---

## Installation

### System Requirements

- Node.js 18+
- npm or yarn
- Git
- Claude Code CLI

### Install Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
claude --version
claude login
```

### Install Project

```bash
cd tg-claude
npm install
npm run build
```

---

## Configuration

### Environment Variables

Create `.env` file:

```env
# Required
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
CLAUDE_API_KEY=sk-ant-api03-xxxxx
ALLOWED_USER_IDS=123456789,987654321
WORKSPACE_PATH=/Users/yourname/projects

# Optional
MAX_CONCURRENT_TASKS=3
TASK_TIMEOUT_MS=600000
MAX_OUTPUT_SIZE=4096
MAX_REQUESTS_PER_USER_PER_HOUR=20
MAX_REQUESTS_PER_USER_PER_DAY=100
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
HEALTH_PORT=3000

# GitHub Token (Optional - for private repos and gh CLI operations)
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The bot validates configuration on startup and exits with error if invalid.

---

## Usage

### Starting the Bot

```bash
# Production mode
npm start

# Development with auto-reload
npm run dev:watch

# Development single run
npm run dev
```

### Command Examples

#### Execute Task

```
/task Fix the authentication bug in src/auth/login.ts

Bot: 🤖 Task started...
[Claude analyzes and fixes]
Bot: ✅ Completed (12s)
Fixed authentication bug in src/auth/login.ts:45
```

#### Check Status

```
/status

Bot: 📊 Active Tasks (2):
• abc12345 - Fix authentication bug... (15s)
• def67890 - Run test suite... (3s)
```

#### Cancel Task

```
/cancel abc12345

Bot: ✅ Task cancelled
```

#### Check Limits

```
/limits

Bot: 📊 Your Rate Limits
Remaining this hour: 18
Remaining today: 95
```

---

## Architecture

### System Components

```
Telegram API
    ↓
Bot Application (index.ts)
    ├─ Configuration
    ├─ Logger
    └─ Health Server (Express :3000)
    ↓
Security Middleware
    ├─ Authorization
    ├─ Rate Limiting
    └─ Input Sanitization
    ↓
Bot Handlers
    ↓
    ├─ ClaudeExecutor Service
    ├─ RateLimiter Service
    └─ AuditLogger Service
    ↓
Claude Code CLI Process
    ↓
File System & Git
```

### Core Services

**ClaudeExecutor** - Manages Claude processes
- Spawns and tracks tasks
- Handles output streaming
- Implements timeouts
- Provides cancellation

**RateLimiter** - Enforces usage limits
- Tracks per-user requests
- Hourly and daily limits
- Auto-reset after periods

**AuditLogger** - Logs all commands
- Command history
- Success/failure tracking
- Execution times

**BotHandlers** - Processes Telegram commands
- Routes to appropriate handlers
- Streams output to Telegram
- Handles errors gracefully

### Task States

```
PENDING → RUNNING → COMPLETED
                  → FAILED
                  → TIMEOUT
                  → CANCELLED
```

### File Structure

```
src/
├── config/index.ts              # Configuration
├── handlers/BotHandlers.ts      # Command handlers
├── middleware/security.ts       # Security & validation
├── services/
│   ├── ClaudeExecutor.ts       # Process manager
│   ├── RateLimiter.ts          # Rate limiting
│   └── AuditLogger.ts          # Audit logging
├── types/index.ts              # TypeScript types
├── utils/logger.ts             # Winston logger
└── index.ts                    # Entry point
```

---

## Development

### Development Mode

```bash
# Auto-reload on changes
npm run dev:watch

# Single run
npm run dev

# Watch compilation
npm run watch
```

### Type Checking

```bash
npx tsc --noEmit
```

### Linting

```bash
npm run lint
npm run lint:fix
```

### Building

```bash
npm run clean
npm run build
```

### Adding Commands

1. Add handler in `src/handlers/BotHandlers.ts`:

```typescript
async handleMyCommand(msg: Message): Promise<void> {
  if (!(await this.checkAccess(msg))) return;
  await this.executeAndStream(msg, 'Your prompt');
}
```

2. Register in `src/index.ts`:

```typescript
bot.onText(/\/mycommand/, (msg) => handlers.handleMyCommand(msg));
```

3. Build and test:

```bash
npm run build && npm start
```

---

## Deployment

### Production Build

```bash
npm run build
npm start
```

### Option 1: PM2

```bash
# Install PM2
npm install -g pm2

# Start bot
npm run build
pm2 start dist/index.js --name claude-bot

# Auto-start on reboot
pm2 startup
pm2 save

# Monitor
pm2 logs claude-bot
pm2 monit
```

### Option 2: systemd

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

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable claude-bot
sudo systemctl start claude-bot
sudo systemctl status claude-bot
```

### Option 3: Docker

**Dockerfile:**

```dockerfile
FROM node:18-alpine

RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci --only=production

COPY src ./src
RUN npm run build

RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "dist/index.js"]
```

**Build and run:**

```bash
docker build -t claude-bot .
docker run -d \
  --name claude-bot \
  --env-file .env \
  -v $(pwd)/workspace:/workspace \
  -v $(pwd)/logs:/app/logs \
  -p 3000:3000 \
  --restart unless-stopped \
  claude-bot
```

---

## Security

### ⚠️ Important Warning

This bot uses `--dangerously-skip-permission` which bypasses all Claude Code safety prompts.

### Security Layers

1. **User Authorization** - Only whitelisted Telegram IDs
2. **Rate Limiting** - 20/hour, 100/day per user
3. **Input Sanitization** - Removes dangerous characters
4. **Path Validation** - Restricts to workspace directory
5. **Timeout Protection** - Auto-kills after 30 minutes
6. **Audit Logging** - All commands tracked

### Best Practices

**Minimal User Access:**
```env
# Only trusted users
ALLOWED_USER_IDS=123456789
```

**Dedicated Machine:**
- Use separate VM or container
- Isolate network if possible
- Regular backups

**Separate Git Branches:**
```bash
cd $WORKSPACE_PATH
git checkout -b bot/automated-changes
```

**Protect .env:**
```bash
chmod 600 .env
echo ".env" >> .gitignore
```

**Monitor Logs:**
```bash
tail -f logs/audit.log | jq
```

**Resource Limits:**
```bash
# In systemd
[Service]
MemoryLimit=1G
CPUQuota=50%
```

### Security Incident Response

If unauthorized access detected:

1. Stop bot immediately:
   ```bash
   pm2 stop claude-bot
   ```

2. Rotate credentials:
   - Generate new Claude API key
   - Generate new Telegram bot token

3. Review logs:
   ```bash
   cat logs/audit.log | jq
   cd $WORKSPACE_PATH && git log --all -20
   ```

4. Restore from backup if needed

---

## Troubleshooting

### Bot Not Starting

```bash
# Check configuration
cat .env

# Verify Claude CLI
claude --version

# Check Node version
node --version  # Should be 18+

# View errors
tail -50 logs/bot-error.log

# Verbose logging
LOG_LEVEL=debug npm start
```

### "Unauthorized Access"

Your Telegram ID not in `ALLOWED_USER_IDS`:

```bash
# Get your ID from @userinfobot
# Add to .env
ALLOWED_USER_IDS=YOUR_USER_ID

# Restart
pm2 restart claude-bot
```

### "Configuration errors"

```bash
# Create .env from template
cp .env.example .env
nano .env

# Add required values
npm start
```

### "claude: command not found"

```bash
# Install Claude CLI
npm install -g @anthropic-ai/claude-code
claude login

# Restart bot
pm2 restart claude-bot
```

### Rate Limit Exceeded

```bash
# Wait for reset (hourly/daily)
# Or increase limits in .env:
MAX_REQUESTS_PER_USER_PER_HOUR=50
MAX_REQUESTS_PER_USER_PER_DAY=200

# Restart
pm2 restart claude-bot
```

### Task Timeout

```bash
# Increase timeout in .env
TASK_TIMEOUT_MS=1800000  # 30 minutes

# Restart
pm2 restart claude-bot
```

### Bot Not Responding

```bash
# Check if running
pm2 status

# Check logs
pm2 logs claude-bot

# Check health
curl http://localhost:3000/health

# Restart
pm2 restart claude-bot
```

### Memory Issues

```bash
# Monitor memory
pm2 monit

# Increase limit
pm2 delete claude-bot
pm2 start dist/index.js --name claude-bot --max-memory-restart 1G

# Reduce output size in .env
MAX_OUTPUT_SIZE=2048
```

### Permission Denied

```bash
# Fix workspace permissions
chmod -R 755 $WORKSPACE_PATH
chown -R $USER:$USER $WORKSPACE_PATH

# Fix logs
mkdir -p logs
chmod 755 logs
```

### Debugging Tips

**Enable debug logging:**
```bash
LOG_LEVEL=debug npm start
```

**Watch logs:**
```bash
tail -f logs/bot.log
tail -f logs/bot-error.log | grep ERROR
```

**Test bot token:**
```bash
curl "https://api.telegram.org/bot<TOKEN>/getMe"
```

**Test health:**
```bash
curl http://localhost:3000/health | jq
watch -n 5 'curl -s http://localhost:3000/health | jq'
```

---

## API Reference

### Health Endpoint

**GET** `http://localhost:3000/health`

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

**GET** `http://localhost:3000/metrics`

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

### Bot Commands

All via Telegram:

- `/start` - Show welcome and help
- `/task <description>` - Execute task
- `/status` - Show active tasks
- `/cancel <id>` - Cancel task
- `/limits` - Check rate limits
- `/help` - Show help

### Error Responses

- `🚫 Unauthorized access` - User not in whitelist
- `⏱️ Rate limit exceeded` - Too many requests
- `❌ Usage: /command <args>` - Invalid usage
- `❌ Task not found` - Invalid task ID

---

## Additional Information

### Project Structure

```
tg-claude/
├── src/                 # TypeScript source
├── dist/                # Compiled JavaScript
├── logs/                # Log files
├── .env                 # Configuration (create this)
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
└── readme.md           # This file
```

### Dependencies

**Production:**
- node-telegram-bot-api - Telegram bot framework
- dotenv - Environment variables
- winston - Logging
- express - Health check server
- uuid - Unique IDs

**Development:**
- typescript - TypeScript compiler
- ts-node - TypeScript execution
- @types/* - Type definitions
- eslint - Code linting
- nodemon - Auto-reload

### NPM Scripts

```bash
npm run build        # Compile TypeScript
npm start           # Run compiled code
npm run dev         # Run with ts-node
npm run dev:watch   # Auto-reload on changes
npm run watch       # Watch compilation
npm run lint        # Check code quality
npm run lint:fix    # Fix issues
npm run clean       # Remove dist/
```

### Performance

- Memory: ~50-100MB base + task overhead
- Startup: < 2 seconds
- Concurrent tasks: 3 per user
- Task timeout: 30 minutes
- Rate limits: 20/hour, 100/day
- Output buffer: 4KB per message

### Cost

**Claude Pro ($20/month):**
- Unlimited usage (fair use)
- Best for personal/team

**Claude API (pay-as-you-go):**
- ~$0.03-$0.15 per task
- Depends on complexity

### Limitations

- Single workspace (no multi-project)
- No interactive prompts
- No file upload/download
- Polling mode (not webhooks)
- In-memory storage (not persistent)

### Future Enhancements

- [ ] Multi-project support
- [ ] Scheduled tasks
- [ ] File uploads
- [ ] Webhook mode
- [ ] Web dashboard
- [ ] Database persistence
- [ ] Redis rate limiting
- [ ] Prometheus metrics

### Support

For help:

1. Check logs: `tail -f logs/bot.log`
2. Review this documentation
3. Verbose logging: `LOG_LEVEL=debug npm start`
4. Check config: `cat .env`
5. Health check: `curl localhost:3000/health`

### License

MIT License - Use at your own risk

### Disclaimer

⚠️ **WARNING**: Uses `--dangerously-skip-permission` which bypasses all safety prompts. Can execute arbitrary code. Use only in controlled environments with trusted users. Authors not responsible for damages or security breaches.

---

**Quick Reference:**

```bash
# Setup
npm install && npm run build && npm start

# Development
npm run dev:watch

# Production
pm2 start dist/index.js --name claude-bot

# Monitor
tail -f logs/bot.log
curl localhost:3000/health
```

Enjoy using Claude Code remotely! 🤖
