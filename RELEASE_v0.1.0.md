## tg-claude v0.1.0

Control Claude Code remotely via Telegram.

### Features
- Execute Claude Code tasks from anywhere via Telegram
- **Beast Mode**: Autonomous task execution with iteration until complete
- Repository management (clone, create, switch)
- Git operations (commit, push, pull)
- MCP server configuration per repository
- GLM support as alternative AI provider

### Requirements
- Claude Pro/Team subscription (or [Z.ai](https://z.ai) API key for GLM)
- Telegram bot token from [@BotFather](https://t.me/BotFather)

### Deployment

| Method | Command / Link |
|--------|----------------|
| **Railway** (easiest) | [![Deploy on Railway](https://railway.app/button.svg)](https://railway.com/deploy/hEF-Y8?referralCode=56ZSuE) |
| **Docker Hub** | `docker pull guzus/tg-claude:0.1.0` |
| **Self-hosted** | `git clone` + `docker compose up -d` |

**[Full Deployment Guide](https://github.com/guzus/tg-claude/blob/main/docs/DEPLOYMENT.md)** - Step-by-step setup

### Documentation
- [Deployment Guide](https://github.com/guzus/tg-claude/blob/main/docs/DEPLOYMENT.md) - Railway, Docker, VPS setup
- [Telegram Commands](https://github.com/guzus/tg-claude/blob/main/docs/TELEGRAM_COMMANDS.md) - Full command reference
- [Chamber Mode](https://github.com/guzus/tg-claude/blob/main/docs/CHAMBER.md) - Advanced multi-agent workflows

### Links
- [Demo Video](https://x.com/uncanny_guzus/status/2006073533252919361)
- [GitHub Repository](https://github.com/guzus/tg-claude)
- [Docker Hub](https://hub.docker.com/r/guzus/tg-claude)

