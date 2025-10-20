# Telegram Bot + Claude Code SDK Integration

Complete guide for building a Telegram bot that controls Claude Code on a remote machine to perform automated tasks like git operations, documentation reading, code analysis, and more.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [Setup Instructions](#setup-instructions)
5. [Implementation](#implementation)
6. [Usage Examples](#usage-examples)
7. [Security Considerations](#security-considerations)
8. [Troubleshooting](#troubleshooting)

---

## Overview

This project enables remote control of Claude Code through Telegram, allowing you to:

- Execute coding tasks on a remote machine
- Commit and push to git repositories
- Read and analyze documentation
- Perform code reviews and refactoring
- Run tests and builds
- All without manual permission prompts using `--dangerously-skip-permission`

**Use Case**: Control your development machine from anywhere via Telegram chat.

---

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌─────────────────┐
│             │         │                  │         │                 │
│  Telegram   │◄───────►│   Node.js Bot    │◄───────►│  Claude Code    │
│   Client    │         │   (Your Server)  │         │   CLI Process   │
│             │         │                  │         │                 │
└─────────────┘         └──────────────────┘         └─────────────────┘
                                │
                                │
                                ▼
                        ┌──────────────────┐
                        │                  │
                        │  Local Git Repo  │
                        │  & File System   │
                        │                  │
                        └──────────────────┘
```

**Flow**:
1. User sends command via Telegram
2. Bot receives message and validates user
3. Bot spawns Claude Code process with `--dangerously-skip-permission`
4. Claude Code executes task autonomously
5. Bot streams output back to Telegram
6. Task completes, results sent to user

---

## Prerequisites

### Required Software
- **Node.js** v18+ or **Python** 3.9+
- **Claude Code CLI** installed and authenticated
- **Git** installed and configured
- **Telegram Bot Token** from [@BotFather](https://t.me/botfather)
- **Claude API Key** with active subscription

### Required Accounts
- Anthropic account with Claude subscription (Pro or Team)
- Telegram account

---

## Setup Instructions

### 1. Install Claude Code CLI

```bash
# Install Claude Code globally
npm install -g @anthropic-ai/claude-code

# Or use the installer for your platform
# Visit: https://github.com/anthropics/claude-code
```

### 2. Authenticate Claude Code

```bash
# Login with your Anthropic account
claude login

# Verify authentication
claude --version
```

### 3. Create Telegram Bot

```bash
# 1. Message @BotFather on Telegram
# 2. Send: /newbot
# 3. Follow prompts to get your BOT_TOKEN
# 4. Save token securely
```

### 4. Configure Environment

Create `.env` file:

```bash
TELEGRAM_BOT_TOKEN=your_bot_token_here
CLAUDE_API_KEY=your_claude_api_key_here
ALLOWED_USER_IDS=123456789,987654321  # Your Telegram user IDs
WORKSPACE_PATH=/path/to/your/projects
MAX_CONCURRENT_TASKS=3
```

---

## Implementation

### Option 1: Node.js Implementation

**Install Dependencies**:
```bash
npm init -y
npm install node-telegram-bot-api dotenv
```

**Create `bot.js`**:

```javascript
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { spawn } = require('child_process');
const path = require('path');

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_USERS = process.env.ALLOWED_USER_IDS.split(',').map(id => parseInt(id));
const WORKSPACE_PATH = process.env.WORKSPACE_PATH;

// Initialize bot
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Active tasks tracker
const activeTasks = new Map();

// Security: Check if user is authorized
function isAuthorized(userId) {
  return ALLOWED_USERS.includes(userId);
}

// Execute Claude Code command
async function executeClaude(chatId, prompt, options = {}) {
  const {
    workingDir = WORKSPACE_PATH,
    dangerMode = true,
    additionalFlags = []
  } = options;

  // Build command
  const args = [
    prompt,
    ...(dangerMode ? ['--dangerously-skip-permission'] : []),
    ...additionalFlags
  ];

  // Spawn Claude Code process
  const claudeProcess = spawn('claude', args, {
    cwd: workingDir,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: process.env.CLAUDE_API_KEY
    }
  });

  // Track task
  const taskId = Date.now().toString();
  activeTasks.set(taskId, claudeProcess);

  let output = '';
  let errorOutput = '';

  // Send initial message
  const statusMsg = await bot.sendMessage(chatId, '🤖 Task started...\n\n```\n' + prompt + '\n```', {
    parse_mode: 'Markdown'
  });

  // Handle stdout
  claudeProcess.stdout.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;

    // Send updates every 2KB or at newlines
    if (output.length > 2048) {
      bot.editMessageText(`🔄 Processing...\n\n\`\`\`\n${output.slice(-2000)}\n\`\`\``, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      }).catch(() => {}); // Ignore edit errors
    }
  });

  // Handle stderr
  claudeProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  // Handle completion
  claudeProcess.on('close', (code) => {
    activeTasks.delete(taskId);

    const finalOutput = output || errorOutput || 'No output';
    const status = code === 0 ? '✅ Completed' : '❌ Failed';

    bot.editMessageText(
      `${status}\n\nExit code: ${code}\n\n\`\`\`\n${finalOutput.slice(-3000)}\n\`\`\``,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      }
    ).catch(() => {
      // If message is too long, send as file
      bot.sendDocument(chatId, Buffer.from(finalOutput), {}, {
        filename: 'output.txt',
        contentType: 'text/plain'
      });
    });
  });

  // Handle errors
  claudeProcess.on('error', (err) => {
    bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    activeTasks.delete(taskId);
  });

  return taskId;
}

// Command: /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized access');
    return;
  }

  bot.sendMessage(chatId, `
🤖 *Claude Code Remote Control Bot*

Available commands:

/task <description> - Execute a task
/commit <message> - Commit and push changes
/read <url> - Read documentation
/review - Review code changes
/test - Run tests
/build - Build project
/status - Check active tasks
/cancel <taskId> - Cancel a task

Example:
\`/task Fix the login bug in auth.js\`
  `, { parse_mode: 'Markdown' });
});

// Command: /task
bot.onText(/\/task (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const taskDescription = match[1];

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  await executeClaude(chatId, taskDescription);
});

// Command: /commit
bot.onText(/\/commit (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const commitMessage = match[1];

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const prompt = `Create a git commit with message: "${commitMessage}" and push to remote`;
  await executeClaude(chatId, prompt);
});

// Command: /read
bot.onText(/\/read (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const docUrl = match[1];

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const prompt = `Read and summarize the documentation at ${docUrl}`;
  await executeClaude(chatId, prompt);
});

// Command: /review
bot.onText(/\/review/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const prompt = `Review the current code changes and provide feedback`;
  await executeClaude(chatId, prompt);
});

// Command: /test
bot.onText(/\/test/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const prompt = `Run all tests and report results`;
  await executeClaude(chatId, prompt);
});

// Command: /build
bot.onText(/\/build/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const prompt = `Build the project and fix any errors`;
  await executeClaude(chatId, prompt);
});

// Command: /status
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  if (activeTasks.size === 0) {
    bot.sendMessage(chatId, 'No active tasks');
    return;
  }

  const taskList = Array.from(activeTasks.keys()).join('\n');
  bot.sendMessage(chatId, `Active tasks:\n${taskList}`);
});

// Command: /cancel
bot.onText(/\/cancel (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const taskId = match[1];

  if (!isAuthorized(userId)) {
    bot.sendMessage(chatId, '🚫 Unauthorized');
    return;
  }

  const task = activeTasks.get(taskId);
  if (!task) {
    bot.sendMessage(chatId, '❌ Task not found');
    return;
  }

  task.kill();
  activeTasks.delete(taskId);
  bot.sendMessage(chatId, '✅ Task cancelled');
});

// Error handling
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('🤖 Bot started successfully');
```

**Run the bot**:
```bash
node bot.js
```

---

### Option 2: Python Implementation

**Install Dependencies**:
```bash
pip install python-telegram-bot python-dotenv
```

**Create `bot.py`**:

```python
import os
import subprocess
import asyncio
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes
from dotenv import load_dotenv

load_dotenv()

# Configuration
BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN')
ALLOWED_USERS = list(map(int, os.getenv('ALLOWED_USER_IDS').split(',')))
WORKSPACE_PATH = os.getenv('WORKSPACE_PATH')

# Active tasks
active_tasks = {}

def is_authorized(user_id: int) -> bool:
    return user_id in ALLOWED_USERS

async def execute_claude(update: Update, prompt: str, working_dir: str = WORKSPACE_PATH):
    """Execute Claude Code command"""
    chat_id = update.effective_chat.id

    # Send initial message
    status_msg = await update.message.reply_text(
        f"🤖 Task started...\n\n```\n{prompt}\n```",
        parse_mode='Markdown'
    )

    # Build command
    cmd = ['claude', prompt, '--dangerously-skip-permission']

    try:
        # Execute process
        process = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=working_dir,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**os.environ, 'ANTHROPIC_API_KEY': os.getenv('CLAUDE_API_KEY')}
        )

        # Wait for completion
        stdout, stderr = await process.communicate()

        output = stdout.decode() if stdout else stderr.decode()
        status = '✅ Completed' if process.returncode == 0 else '❌ Failed'

        # Send result
        result_text = f"{status}\n\nExit code: {process.returncode}\n\n```\n{output[-3000:]}\n```"
        await status_msg.edit_text(result_text, parse_mode='Markdown')

    except Exception as e:
        await status_msg.edit_text(f"❌ Error: {str(e)}")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Start command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized access')
        return

    await update.message.reply_text(
        "🤖 *Claude Code Remote Control Bot*\n\n"
        "Available commands:\n\n"
        "/task <description> - Execute a task\n"
        "/commit <message> - Commit and push changes\n"
        "/read <url> - Read documentation\n"
        "/review - Review code changes\n"
        "/test - Run tests\n"
        "/build - Build project\n\n"
        "Example:\n"
        "`/task Fix the login bug in auth.js`",
        parse_mode='Markdown'
    )

async def task(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Execute task command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    if not context.args:
        await update.message.reply_text('Usage: /task <description>')
        return

    prompt = ' '.join(context.args)
    await execute_claude(update, prompt)

async def commit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Commit and push command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    if not context.args:
        await update.message.reply_text('Usage: /commit <message>')
        return

    commit_msg = ' '.join(context.args)
    prompt = f'Create a git commit with message: "{commit_msg}" and push to remote'
    await execute_claude(update, prompt)

async def read_docs(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Read documentation command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    if not context.args:
        await update.message.reply_text('Usage: /read <url>')
        return

    url = context.args[0]
    prompt = f'Read and summarize the documentation at {url}'
    await execute_claude(update, prompt)

async def review(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Review code command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    prompt = 'Review the current code changes and provide feedback'
    await execute_claude(update, prompt)

async def test(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Run tests command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    prompt = 'Run all tests and report results'
    await execute_claude(update, prompt)

async def build(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Build project command"""
    user_id = update.effective_user.id

    if not is_authorized(user_id):
        await update.message.reply_text('🚫 Unauthorized')
        return

    prompt = 'Build the project and fix any errors'
    await execute_claude(update, prompt)

def main():
    """Start the bot"""
    app = Application.builder().token(BOT_TOKEN).build()

    # Add handlers
    app.add_handler(CommandHandler('start', start))
    app.add_handler(CommandHandler('task', task))
    app.add_handler(CommandHandler('commit', commit))
    app.add_handler(CommandHandler('read', read_docs))
    app.add_handler(CommandHandler('review', review))
    app.add_handler(CommandHandler('test', test))
    app.add_handler(CommandHandler('build', build))

    print('🤖 Bot started successfully')
    app.run_polling()

if __name__ == '__main__':
    main()
```

**Run the bot**:
```bash
python bot.py
```

---

## Usage Examples

### Example 1: Fix a Bug
```
You: /task Fix the authentication bug in src/auth/login.js

Bot: 🤖 Task started...

[Claude Code analyzes the code, identifies issue, fixes it]

Bot: ✅ Completed
Fixed authentication bug in src/auth/login.js:45
Issue: Missing null check for user object
Changes committed to feature/fix-auth-bug branch
```

### Example 2: Commit and Push
```
You: /commit Add user profile caching feature

Bot: 🤖 Task started...

[Claude Code stages changes, creates commit, pushes]

Bot: ✅ Completed
Committed 3 files with message: "Add user profile caching feature"
Pushed to origin/main successfully
```

### Example 3: Read Documentation
```
You: /read https://react.dev/learn/hooks

Bot: 🤖 Task started...

[Claude Code fetches and analyzes documentation]

Bot: ✅ Completed
Summary: React Hooks documentation covers:
- useState for state management
- useEffect for side effects
- Custom hooks for reusable logic
Key concepts saved to docs/react-hooks-summary.md
```

### Example 4: Complex Task
```
You: /task Create a new API endpoint for user settings, add tests, and update the documentation

Bot: 🤖 Task started...

[Claude Code performs multiple operations]

Bot: ✅ Completed
Created:
- src/api/settings.js - New endpoint
- tests/api/settings.test.js - Unit tests (12 passed)
- docs/api.md - Updated documentation
All tests passing, ready for review
```

---

## Security Considerations

### 🔒 Critical Security Measures

1. **User Authorization**
   ```javascript
   // Always validate user IDs
   const ALLOWED_USERS = [YOUR_USER_ID_ONLY];
   ```

2. **Environment Variables**
   ```bash
   # Never commit these!
   TELEGRAM_BOT_TOKEN=secret
   CLAUDE_API_KEY=secret
   ```

3. **Rate Limiting**
   ```javascript
   // Implement rate limiting per user
   const userLimits = new Map();
   const MAX_REQUESTS_PER_HOUR = 10;
   ```

4. **Command Validation**
   ```javascript
   // Sanitize inputs
   function sanitizeCommand(input) {
     return input.replace(/[;&|`$()]/g, '');
   }
   ```

5. **Working Directory Restrictions**
   ```javascript
   // Never allow navigation outside workspace
   const workingDir = path.resolve(WORKSPACE_PATH);
   if (!targetPath.startsWith(workingDir)) {
     throw new Error('Access denied');
   }
   ```

6. **Audit Logging**
   ```javascript
   // Log all commands
   fs.appendFileSync('audit.log',
     `${new Date().toISOString()} - User ${userId}: ${command}\n`
   );
   ```

### 🚨 Risks of `--dangerously-skip-permission`

This flag bypasses all safety prompts. Claude Code will:
- Execute ANY command without confirmation
- Make ANY file changes
- Commit and push to git automatically
- Install packages without asking
- Delete files if instructed

**Mitigation**:
- Use separate git branches for bot operations
- Enable git hooks for validation
- Set up branch protection rules
- Regular backups of workspace
- Monitor for unusual activity

### Best Practices

1. **Use a dedicated machine** - Don't run on your primary development machine
2. **Separate git branches** - Bot operations on `bot/*` branches only
3. **Webhook validation** - Verify Telegram webhook signatures
4. **Token rotation** - Rotate bot tokens regularly
5. **Network isolation** - Run bot in isolated network if possible
6. **Resource limits** - Set CPU/memory limits on Claude processes
7. **Timeout handling** - Kill processes that run too long
8. **Error notifications** - Alert on failures or suspicious activity

---

## Advanced Features

### 1. Multi-Project Support

```javascript
// Project configuration
const PROJECTS = {
  'webapp': '/path/to/webapp',
  'api': '/path/to/api',
  'mobile': '/path/to/mobile'
};

// Usage: /task webapp Fix login bug
bot.onText(/\/task (\w+) (.+)/, async (msg, match) => {
  const project = match[1];
  const task = match[2];
  const workingDir = PROJECTS[project];

  if (!workingDir) {
    return bot.sendMessage(msg.chat.id, 'Unknown project');
  }

  await executeClaude(msg.chat.id, task, { workingDir });
});
```

### 2. Scheduled Tasks

```javascript
const cron = require('node-cron');

// Daily build at 9 AM
cron.schedule('0 9 * * *', async () => {
  const chatId = ADMIN_CHAT_ID;
  await executeClaude(chatId, 'Run all tests and create daily build report');
});
```

### 3. Interactive Workflows

```javascript
// Multi-step workflows
const workflows = new Map();

bot.onText(/\/workflow (.+)/, async (msg, match) => {
  const workflowName = match[1];
  const steps = WORKFLOWS[workflowName];

  for (const step of steps) {
    await executeClaude(msg.chat.id, step);
  }
});
```

### 4. Output Streaming

```javascript
// Real-time output streaming
claudeProcess.stdout.on('data', (data) => {
  const chunk = data.toString();
  bot.sendMessage(chatId, `📝 ${chunk.slice(0, 500)}`);
});
```

---

## Deployment

### Option 1: systemd Service (Linux)

Create `/etc/systemd/system/claude-bot.service`:

```ini
[Unit]
Description=Claude Code Telegram Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/bot
ExecStart=/usr/bin/node bot.js
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

### Option 2: PM2 (Node.js)

```bash
npm install -g pm2

# Start bot
pm2 start bot.js --name claude-bot

# Auto-restart on reboot
pm2 startup
pm2 save

# Monitor
pm2 logs claude-bot
pm2 monit
```

### Option 3: Docker

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install Claude Code
RUN npm install -g @anthropic-ai/claude-code

# Copy application
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "bot.js"]
```

Build and run:
```bash
docker build -t claude-bot .
docker run -d --name claude-bot \
  --env-file .env \
  -v /path/to/workspace:/workspace \
  --restart unless-stopped \
  claude-bot
```

---

## Monitoring & Maintenance

### Health Checks

```javascript
// Health check endpoint
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeTasks: activeTasks.size,
    uptime: process.uptime()
  });
});

app.listen(3000);
```

### Logging

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Log all commands
logger.info('Command executed', {
  userId: msg.from.id,
  command: msg.text,
  timestamp: new Date()
});
```

### Metrics

```javascript
// Track usage metrics
const metrics = {
  totalCommands: 0,
  successfulTasks: 0,
  failedTasks: 0,
  averageExecutionTime: 0
};

// Send daily reports
cron.schedule('0 0 * * *', () => {
  bot.sendMessage(ADMIN_CHAT_ID,
    `📊 Daily Report\n` +
    `Commands: ${metrics.totalCommands}\n` +
    `Success: ${metrics.successfulTasks}\n` +
    `Failed: ${metrics.failedTasks}`
  );
});
```

---

## Troubleshooting

### Bot Not Responding

```bash
# Check if bot is running
ps aux | grep node

# Check logs
tail -f combined.log

# Test bot token
curl https://api.telegram.org/bot<TOKEN>/getMe
```

### Claude Code Authentication Issues

```bash
# Re-authenticate
claude logout
claude login

# Check API key
echo $ANTHROPIC_API_KEY

# Test Claude manually
claude "test message" --dangerously-skip-permission
```

### Permission Denied Errors

```bash
# Fix file permissions
chmod -R 755 /path/to/workspace

# Fix git permissions
chown -R youruser:youruser /path/to/repo
```

### Out of API Credits

Monitor your usage:
```javascript
// Check API usage
const checkCredits = async () => {
  // Implement credit checking logic
  // Send alert if low
};
```

### Process Hanging

```javascript
// Add timeout to all Claude processes
const timeout = setTimeout(() => {
  claudeProcess.kill('SIGTERM');
  bot.sendMessage(chatId, '⚠️ Task timeout - killed after 10 minutes');
}, 10 * 60 * 1000);

claudeProcess.on('close', () => {
  clearTimeout(timeout);
});
```

---

## Cost Management

### Estimate Costs

- Claude Pro: $20/month (unlimited usage)
- Claude API: Pay-per-token
  - Sonnet: ~$3 per million tokens
  - Opus: ~$15 per million tokens

### Optimization Tips

1. **Set token limits**
   ```javascript
   const args = [
     prompt,
     '--dangerously-skip-permission',
     '--max-tokens', '4096'
   ];
   ```

2. **Cache frequently accessed docs**
3. **Use smaller model for simple tasks**
4. **Implement daily usage caps**
5. **Queue non-urgent tasks**

---

## FAQ

**Q: Can I use this with Claude API instead of Claude Code CLI?**
A: Yes, but you'd need to implement the full agent logic yourself. Claude Code CLI handles the agent orchestration.

**Q: Is this secure enough for production?**
A: Only if you implement ALL security measures and understand the risks. Consider it a power tool that requires careful handling.

**Q: Can multiple users use the same bot?**
A: Yes, add multiple user IDs to ALLOWED_USER_IDS, but be cautious about concurrent operations.

**Q: What if I run out of API credits?**
A: The bot will stop working until you add more credits or your subscription renews.

**Q: Can I run this on Windows?**
A: Yes, but you'll need to adjust file paths and possibly use WSL for better compatibility.

---

## Resources

- [Claude Code Documentation](https://docs.claude.com/claude-code)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Node Telegram Bot API](https://github.com/yagop/node-telegram-bot-api)
- [Python Telegram Bot](https://python-telegram-bot.org/)
- [Anthropic API Reference](https://docs.anthropic.com/api)

---

## License

MIT License - Use at your own risk

---

## Contributing

Feel free to submit issues and enhancement requests!

---

**⚠️ DISCLAIMER**: This is a powerful tool that can execute arbitrary code on your machine. Use with extreme caution and only in controlled environments. The authors are not responsible for any damages or security breaches resulting from misuse of this system.
