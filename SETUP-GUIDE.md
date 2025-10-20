# Quick Setup Guide

Follow these steps to get your Claude Code Telegram bot running in 5 minutes.

## Prerequisites

- Node.js 18+ installed
- Claude Code CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Claude account with API access
- Telegram account

## Step 1: Create Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send: `/newbot`
3. Follow prompts to create your bot
4. Copy the bot token (looks like: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11`)

## Step 2: Get Your Telegram User ID

1. Message [@userinfobot](https://t.me/userinfobot) on Telegram
2. Copy your user ID (a number like `123456789`)

## Step 3: Get Claude API Key

1. Go to [Anthropic Console](https://console.anthropic.com/)
2. Navigate to API Keys
3. Create a new API key
4. Copy the key

## Step 4: Clone/Setup Project

```bash
cd ~/Desktop
mkdir tg-claude
cd tg-claude

# If you have the files already, skip to next step
# Otherwise create the project structure
```

## Step 5: Configure Environment

Create `.env` file:

```bash
cat > .env << 'EOF'
TELEGRAM_BOT_TOKEN=paste_your_bot_token_here
CLAUDE_API_KEY=paste_your_claude_api_key_here
ALLOWED_USER_IDS=paste_your_user_id_here
WORKSPACE_PATH=/Users/yourname/projects
MAX_CONCURRENT_TASKS=3
TASK_TIMEOUT_MS=600000
MAX_OUTPUT_SIZE=4096
LOG_LEVEL=info
LOG_FILE=./logs/bot.log
MAX_REQUESTS_PER_USER_PER_HOUR=20
MAX_REQUESTS_PER_USER_PER_DAY=100
EOF
```

**Edit the file** and replace:
- `paste_your_bot_token_here` with your bot token from Step 1
- `paste_your_claude_api_key_here` with your API key from Step 3
- `paste_your_user_id_here` with your user ID from Step 2
- `/Users/yourname/projects` with your actual workspace path

## Step 6: Install Dependencies

```bash
npm install
```

## Step 7: Build the Project

```bash
npm run build
```

## Step 8: Start the Bot

```bash
npm start
```

You should see:
```
🤖 Bot is running...
📊 Health check: http://localhost:3000/health
📈 Metrics: http://localhost:3000/metrics
```

## Step 9: Test Your Bot

1. Open Telegram
2. Search for your bot by username
3. Send: `/start`
4. You should receive a welcome message!

## Step 10: Try a Command

Send to your bot:
```
/task Tell me about this codebase
```

The bot should start processing and stream output back to you.

## Common Issues

### "Configuration errors: TELEGRAM_BOT_TOKEN is required"

Your `.env` file is missing or incomplete. Check Step 5.

### "🚫 Unauthorized access"

Your user ID is not in `ALLOWED_USER_IDS`. Double-check Step 2.

### "claude: command not found"

Claude Code CLI not installed. Run:
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Bot doesn't respond

1. Check if bot is running: `ps aux | grep node`
2. Check logs: `tail -f logs/bot.log`
3. Restart: `npm start`

## Development Mode

For development with auto-reload:

```bash
npm run dev:watch
```

## Production Deployment

For production, use PM2:

```bash
npm install -g pm2
npm run build
pm2 start dist/index.js --name claude-bot
pm2 save
pm2 startup
```

## Next Steps

- Read `README-TYPESCRIPT.md` for full documentation
- Review security settings in `.env`
- Set up monitoring for production use
- Configure git for your workspace
- Test all commands

## Support

If you encounter issues:

1. Check logs: `tail -f logs/bot.log`
2. Verify configuration: `cat .env`
3. Test Claude CLI: `claude "test" --dangerously-skip-permission`
4. Check bot token: `curl https://api.telegram.org/bot<TOKEN>/getMe`

---

**Success!** Your bot is now running and ready to execute tasks via Telegram.
