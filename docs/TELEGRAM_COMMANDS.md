# Telegram Bot Commands

Complete reference for all available commands in the tg-claude Telegram bot.

## Task Execution

### `/task <prompt>`
Execute a coding task with Claude AI.

```
/task add error handling to the API endpoints
/task create a new React component for user settings
```

### Plain text messages
Any plain text message (without `/` prefix) is treated as a task command.

```
add tests for the auth module
refactor the database service
```

### `/beast <prompt>`
Autonomous AI execution mode. Claude iteratively works on a task, analyzing results and continuing until completion.

```
/beast implement the full authentication system with tests
```

## Repository Management

### `/new_repo [name]`
Create a new GitHub repository with interactive prompts.

```
/new_repo                    # Prompts for name, then visibility
/new_repo my-project         # Prompts for visibility (public/private)
```

### `/repo`
Repository management submenu.

| Subcommand | Description |
|------------|-------------|
| `/repo clone <url> [name] [branch]` | Clone a repository |
| `/repo new <name>` | Create new local repository |
| `/repo add <path> [name]` | Add existing directory |
| `/repo list` | List all repositories |
| `/repo switch <id>` | Switch to repository |
| `/repo current` | Show current repository |
| `/repo delete <id>` | Delete repository |

Examples:
```
/repo clone owner/repo
/repo clone https://github.com/user/repo.git my-fork main
/repo new my-project
/repo add /path/to/existing
/repo list
/repo switch abc123
```

### `/remote`
Git remote management.

| Subcommand | Description |
|------------|-------------|
| `/remote show` | Show current remote configuration |
| `/remote set <url>` | Set remote URL |
| `/remote test` | Test remote connection |
| `/remote remove` | Remove remote |

Examples:
```
/remote show
/remote set owner/repo
/remote set https://github.com/user/repo.git
/remote test
```

## Configuration

### `/config`
User configuration management.

| Subcommand | Description |
|------------|-------------|
| `/config show` | Display current configuration |
| `/config set <key> <value>` | Set configuration value |
| `/config reset` | Reset to defaults |

Configuration keys:
- `git.userName` - Git author name
- `git.userEmail` - Git author email
- `techStack.typescript` - Package manager (bun/npm/pnpm/yarn)
- `techStack.python` - Python package manager (uv/pip/poetry)
- `preferences.autoCommit` - Auto-commit after tasks (true/false)
- `preferences.autoPush` - Auto-push after tasks (true/false)
- `preferences.dangerModeEnabled` - Skip permission prompts (true/false)
- `limits.maxConcurrentTasks` - Max parallel tasks
- `limits.taskTimeoutMs` - Task timeout in milliseconds

Examples:
```
/config show
/config set git.userName "John Doe"
/config set techStack.typescript bun
/config set preferences.autoCommit true
```

### `/mcp`
MCP (Model Context Protocol) server management per repository.

| Subcommand | Description |
|------------|-------------|
| `/mcp list` | List configured MCP servers |
| `/mcp add <name> <command> [args]` | Add MCP server |
| `/mcp remove <name>` | Remove MCP server |
| `/mcp clear` | Remove all MCP servers |

Examples:
```
/mcp list
/mcp add filesystem npx -y @modelcontextprotocol/server-filesystem /workspace
/mcp add github npx -y @modelcontextprotocol/server-github
/mcp add puppeteer npx -y @modelcontextprotocol/server-puppeteer
/mcp add memory npx -y @modelcontextprotocol/server-memory
/mcp remove filesystem
/mcp clear
```

#### Popular MCP Servers

| Server | Command | Description |
|--------|---------|-------------|
| Puppeteer | `npx -y @modelcontextprotocol/server-puppeteer` | Browser automation, screenshots |
| GitHub | `npx -y @modelcontextprotocol/server-github` | GitHub API integration |
| Filesystem | `npx -y @modelcontextprotocol/server-filesystem /path` | Enhanced file operations |
| Memory | `npx -y @modelcontextprotocol/server-memory` | Persistent memory across sessions |
| Postgres | `npx -y @modelcontextprotocol/server-postgres` | PostgreSQL database access |

## AI Provider

### GLM (Z.ai) Provider
Configure the AI provider in `/config`:

```
/config set aiProvider.provider glm
/config set aiProvider.apiKey <your-z-ai-api-key>
```

To switch back to Anthropic:
```
/config set aiProvider.provider anthropic
```

## Monitoring

### `/status`
Check active tasks and their status.

### `/check`
Verify Claude CLI installation and setup.

### `/version`
Show bot version and commit hash.

## Bot Management (Mothership)

### `/bot`
Manage bots via Mothership service.

| Subcommand | Description |
|------------|-------------|
| `/bot list` | List available bots |
| `/bot run <bot>` | Run a bot |
| `/bot status <bot>` | Check bot status |
| `/bot logs <bot>` | View bot logs |
| `/bot stop <bot>` | Stop running bot |

## Chamber Mode

### `/chamber`
GLM ↔ Anthropic conversation mode.

See [CHAMBER.md](./CHAMBER.md) for full documentation.

## Utility

### `/start`
Welcome message and command overview.

### `/help`
Show help message with available commands.

## Inline Keyboards

Many commands provide interactive inline keyboard buttons for:
- Repository selection and switching
- Task cancellation
- Visibility selection (public/private)
- Navigation between menus
- Viewing logs

## Tips

1. **Repository context**: Most task commands require an active repository. Use `/repo` or `/new_repo` first.

2. **Auto-commit**: Enable auto-commit to automatically save changes after tasks:
   ```
   /config set preferences.autoCommit true
   ```

3. **Provider display**: The AI provider (Claude/GLM) is shown in task output.

4. **Commit links**: After task completion, links to any commits made are displayed.

5. **Cancel tasks**: Use the Cancel button on running tasks to stop them.
