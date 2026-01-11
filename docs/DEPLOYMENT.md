# Deployment Guide

This guide walks you through deploying tg-claude on Railway from scratch.

## Prerequisites

- A [Telegram](https://telegram.org/) account
- A [GitHub](https://github.com/) account
- A [Claude](https://claude.ai/) Pro or Team subscription
- A [Railway](https://railway.com/) account (free tier works)

## Step 1: Create a Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/BotFather)
2. Start a chat and send `/newbot`
3. Follow the prompts:
   - Enter a name for your bot (e.g., "My Claude Bot")
   - Enter a username ending in `bot` (e.g., `my_claude_bot`)
4. BotFather will give you a **Bot Token** like:
   ```
   7123456789:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
5. **Save this token** - you'll need it as `TELEGRAM_BOT_TOKEN`

### Get Your Telegram User ID

1. Search for [@userinfobot](https://t.me/userinfobot) on Telegram
2. Start a chat and send any message
3. It will reply with your user ID (a number like `123456789`)
4. **Save this ID** - you'll need it as `TELEGRAM_ALLOWED_USER_IDS`

> 💡 You can add multiple user IDs separated by commas: `123456789,987654321`

## Step 2: Generate GitHub Token (Optional)

A GitHub token enables:
- Cloning private repositories
- Creating new repositories via `/new_repo`
- Pushing commits to GitHub

### Create a Personal Access Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/tokens?type=beta)
2. Click **"Generate new token"**
3. Configure:
   - **Token name**: `tg-claude`
   - **Expiration**: Choose your preference (90 days recommended)
   - **Repository access**: "All repositories" or select specific ones
   - **Permissions**:
     - Repository permissions:
       - **Contents**: Read and write
       - **Metadata**: Read-only
4. Click **"Generate token"**
5. **Copy the token immediately** - you won't see it again
6. **Save this token** - you'll need it as `GITHUB_PAT`

## Step 3: Generate Claude OAuth Token

The Claude OAuth token allows tg-claude to use your Claude subscription.

### Install Claude CLI

```bash
# macOS / Linux
curl -fsSL https://claude.ai/install.sh | bash

# Or with npm
npm install -g @anthropic-ai/claude-code
```

### Login and Generate Token

```bash
# Login with your Claude account (opens browser)
claude login

# Generate OAuth token for headless/server use
claude setup-token
```

This will output something like:
```
CLAUDE_CODE_OAUTH_TOKEN=cco-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Save this token** - you'll need it for Railway.

> ⚠️ Keep this token secret! It grants access to your Claude subscription.

## Step 4: Deploy on Railway

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hEF-Y8?referralCode=56ZSuE)

1. Click the deploy button above
2. Sign in to Railway (or create an account)
3. You'll see the template configuration page

### Configure Environment Variables

Fill in the required variables:

| Variable | Value | Required |
|----------|-------|----------|
| `TELEGRAM_BOT_TOKEN` | Your bot token from Step 1 | ✅ |
| `TELEGRAM_ALLOWED_USER_IDS` | Your Telegram user ID(s) | ✅ |
| `CLAUDE_CODE_OAUTH_TOKEN` | Your Claude token from Step 3 | ✅ |
| `GITHUB_PAT` | Your GitHub token from Step 2 | Optional |

### Add Persistent Storage

The template includes a volume at `/persistent` for storing:
- Cloned repositories
- User configurations
- Bot state and logs

This is pre-configured in the template.

### Deploy

1. Click **"Deploy"**
2. Wait for the build to complete (2-3 minutes)
3. Check the logs to confirm the bot started:
   ```
   🤖 Bot is running...
   📊 Health check: http://localhost:5555/health
   ```

## Step 5: Test Your Bot

1. Open Telegram and find your bot (search for the username you created)
2. Send `/start` to see the welcome message
3. Try a simple task (just type a message):
   ```
   Create a hello world Python script
   ```

## Troubleshooting

### Bot doesn't respond

- Check Railway logs for errors
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Ensure `TELEGRAM_ALLOWED_USER_IDS` includes your Telegram ID

### Claude commands fail

- Verify `CLAUDE_CODE_OAUTH_TOKEN` is valid
- Try regenerating with `claude setup-token`
- Check if your Claude subscription is active

### GitHub operations fail

- Verify `GITHUB_PAT` has correct permissions
- Check token hasn't expired
- Ensure repository access is configured

### View Logs

In Railway dashboard:
1. Click on your service
2. Go to **"Deployments"** tab
3. Click on the active deployment
4. View real-time logs

## Updating

Railway automatically redeploys when you push to your connected GitHub repository.

To manually redeploy:
1. Go to Railway dashboard
2. Click **"Deploy"** → **"Redeploy"**

## Next Steps

- Configure your preferences with `/config`
- Set up repositories with `/repo clone <url>`
- Try autonomous mode with `/ralph <task>` (installs/uses the `ralph-loop` plugin)
- Manage plugins with `/plugin` (e.g. `/plugin preset ralph-loop`)
- See [TELEGRAM_COMMANDS.md](./TELEGRAM_COMMANDS.md) for all commands

## Using GLM Instead of Claude (Optional)

You can use [GLM-4](https://docs.z.ai/devpack/tool/claude) as an alternative AI provider. GLM is Zhipu AI's model available through Z.ai's Anthropic-compatible API.

### Get a Z.ai API Key

1. Go to [Z.ai API Key Management](https://z.ai/manage-apikey/apikey-list)
2. Create a new API key
3. Copy the key

### Switch to GLM

In Telegram, configure your bot to use GLM:

```
/config set aiProvider.provider glm
/config set aiProvider.glmApiKey YOUR_ZAI_API_KEY
```

### Switch Back to Claude

```
/config set aiProvider.provider anthropic
```

### Model Mapping

When using GLM, models are automatically mapped:

| Claude Model | GLM Model |
|--------------|-----------|
| Haiku | GLM-4.5-Air |
| Sonnet | GLM-4.7 |
| Opus | GLM-4.7 |

See [Z.ai Claude Integration Docs](https://docs.z.ai/devpack/tool/claude) for more details.

