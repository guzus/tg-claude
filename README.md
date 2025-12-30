# tg-claude: Telegram Client for Claude Code

Control Claude Code remotely via Telegram with your Claude subscription.

## Pre-requisites

- **Claude subscription**: You need an active Claude Pro/Team subscription
- **Docker & Docker Compose**: For deployment

## Setup

### 1. Get Claude OAuth Token

Login to Claude and generate an OAuth token for headless environments:

```bash
# Install Claude CLI locally first
curl -fsSL https://claude.ai/install.sh | bash

# Login with your Claude subscription
claude login

# Generate OAuth token for server use
claude setup-token
```

Copy the generated `CLAUDE_CODE_OAUTH_TOKEN` value.

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token      # From @BotFather
ALLOWED_USER_IDS=123456789             # Your Telegram ID (@userinfobot)
CLAUDE_CODE_OAUTH_TOKEN=your_token     # From claude setup-token
GITHUB_TOKEN=ghp_xxx                   # Optional, for private repos
```

### 3. Deploy with Docker Compose

```bash
docker compose up -d
```

The workspace is mounted at `./workspace` - all repositories will be stored there.

## Development

```bash
bun install
bun dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/task <description>` | Execute a coding task with Claude AI |
| `/beast <task>` | Autonomous mode (iterates until complete) |
| `/repo` | Manage repositories (clone/new/list/switch) |
| `/remote` | Manage git remote (show/set/test) |
| `/bot` | Manage bots via Mothership |
| `/status` | Check active tasks |
| `/config` | User configuration |
| `/help` | Show help |

Plain text messages are treated as `/task` commands.

## Architecture

```
src/
├── handlers/           # Telegram command handlers
├── services/           # Business logic
│   ├── ClaudeExecutor  # Claude CLI process management
│   ├── GitService      # Git operations
│   ├── RepoManager     # Repository management
│   └── BeastMode       # Autonomous iteration
├── config/             # Configuration
└── utils/              # Logging, helpers
```

```mermaid
flowchart LR
    User([You]) <-->|Telegram| Bot

    subgraph Bot[Telegram Bot]
        Handler[Handlers]
        Handler --> Executor[ClaudeExecutor]
        Handler --> Beast[BeastMode]
        Executor --> Git[GitService]
        Handler --> Repo[RepoManager]
        Repo --> Git
    end

    Executor -->|spawns| Claude[Claude CLI]
    Git -->|operations| FS[(Git & Files)]
```

## Security

- User whitelist via `ALLOWED_USER_IDS`
- Rate limiting per user
- Uses `--dangerously-skip-permissions` - run only with trusted users

---

MIT License
