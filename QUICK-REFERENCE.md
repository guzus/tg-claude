# Quick Reference Card

## Essential Commands

### Setup (First Time)
```bash
npm install                  # Install dependencies
cp .env.example .env        # Create config file
nano .env                   # Edit with your credentials
npm run build              # Compile TypeScript
npm start                  # Start the bot
```

### Daily Operations
```bash
npm start                  # Start bot
npm run dev:watch         # Development mode with auto-reload
npm run build             # Rebuild after changes
pm2 restart claude-bot    # Restart if using PM2
```

### Monitoring
```bash
tail -f logs/bot.log              # Watch logs
curl localhost:3000/health        # Health check
curl localhost:3000/metrics       # Metrics
pm2 logs claude-bot               # PM2 logs
```

## Telegram Bot Commands

| Command | Usage | Example |
|---------|-------|---------|
| `/start` | Start bot | `/start` |
| `/task` | Execute task | `/task Fix bug in auth.js` |
| `/commit` | Git commit & push | `/commit Add new feature` |
| `/read` | Read docs | `/read https://docs.example.com` |
| `/review` | Review code | `/review` |
| `/test` | Run tests | `/test` |
| `/build` | Build project | `/build` |
| `/status` | Show active tasks | `/status` |
| `/cancel` | Cancel task | `/cancel abc123` |
| `/limits` | Check rate limits | `/limits` |
| `/help` | Show help | `/help` |

## NPM Scripts

```bash
npm run build         # Compile TS → JS
npm start            # Run compiled code
npm run dev          # Run with ts-node
npm run dev:watch    # Auto-reload on changes
npm run watch        # Watch compilation
npm run lint         # Check code quality
npm run lint:fix     # Auto-fix issues
npm run clean        # Remove dist/
```

## Environment Variables

Required in `.env`:
```env
TELEGRAM_BOT_TOKEN=        # From @BotFather
CLAUDE_API_KEY=            # From Anthropic Console
ALLOWED_USER_IDS=          # Your Telegram ID
WORKSPACE_PATH=            # /path/to/projects
```

Optional:
```env
MAX_CONCURRENT_TASKS=3
TASK_TIMEOUT_MS=600000
MAX_REQUESTS_PER_USER_PER_HOUR=20
MAX_REQUESTS_PER_USER_PER_DAY=100
LOG_LEVEL=info
```

## Troubleshooting Quick Fixes

### Bot not responding
```bash
# Check if running
ps aux | grep node

# Check logs
tail -f logs/bot.log

# Restart
npm start
```

### Configuration error
```bash
# Verify .env exists and has correct values
cat .env

# Check for required fields
grep "TELEGRAM_BOT_TOKEN\|CLAUDE_API_KEY\|ALLOWED_USER_IDS" .env
```

### TypeScript errors
```bash
# Clean and rebuild
npm run clean
npm run build

# Check for errors
npx tsc --noEmit
```

### Unauthorized access
```bash
# Get your user ID: message @userinfobot on Telegram
# Add to ALLOWED_USER_IDS in .env
# Restart bot
```

### Rate limit hit
```bash
# Check limits
# In Telegram: /limits

# Adjust in .env:
# MAX_REQUESTS_PER_USER_PER_HOUR=50
# MAX_REQUESTS_PER_USER_PER_DAY=200

# Restart bot
```

### Claude CLI not found
```bash
# Install Claude Code
npm install -g @anthropic-ai/claude-code

# Verify
claude --version

# Login
claude login
```

## PM2 Quick Reference

```bash
# Start
pm2 start dist/index.js --name claude-bot

# Stop
pm2 stop claude-bot

# Restart
pm2 restart claude-bot

# Logs
pm2 logs claude-bot

# Monitor
pm2 monit

# Status
pm2 status

# Auto-start on boot
pm2 startup
pm2 save

# Delete
pm2 delete claude-bot
```

## File Locations

```
Logs:        logs/bot.log, logs/bot-error.log, logs/audit.log
Config:      .env
Source:      src/**/*.ts
Compiled:    dist/**/*.js
Types:       src/types/index.ts
```

## Port Usage

- `3000` - Health check & metrics endpoint

## Useful One-Liners

```bash
# Watch logs with error highlighting
tail -f logs/bot.log | grep --color -E "ERROR|WARN|$"

# Count total commands
wc -l logs/audit.log

# Check disk usage
du -sh logs/

# Clean old logs (keep last 5 files)
ls -t logs/*.log | tail -n +6 | xargs rm

# View recent errors
tail -50 logs/bot-error.log

# Test bot token
curl https://api.telegram.org/bot<YOUR_TOKEN>/getMe

# Check if port 3000 is in use
lsof -i :3000

# Memory usage
ps aux | grep "node.*dist/index.js"
```

## Security Checklist

- [ ] `.env` file is not committed to git
- [ ] Only trusted users in `ALLOWED_USER_IDS`
- [ ] Rate limits configured appropriately
- [ ] Audit logs are monitored
- [ ] Bot running on secure machine
- [ ] Workspace path is correct and isolated
- [ ] Regular backups of workspace

## Common Task Examples

### Fix a bug
```
/task Find and fix the authentication bug in src/auth/login.ts
```

### Add new feature
```
/task Add a new API endpoint for user profile that returns user data in JSON format
```

### Refactor code
```
/task Refactor the UserService class to use async/await instead of promises
```

### Run tests and commit
```
/test
/commit Fix authentication bug and add tests
```

### Read docs and implement
```
/read https://docs.stripe.com/payments
/task Implement Stripe payment integration based on their docs
```

## Quick Diagnosis

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Unauthorized" | User ID not in whitelist | Add to `.env` |
| "Rate limit exceeded" | Too many requests | Wait or increase limit |
| "Task timeout" | Task took >10min | Increase `TASK_TIMEOUT_MS` |
| No response | Bot not running | Check `ps aux \| grep node` |
| Wrong output | Incorrect workspace | Check `WORKSPACE_PATH` |
| API errors | Invalid API key | Verify `CLAUDE_API_KEY` |

## Getting Help

1. Check logs: `tail -f logs/bot.log`
2. Check health: `curl localhost:3000/health`
3. Review docs: `README-TYPESCRIPT.md`
4. Setup guide: `SETUP-GUIDE.md`

---

**Pro Tip**: Keep this file handy for quick reference during operations!
