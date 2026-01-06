# Telegram Bot Commands

Complete reference for all available commands in the tg-claude Telegram bot.

## Task Execution

### Plain text messages
Any plain text message (without `/` prefix) is treated as a task command.

```
add tests for the auth module
refactor the database service
```

### `/ralph <task>` (plugin: `ralph-wiggum`)
Autonomous loop mode. Claude works iteratively on a task until it's complete (or you stop it).

> **Note:** `/ralph` uses the **`ralph-wiggum` Claude plugin**. The bot will try to install it automatically, but you can also install/manage plugins explicitly via `/plugin` (see below).

```
/ralph implement the full authentication system with tests
```

Options:
- `--max <n>` - Max iterations (default: 50, max: 100)
- `--promise "TEXT"` - Completion signal (default: `RALPH_COMPLETE`)
- `--timeout <min>` - Max duration in minutes (default: 60, max: 120)

Examples:
```
/ralph Fix all failing tests and ensure 100% pass rate
/ralph Implement the user auth feature --max 100
/ralph Refactor the API --promise "ALL_DONE"
```

Stopping:
- A status message is posted with a **Stop Ralph Loop** button
- Stopping cancels the active task; any uncommitted changes remain in the working directory

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
- `git.defaultBranch` - Default branch name
- `techStack.typescript` - Package manager (bun/npm/pnpm/yarn)
- `techStack.python` - Python package manager (uv/pip/poetry)
- `preferences.notifyOnTaskComplete` - Notify when tasks finish (true/false)
- `limits.maxConcurrentTasks` - Max parallel tasks
- `limits.taskTimeoutMs` - Task timeout in milliseconds

Examples:
```
/config show
/config set git.userName "John Doe"
/config set techStack.typescript bun
/config set preferences.notifyOnTaskComplete true
```

### `/plugin`
Manage **Claude plugins per repository** (install/list/remove, plus presets).

> Plugins are installed in the context of the currently selected repository. Use `/repo current` / `/repo switch` to control where plugins are managed.

| Subcommand | Description |
|------------|-------------|
| `/plugin` | Show help |
| `/plugin presets` | Show available presets |
| `/plugin preset <name>` | Install from presets (e.g. `ralph-wiggum`) |
| `/plugin install <name>@<registry>` | Install a plugin by spec |
| `/plugin list` | Show installed plugins |
| `/plugin remove <name>` | Remove/uninstall a plugin |

Examples:
```
/plugin presets
/plugin preset ralph-wiggum
/plugin install ralph-wiggum@claude-plugins-official
/plugin list
/plugin remove ralph-wiggum
```

### `/mcp`
MCP (Model Context Protocol) server management per repository.

> **Note:** MCP servers are configured **per repository**. Each repository has its own set of MCP servers. When you switch repositories with `/repo switch`, you'll have a different MCP configuration.

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
/config set aiProvider.glmApiKey <your-z-ai-api-key>
```

Tip: you can also use `/ai` and tap **Set GLM Key** to paste your key interactively.

To switch back to Anthropic:
```
/config set aiProvider.provider anthropic
```

### OpenRouter Provider
Configure OpenRouter in `/config`:

```
/config set aiProvider.provider openrouter
/config set aiProvider.openrouterApiKey <your-openrouter-api-key>
```

Tip: you can also use `/ai` and tap **Set OpenRouter Key** to paste your key interactively.

#### Custom OpenRouter Models (UX)
Use `/ai` while on OpenRouter, then tap **H Model / S Model / O Model** to:
- Pick a preset model
- Or choose **Custom…** and paste a model id like `openai/gpt-5.2` (or `anthropic/claude-sonnet-4.5`)

## Monitoring

### `/status`
Check active tasks and their status.

### `/cancel <taskId>`
Cancel a running task by ID (you can use the first 8 chars shown in `/status`).

### `/limits`
Show your remaining rate limits (hourly/daily).

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

### `/scan`
Scan for already-synced repositories in the workspace (useful after restoring data or adding repos on disk).

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
   (auto-commit is currently always attempted on successful tasks)
   ```

3. **Provider display**: The AI provider (Claude/GLM) is shown in task output.

4. **Commit links**: After task completion, links to any commits made are displayed.

5. **Cancel tasks**: Use the Cancel button on running tasks to stop them.
