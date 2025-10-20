# Beast Mode 🔥

**Autonomous AI Development Loop**

Beast Mode is an advanced feature that enables the AI to continuously improve and develop your codebase autonomously for extended periods.

## Overview

When enabled, Beast Mode creates a self-improving feedback loop where the AI:
- Executes tasks and analyzes results
- Detects errors, test failures, and build issues
- Automatically fixes problems and improves code
- Commits changes and repeats the cycle
- Runs for hours with minimal user intervention

## Features

### Core Capabilities
- 🔄 **Auto-Feedback Loop**: AI analyzes its own output and adjusts
- 🤖 **Autonomous Development**: Continuous improvement without user input
- 🧪 **Test-Driven**: Runs tests, fixes failures, improves coverage
- 🏗️ **Build Monitoring**: Detects and fixes build errors automatically
- 📊 **Progress Tracking**: Real-time updates via Telegram
- 🔗 **Auto Git**: Commits and pushes improvements automatically

### Safety Mechanisms
- ⏱️ **Iteration Limits**: Maximum cycles per session
- 💰 **Cost Control**: API usage limits and warnings
- 🛑 **Emergency Stop**: Instant termination via `/beast stop`
- 📉 **Rate Limiting**: Prevents API abuse
- 🔍 **Progress Monitoring**: Detailed logs and analytics

## Usage

### Enable Beast Mode

**Via Button:**
```
1. Complete a task: /task implement feature X
2. Click "🔥 Enable Beast Mode" button in response
3. AI begins autonomous development
```

**Via Command:**
```
/beast start
/beast start --max-iterations 50
/beast start --timeout 3600
```

### Monitor Progress

```
/status          # Check active Beast Mode sessions
/beast status    # Detailed Beast Mode info
/logs <taskId>   # View full iteration logs
```

### Stop Beast Mode

```
/beast stop              # Stop current session
/beast stop <taskId>     # Stop specific session
```

### Configuration

```
/beast config --max-iterations 100
/beast config --max-cost 10.00
/beast config --stop-on-success true
```

## How It Works

### Iteration Cycle

```
1. Execute Task
   ↓
2. Analyze Output
   - Parse errors
   - Check test results
   - Review build logs
   ↓
3. Decision Point
   - Success? → Commit & improve
   - Failure? → Fix issues
   - No progress? → Try different approach
   ↓
4. Take Action
   - Write/edit code
   - Run tests
   - Build project
   - Commit changes
   ↓
5. Repeat (back to step 1)
```

### Stop Conditions

Beast Mode automatically stops when:
- ✅ All tests pass and no errors detected
- 🔢 Maximum iterations reached
- ⏰ Timeout exceeded
- 💰 Cost limit reached
- 🛑 User manually stops
- ❌ No progress after N iterations

## Examples

### Example 1: Fix All Tests
```
/task write comprehensive tests
[Task completes]
[Click "Enable Beast Mode"]
→ AI runs tests, finds 12 failures
→ AI fixes 8 failures, commits
→ AI runs tests again, finds 4 failures
→ AI fixes remaining 4, commits
→ All tests pass ✅
→ Beast Mode complete (4 iterations, 23 minutes)
```

### Example 2: Build Error Resolution
```
/task refactor authentication module
[Task completes]
[Click "Enable Beast Mode"]
→ AI runs build, finds TypeScript errors
→ AI fixes type issues, commits
→ AI runs build again, finds import errors
→ AI resolves imports, commits
→ Build successful ✅
→ AI improves code quality
→ AI adds error handling
→ Beast Mode complete (6 iterations, 41 minutes)
```

### Example 3: Feature Implementation
```
/task implement user profile feature
[Task completes with basic implementation]
[Enable Beast Mode]
→ AI adds tests (iteration 1)
→ AI fixes test failures (iteration 2)
→ AI adds error handling (iteration 3)
→ AI improves validation (iteration 4)
→ AI adds documentation (iteration 5)
→ AI optimizes performance (iteration 6)
→ No more improvements needed ✅
→ Beast Mode complete (6 iterations, 1 hour)
```

## Best Practices

### When to Use Beast Mode
- ✅ After initial feature implementation
- ✅ When you have comprehensive tests
- ✅ For refactoring and optimization
- ✅ To fix multiple failing tests
- ✅ For improving code quality

### When NOT to Use Beast Mode
- ❌ For initial project setup
- ❌ When requirements are unclear
- ❌ Without tests or validation
- ❌ On production branches without review
- ❌ When costs are a primary concern

### Tips for Success
1. **Start with tests**: Beast Mode works best with existing tests
2. **Set reasonable limits**: Start with 20-30 iterations
3. **Monitor progress**: Check `/status` periodically
4. **Review changes**: Always review commits after Beast Mode
5. **Use branches**: Run Beast Mode on feature branches

## Configuration Options

### Environment Variables
```env
BEAST_MODE_ENABLED=true
BEAST_MODE_MAX_ITERATIONS=50
BEAST_MODE_MAX_TIMEOUT_MS=7200000  # 2 hours
BEAST_MODE_MAX_COST=20.00
BEAST_MODE_STOP_ON_SUCCESS=true
BEAST_MODE_MIN_PROGRESS_THRESHOLD=3
```

### Per-Session Options
- `--max-iterations <N>`: Maximum cycles (default: 50)
- `--timeout <seconds>`: Max duration (default: 7200)
- `--max-cost <dollars>`: Max API cost (default: $20)
- `--stop-on-success`: Stop when all tests pass (default: true)
- `--commit-frequency <N>`: Commit every N iterations (default: 1)

## Analytics & Logging

Beast Mode tracks:
- Total iterations
- Success/failure rate
- Time per iteration
- API costs
- Code changes (lines added/removed)
- Test coverage improvements
- Build success rate
- Commits made

Access analytics:
```
/beast stats
/beast history
/beast report <taskId>
```

## Safety & Limits

### Default Limits
- Max iterations: 50
- Max duration: 2 hours
- Max cost: $20
- Max concurrent Beast Mode sessions: 1 per user

### Override Limits (Admin Only)
- Max iterations: 200
- Max duration: 8 hours
- Max cost: $100

## Troubleshooting

### Beast Mode Not Starting
- Check repository is set up: `/repo current`
- Verify Claude CLI is working: `/check`
- Check rate limits: `/limits`

### Beast Mode Stuck in Loop
- Review logs: `/logs <taskId>`
- Check if making progress
- Stop and review code: `/beast stop`

### High API Costs
- Set cost limits: `/beast config --max-cost 5.00`
- Reduce iterations: `/beast config --max-iterations 20`
- Monitor costs: `/beast stats`

## Future Enhancements

- 🎯 **Goal-based**: Set specific objectives for Beast Mode
- 🧠 **Learning**: Remember successful patterns
- 🔀 **Multi-branch**: Run on multiple branches simultaneously
- 📧 **Notifications**: Email/Slack updates for long sessions
- 🎨 **UI Dashboard**: Web interface for monitoring
- 🤝 **Team Mode**: Collaborative Beast Mode sessions

## Architecture

See implementation in:
- `src/services/BeastMode.ts` - Core Beast Mode logic
- `src/handlers/BotHandlers.ts` - Command handlers
- `src/types/index.ts` - Type definitions
- `src/config.ts` - Configuration

---

**⚠️ Warning**: Beast Mode can consume significant API credits. Always set appropriate limits and monitor usage.

**💡 Pro Tip**: Start with small iteration limits and gradually increase as you gain confidence in Beast Mode's behavior.
