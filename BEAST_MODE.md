# Beast Mode

Autonomous AI development loop that iterates until tasks are complete.

## Usage

```
/beast <task description>
```

The AI will:
1. Execute the task
2. Analyze output for errors/test failures
3. Fix issues automatically
4. Repeat until success or limits reached

## Controls

- **Stop**: Click the "Stop Beast Mode" button or send `/beast stop`
- **Status**: Check `/status` for active sessions

## Configuration

Default limits (in `BeastModeExecutor.ts`):
- Max iterations: 10
- Max duration: 30 minutes
- Iteration timeout: 10 minutes

## Stop Conditions

Beast Mode stops when:
- All tests pass (success)
- Max iterations reached
- Timeout exceeded
- User stops manually

## Implementation

See `src/services/BeastModeExecutor.ts`
