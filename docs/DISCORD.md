# Discord Integration Guide

This guide covers setting up the Discord client for tg-claude.

## Overview

The Discord client uses a **channel-based mono-repo model**:
- Each Discord channel maps to its own workspace folder
- One channel = one repository (no multi-repo switching like Telegram)
- Plain text messages in channels execute as Claude tasks

## Prerequisites

- A Discord account
- A Discord server where you have admin permissions
- Your Discord user ID

## Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**
3. Give it a name (e.g., "Claude Code Bot")
4. Click **Create**

## Step 2: Create a Bot

1. In your application, go to the **Bot** section
2. Click **Add Bot**
3. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (required to read message content)
4. Click **Reset Token** to get your bot token
5. Copy the token - you'll need it for `DISCORD_BOT_TOKEN`

> **Important**: Never share your bot token publicly!

## Step 3: Get Your Client ID

1. Go to **OAuth2** → **General**
2. Copy the **Client ID** - you'll need it for `DISCORD_CLIENT_ID`

## Step 4: Get Your User ID

1. In Discord, go to **Settings** → **Advanced**
2. Enable **Developer Mode**
3. Right-click your username and select **Copy User ID**
4. This is your `DISCORD_ALLOWED_USER_IDS`

## Step 5: Invite the Bot to Your Server

1. Go to **OAuth2** → **URL Generator**
2. Select scopes:
   - `bot`
   - `applications.commands`
3. Select bot permissions:
   - Send Messages
   - Embed Links
   - Read Message History
   - Use Slash Commands
4. Copy the generated URL and open it in your browser
5. Select your server and authorize

## Step 6: Configure Environment Variables

Add these to your `.env` file:

```bash
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_ALLOWED_USER_IDS=your_user_id_here

# Optional: For faster command registration during development
# Set to your server ID to register commands instantly (instead of waiting ~1 hour)
DISCORD_GUILD_ID=your_server_id_here
```

### Getting Your Server ID (Optional)

1. Right-click your server name in Discord
2. Select **Copy Server ID**
3. Use this for `DISCORD_GUILD_ID`

## Step 7: Start the Bot

```bash
bun run start
```

You should see:
```
📱 Telegram: enabled
💬 Discord: enabled
```

## Usage

### Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/status` | Show active tasks in this channel |
| `/cancel <task_id>` | Cancel a running task |
| `/version` | Show bot version |

### Executing Tasks

Simply send a plain text message in any channel where the bot is present. The message will be executed as a Claude task in that channel's workspace folder.

Example:
```
Create a Python script that prints "Hello, World!"
```

### Channel Workspaces

Each Discord channel has its own isolated workspace:
```
/workspace/discord_{channel-name}_{channel-id-suffix}/
```

For example, a channel named `#my-project` might have workspace:
```
/workspace/discord_my_project_abc123/
```

## Multiple Users

To allow multiple Discord users, add their IDs comma-separated:

```bash
DISCORD_ALLOWED_USER_IDS=123456789,987654321,555555555
```

## Troubleshooting

### Bot doesn't respond to messages

1. Check that **Message Content Intent** is enabled in the Developer Portal
2. Verify the user ID is in `DISCORD_ALLOWED_USER_IDS`
3. Check the bot has permissions to read/send messages in the channel

### Slash commands not appearing

1. If using `DISCORD_GUILD_ID`, commands appear instantly
2. Without it, global commands can take up to 1 hour to propagate
3. Try kicking and re-inviting the bot

### "Unknown interaction" errors

The bot may be taking too long to respond. Discord requires responses within 3 seconds. Check your Claude execution performance.

## Security Notes

- Only users in `DISCORD_ALLOWED_USER_IDS` can execute commands
- Each channel is rate-limited independently
- The bot uses `--dangerously-skip-permissions` - only allow trusted users
