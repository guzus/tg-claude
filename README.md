# tg-claude: Telegram Client for Claude Code

Control Claude Code remotely via Telegram with your Claude subscription.

## Pre-requisites

- **Claude CLI with active subscription**: Login to Claude on your remote server first:
  ```bash
  claude login
  ```
  Ensure your subscription is active and authenticated before running the bot.

## Quick Start

```bash
# Install dependencies
bun install

# Build and run
bun run build && bun start

# Development
bun dev
```

### Environment

Copy `.env.example` to `.env` and configure:

```env
TELEGRAM_BOT_TOKEN=your_bot_token      # From @BotFather
ALLOWED_USER_IDS=123456789             # Your Telegram ID (from @userinfobot)
WORKSPACE_PATH=/path/to/projects
GITHUB_TOKEN=ghp_xxx                   # Optional, for private repos
```

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and command list |
| `/task <description>` | Execute a coding task with Claude AI |
| `/beast <task>` | 🔥 Autonomous AI mode (iterates until complete) |
| `/repo` | Manage repositories (clone/new/list/switch) |
| `/remote` | Manage git remote (show/set/test/remove) |
| `/bot` | 🤖 Manage bots via Mothership (run/status/logs) |
| `/status` | Check active tasks |
| `/config` | Manage user configuration |
| `/check` | Check Claude CLI installation and setup |
| `/help` | Show help message |

Plain text messages are treated as `/task` commands.

## Architecture

```mermaid
flowchart LR
    User([You]) <-->|Telegram| Bot

    subgraph Bot[Telegram Bot]
        Handler[Handlers]
        Handler --> Executor[ClaudeExecutor]
        Handler --> Beast[BeastMode]
        Handler --> Repo[RepoManager]
        Handler --> Mothership[MothershipService]
    end

    Executor -->|spawns| Claude[Claude Code CLI]
    Beast -->|iterates| Claude
    Claude <-->|read/write| FS[(Git & Files)]
```

## Security

- User whitelist via `ALLOWED_USER_IDS`
- Rate limiting (20/hour, 100/day configurable)
- Uses `--dangerously-skip-permissions` - run only with trusted users

---

MIT License
