# tg-claude: Telegram Client for Claude Code

<img src="./assets/claude.svg" width="48" alt="Claude">

Control Claude Code remotely via Telegram with your Claude subscription.

**[Demo Video](https://x.com/uncanny_guzus/status/2006073533252919361)**

## How It Works

```mermaid
flowchart TB
    subgraph User
        TG[Telegram App]
    end

    subgraph Docker Container
        Bot[tg-claude Bot]
        Claude[Claude Code CLI]
        
        subgraph Services
            Executor[ClaudeExecutor]
            Beast[BeastModeExecutor]
            Git[GitService]
            Repo[RepositoryManager]
        end
    end

    subgraph Storage["Storage (/persistent)"]
        Workspace["/persistent/workspace"]
        Data["/persistent/app/data"]
        Config["/persistent/app/config"]
    end

    subgraph External
        GitHub[GitHub]
        ClaudeAPI[Claude API]
        ZaiAPI[Z.ai GLM API]
    end

    TG -->|Commands| Bot
    Bot -->|Parse & Route| Executor
    Bot -->|Autonomous Tasks| Beast
    Executor -->|Execute| Claude
    Beast -->|Iterate| Claude
    Claude -->|OAuth| ClaudeAPI
    Claude -->|API Key| ZaiAPI
    Claude -->|Read/Write| Workspace
    Git -->|Clone/Push| GitHub
    Repo -->|Manage| Workspace
    Bot -->|State| Data
    Bot -->|Settings| Config
    Bot -->|Response| TG
```

## Pre-requisites

- **Claude subscription**: Active Claude Pro/Team subscription
- **Docker**: For deployment

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

Create a `.env` file on your server:

```env
TELEGRAM_BOT_TOKEN=your_bot_token      # From @BotFather
ALLOWED_USER_IDS=123456789             # Your Telegram ID (@userinfobot)
CLAUDE_CODE_OAUTH_TOKEN=your_token     # From claude setup-token
GITHUB_TOKEN=ghp_xxx                   # Optional, for private repos
```

### 3. Deploy

**Option A: Railway (Easiest)**

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hEF-Y8?referralCode=56ZSuE)

1. Click the button above
2. Set environment variables in Railway dashboard
3. Add a volume mounted at `/persistent`
4. Deploy

**Option B: Docker Compose (Recommended for VPS)**

```bash
# Clone the repository
git clone https://github.com/guzus/tg-claude.git
cd tg-claude

# Create .env file with your configuration
cp .env.example .env
# Edit .env with your values

# Start the bot
docker compose up -d

# Data is stored in ./persistent/ on your host
```

**Option C: Docker Hub (Pre-built Image, for VPS)**

```bash
# Pull the latest image
docker pull guzus/tg-claude:latest

# Or use a specific version
docker pull guzus/tg-claude:v0.1

# Run with docker-compose (download docker-compose.yml first)
curl -O https://raw.githubusercontent.com/guzus/tg-claude/main/docker-compose.yml
docker compose up -d
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
| `/mcp` | Manage MCP servers per repository |
| `/help` | Show help |

Plain text messages are treated as `/task` commands.

## User Configuration

### AI Provider (GLM Support)

Switch between Anthropic Claude and GLM (Z.ai) as your AI provider:

```
/config set aiProvider.provider glm        # Switch to GLM
/config set aiProvider.apiKey <your-key>   # Set your Z.ai API key
/config set aiProvider.provider anthropic  # Switch back to Claude
/config show                               # View current provider
```

GLM-4.7 is available through Z.ai's Anthropic-compatible endpoint. To use it:
1. Get a Z.ai API key from [z.ai](https://z.ai/manage-apikey/apikey-list)
2. Set the provider to `glm`
3. Set your API key

When using GLM, the following model mappings are applied automatically:
- Haiku → GLM-4.5-Air
- Sonnet → GLM-4.7
- Opus → GLM-4.7

See [Z.ai docs](https://docs.z.ai/devpack/tool/claude) for more details.

### Tech Stack Preferences

Set your preferred package managers:

```
/config techstack typescript bun    # Options: bun, npm, pnpm, yarn
/config techstack python uv         # Options: uv, pip, poetry, pipenv
```

These preferences are synced to `.claude/settings.json` in each repository.

### MCP Servers

Configure Model Context Protocol servers per repository:

```
/mcp add <name> <command> [args...]  # Add MCP server
/mcp remove <name>                   # Remove MCP server
/mcp list                            # List configured servers
/mcp clear                           # Remove all servers
```

MCP configs are stored in `.mcp.json` at the repository root.

### CLAUDE.md Template

Set a custom template for new repositories:

```
/config claudemd show    # View current template
/config claudemd set     # Set new template (send content after)
/config claudemd reset   # Reset to default
```

## Development

```bash
bun install
bun dev
```

### Build Locally

```bash
docker compose build
docker compose up -d
```

## Security

- User whitelist via `ALLOWED_USER_IDS`
- Rate limiting per user
- Uses `--dangerously-skip-permissions` - run only with trusted users

---

MIT License
