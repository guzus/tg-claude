import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeExecutor } from './ClaudeExecutor';
import { RepositoryManager } from './RepositoryManager';
import { TaskStatus, Repository, AIProviderConfig } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';

// Ralph Loop status enum
export enum RalphLoopStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  MAX_ITERATIONS = 'max_iterations',
  TIMEOUT = 'timeout',
  FAILED = 'failed'
}

// Ralph Loop configuration
export interface RalphLoopConfig {
  maxIterations: number;
  completionPromise: string;
  maxDurationMs: number;
}

// Ralph Loop state
export interface RalphLoopState {
  sessionId: string;
  userId: number;
  chatId: number;
  originalRequest: string;
  workingDir: string;
  status: RalphLoopStatus;
  iteration: number;
  startTime: Date;
  endTime?: Date;
  config: RalphLoopConfig;
  messageId?: number;
  taskId?: string;
  cleanedUp: boolean;
  aiProvider?: AIProviderConfig;
}

// Default configuration
const DEFAULT_RALPH_CONFIG: RalphLoopConfig = {
  maxIterations: 50,
  completionPromise: 'RALPH_COMPLETE',
  maxDurationMs: 60 * 60 * 1000 // 1 hour
};

// Session cleanup delay
const SESSION_CLEANUP_DELAY_MS = 60 * 60 * 1000;

// Task poll interval
const TASK_POLL_INTERVAL_MS = 5000;

// The Ralph Wiggum stop hook script
const STOP_HOOK_SCRIPT = `#!/bin/bash
# Ralph Wiggum Stop Hook - Prevents session exit and re-feeds the prompt

STATE_FILE=".claude/ralph-loop.local.md"

# Exit if no state file (ralph loop not active)
if [[ ! -f "$STATE_FILE" ]]; then
  echo '{"decision": "allow"}'
  exit 0
fi

# Read state
iteration=$(grep -oP 'iteration:\\s*\\K\\d+' "$STATE_FILE" 2>/dev/null || echo "0")
max_iterations=$(grep -oP 'max_iterations:\\s*\\K\\d+' "$STATE_FILE" 2>/dev/null || echo "50")
completion_promise=$(grep -oP 'completion_promise:\\s*\\K.*' "$STATE_FILE" 2>/dev/null || echo "RALPH_COMPLETE")

# Validate numbers
if ! [[ "$iteration" =~ ^[0-9]+$ ]] || ! [[ "$max_iterations" =~ ^[0-9]+$ ]]; then
  echo "State file corrupted, cleaning up" >&2
  rm -f "$STATE_FILE"
  echo '{"decision": "allow"}'
  exit 0
fi

# Check max iterations
if [[ "$iteration" -ge "$max_iterations" ]]; then
  rm -f "$STATE_FILE"
  echo '{"decision": "allow"}'
  exit 0
fi

# Check for completion promise in transcript
transcript_file="\${CLAUDE_TRANSCRIPT_FILE:-}"
if [[ -n "$transcript_file" && -f "$transcript_file" ]]; then
  last_message=$(tail -1 "$transcript_file" 2>/dev/null | jq -r '.message.content // ""' 2>/dev/null || echo "")
  if echo "$last_message" | grep -q "$completion_promise"; then
    rm -f "$STATE_FILE"
    echo '{"decision": "allow"}'
    exit 0
  fi
fi

# Increment iteration and continue
new_iteration=$((iteration + 1))
sed -i "s/iteration: $iteration/iteration: $new_iteration/" "$STATE_FILE"

# Extract original prompt
prompt=$(sed -n '/^---$/,/^---$/{ /^---$/d; p; }' "$STATE_FILE" | head -c 10000)

# Build continuation message
continue_msg="[Ralph Loop Iteration $new_iteration/$max_iterations]

Continue working on the task. Previous work persists in files.

When the task is FULLY complete and verified, output exactly: $completion_promise

Original task:
$prompt"

# Return block decision with continuation
echo "{\\\"decision\\\": \\\"block\\\", \\\"reason\\\": \\\"Ralph loop iteration $new_iteration\\\", \\\"prompt\\\": $(echo "$continue_msg" | jq -Rs .)}"
`;

// The ralph-loop command markdown
const RALPH_LOOP_COMMAND = `---
description: Start a Ralph Wiggum loop for autonomous task completion
hidden: true
---

# Ralph Loop

This starts an autonomous loop that keeps working until the task is complete.

## How It Works

1. The stop hook intercepts exit attempts
2. Your work persists in files and git history
3. Loop continues until you output the completion promise
4. Maximum iterations prevent infinite loops

## Important

- Only output the completion promise when the task is GENUINELY complete
- Do not use it as an escape mechanism
- Verify your work passes tests before completing

When done, output: {{COMPLETION_PROMISE}}
`;

/**
 * Ralph Loop Executor - Implements the Ralph Wiggum autonomous loop pattern
 * Based on https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
 */
export class RalphLoopExecutor {
  private bot: TelegramBot;
  private executor: ClaudeExecutor;
  private repositoryManager: RepositoryManager;
  private activeSessions: Map<string, RalphLoopState> = new Map();
  private userSessions: Map<number, string> = new Map();

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    repositoryManager: RepositoryManager
  ) {
    this.bot = bot;
    this.executor = executor;
    this.repositoryManager = repositoryManager;
  }

  /**
   * Set up Ralph Wiggum plugin files in the repository
   */
  private async setupRalphPlugin(workingDir: string, config: RalphLoopConfig, prompt: string): Promise<void> {
    const claudeDir = path.join(workingDir, '.claude');
    const commandsDir = path.join(claudeDir, 'commands');
    const hooksDir = path.join(claudeDir, 'hooks');

    // Create directories
    if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
    if (!fs.existsSync(commandsDir)) fs.mkdirSync(commandsDir, { recursive: true });
    if (!fs.existsSync(hooksDir)) fs.mkdirSync(hooksDir, { recursive: true });

    // Write the stop hook
    const hookPath = path.join(hooksDir, 'stop-hook.sh');
    fs.writeFileSync(hookPath, STOP_HOOK_SCRIPT, { mode: 0o755 });

    // Write the ralph-loop command
    const commandPath = path.join(commandsDir, 'ralph-loop.md');
    const commandContent = RALPH_LOOP_COMMAND.replace('{{COMPLETION_PROMISE}}', config.completionPromise);
    fs.writeFileSync(commandPath, commandContent);

    // Write the state file with the prompt
    const stateFile = path.join(claudeDir, 'ralph-loop.local.md');
    const stateContent = `iteration: 1
max_iterations: ${config.maxIterations}
completion_promise: ${config.completionPromise}
---
${prompt}
---
`;
    fs.writeFileSync(stateFile, stateContent);

    // Create settings.json to register the hook
    const settingsPath = path.join(claudeDir, 'settings.json');
    const settings = {
      hooks: {
        Stop: [{
          matcher: '',
          hooks: [{
            type: 'command',
            command: path.join('.claude', 'hooks', 'stop-hook.sh')
          }]
        }]
      }
    };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    logger.info('Ralph plugin files set up', { workingDir });
  }

  /**
   * Clean up Ralph plugin files
   */
  private cleanupRalphPlugin(workingDir: string): void {
    try {
      const stateFile = path.join(workingDir, '.claude', 'ralph-loop.local.md');
      if (fs.existsSync(stateFile)) {
        fs.unlinkSync(stateFile);
      }
    } catch (error) {
      logger.warn('Failed to cleanup Ralph state file', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Start a Ralph loop session
   */
  async startSession(
    userId: number,
    chatId: number,
    request: string,
    workingDir: string,
    config: Partial<RalphLoopConfig> = {},
    aiProvider?: AIProviderConfig
  ): Promise<RalphLoopState> {
    // Validate working directory
    if (!path.isAbsolute(workingDir) || !fs.existsSync(workingDir)) {
      throw new Error('Invalid working directory');
    }

    // Check for existing session
    const existingSessionId = this.userSessions.get(userId);
    if (existingSessionId) {
      const existingSession = this.activeSessions.get(existingSessionId);
      if (existingSession && existingSession.status === RalphLoopStatus.RUNNING) {
        throw new Error('You already have an active Ralph loop. Stop it first.');
      }
    }

    const sessionId = uuidv4();
    const finalConfig: RalphLoopConfig = { ...DEFAULT_RALPH_CONFIG, ...config };

    const state: RalphLoopState = {
      sessionId,
      userId,
      chatId,
      originalRequest: request.trim().substring(0, 10000),
      workingDir,
      status: RalphLoopStatus.RUNNING,
      iteration: 1,
      startTime: new Date(),
      config: finalConfig,
      cleanedUp: false,
      aiProvider
    };

    this.userSessions.set(userId, sessionId);
    this.activeSessions.set(sessionId, state);

    logger.info('Ralph loop session started', {
      sessionId,
      userId,
      maxIterations: finalConfig.maxIterations,
      completionPromise: finalConfig.completionPromise
    });

    // Run the loop
    this.runRalphLoop(state).catch(error => {
      logger.error('Ralph loop failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.cleanupSession(state);
    });

    return state;
  }

  /**
   * Clean up session
   */
  private cleanupSession(state: RalphLoopState): void {
    if (state.cleanedUp) return;
    state.cleanedUp = true;

    this.userSessions.delete(state.userId);
    this.cleanupRalphPlugin(state.workingDir);

    if (!state.endTime) state.endTime = new Date();
    if (state.status === RalphLoopStatus.RUNNING) {
      state.status = RalphLoopStatus.FAILED;
    }

    setTimeout(() => {
      this.activeSessions.delete(state.sessionId);
    }, SESSION_CLEANUP_DELAY_MS);

    logger.info('Ralph loop session cleaned up', {
      sessionId: state.sessionId,
      status: state.status,
      iterations: state.iteration
    });
  }

  /**
   * Stop a session
   */
  stopSession(sessionId: string): boolean {
    const state = this.activeSessions.get(sessionId);
    if (!state || state.cleanedUp) return false;

    state.status = RalphLoopStatus.STOPPED;
    state.endTime = new Date();

    // Cancel active task
    if (state.taskId) {
      this.executor.cancelTask(state.taskId);
    }

    this.cleanupSession(state);
    return true;
  }

  /**
   * Stop session by user ID
   */
  stopSessionByUser(userId: number): boolean {
    const sessionId = this.userSessions.get(userId);
    return sessionId ? this.stopSession(sessionId) : false;
  }

  /**
   * Get user's active session
   */
  getUserSession(userId: number): RalphLoopState | undefined {
    const sessionId = this.userSessions.get(userId);
    return sessionId ? this.activeSessions.get(sessionId) : undefined;
  }

  /**
   * Run the Ralph loop
   */
  private async runRalphLoop(state: RalphLoopState): Promise<void> {
    try {
      // Set up plugin files
      await this.setupRalphPlugin(state.workingDir, state.config, state.originalRequest);

      // Send initial status message
      const repository = this.repositoryManager.getCurrentRepository(state.userId);
      const statusMsg = await this.sendStatusMessage(state, repository);
      state.messageId = statusMsg?.message_id;

      // Build the initial prompt
      const prompt = this.buildInitialPrompt(state, repository);

      // Execute single Claude task (the hook handles iterations)
      const task = await this.executor.executeTask(
        state.userId,
        state.chatId,
        prompt,
        {
          workingDir: state.workingDir,
          timeout: state.config.maxDurationMs,
          aiProvider: state.aiProvider
        }
      );

      state.taskId = task.id;

      // Wait for task completion with progress monitoring
      await this.monitorTask(state, task.id);

      // Determine final status
      await this.determineOutcome(state);

      // Send final report
      await this.sendFinalReport(state);

      // Commit and push if successful
      if (state.status === RalphLoopStatus.COMPLETED) {
        await this.finalCommitAndPush(state);
      }

    } finally {
      this.cleanupSession(state);
    }
  }

  /**
   * Build initial prompt for Ralph loop
   */
  private buildInitialPrompt(state: RalphLoopState, repository: Repository | null): string {
    return `# Ralph Loop Task

You are in a **Ralph Wiggum Loop** - an autonomous development mode.

## How This Works
- A stop hook prevents session exit and re-feeds the prompt
- Your previous work persists in files and git history
- Keep iterating until the task is FULLY complete
- Maximum ${state.config.maxIterations} iterations allowed

## Repository
${repository ? `- **Name**: ${repository.name}\n- **Branch**: ${repository.branch || 'main'}` : 'No repository context'}

## Task
${state.originalRequest}

## Instructions
1. Analyze the task and plan your approach
2. Implement the solution
3. Run tests to verify
4. Fix any failures
5. When COMPLETELY done and verified, output exactly: **${state.config.completionPromise}**

## CRITICAL
- Only output the completion promise when genuinely done
- Do NOT use it as an escape when stuck
- Each iteration builds on previous work
- Files and git history persist between iterations

**BEGIN - Execute with full autonomy until complete.**`;
  }

  /**
   * Monitor task progress
   */
  private async monitorTask(state: RalphLoopState, taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastIteration = 1;

      const interval = setInterval(async () => {
        // Check timeout
        if (Date.now() - startTime > state.config.maxDurationMs) {
          clearInterval(interval);
          state.status = RalphLoopStatus.TIMEOUT;
          state.endTime = new Date();
          resolve();
          return;
        }

        // Check if stopped
        if (state.status !== RalphLoopStatus.RUNNING) {
          clearInterval(interval);
          resolve();
          return;
        }

        // Check task status
        const task = this.executor.getTask(taskId);
        if (!task) {
          clearInterval(interval);
          resolve();
          return;
        }

        // Read current iteration from state file
        try {
          const stateFile = path.join(state.workingDir, '.claude', 'ralph-loop.local.md');
          if (fs.existsSync(stateFile)) {
            const content = fs.readFileSync(stateFile, 'utf-8');
            const match = content.match(/iteration:\s*(\d+)/);
            if (match) {
              const currentIteration = parseInt(match[1], 10);
              if (currentIteration !== lastIteration) {
                lastIteration = currentIteration;
                state.iteration = currentIteration;
                await this.updateStatusMessage(state);
              }
            }
          } else {
            // State file removed = loop completed
            clearInterval(interval);
            state.status = RalphLoopStatus.COMPLETED;
            state.endTime = new Date();
            resolve();
            return;
          }
        } catch {
          // Ignore file read errors
        }

        // Check if task finished
        if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
          clearInterval(interval);
          state.endTime = new Date();
          resolve();
        }
      }, TASK_POLL_INTERVAL_MS);
    });
  }

  /**
   * Determine outcome based on state
   */
  private async determineOutcome(state: RalphLoopState): Promise<void> {
    if (state.status !== RalphLoopStatus.RUNNING) return;

    // Check if state file still exists (loop completed if removed)
    const stateFile = path.join(state.workingDir, '.claude', 'ralph-loop.local.md');
    if (!fs.existsSync(stateFile)) {
      state.status = RalphLoopStatus.COMPLETED;
    } else {
      // Read iteration count
      try {
        const content = fs.readFileSync(stateFile, 'utf-8');
        const match = content.match(/iteration:\s*(\d+)/);
        if (match) {
          const iteration = parseInt(match[1], 10);
          if (iteration >= state.config.maxIterations) {
            state.status = RalphLoopStatus.MAX_ITERATIONS;
          }
        }
      } catch {
        // Default to failed
      }

      if (state.status === RalphLoopStatus.RUNNING) {
        state.status = RalphLoopStatus.FAILED;
      }
    }
  }

  /**
   * Send status message
   */
  private async sendStatusMessage(
    state: RalphLoopState,
    repository: Repository | null
  ): Promise<TelegramBot.Message | undefined> {
    try {
      const message = this.formatStatusMessage(state, repository);
      return await this.bot.sendMessage(state.chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🛑 Stop Ralph Loop', callback_data: `ralph_stop:${state.sessionId}` }
          ]]
        }
      });
    } catch (error) {
      logger.error('Failed to send Ralph status message', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  /**
   * Format status message
   */
  private formatStatusMessage(state: RalphLoopState, repository: Repository | null): string {
    const elapsed = Math.round((Date.now() - state.startTime.getTime()) / 1000);
    const emoji = state.status === RalphLoopStatus.RUNNING ? '🔄' :
                  state.status === RalphLoopStatus.COMPLETED ? '✅' : '⚠️';

    let msg = `${emoji} **Ralph Loop**\n\n`;
    msg += `📋 ${state.originalRequest.substring(0, 100)}${state.originalRequest.length > 100 ? '...' : ''}\n\n`;
    msg += `🔄 Iteration: ${state.iteration} / ${state.config.maxIterations}\n`;
    msg += `⏱️ Time: ${UIHelpers.formatDuration(elapsed)}\n`;
    msg += `🎯 Promise: \`${state.config.completionPromise}\`\n`;
    if (repository) {
      msg += `📁 Repo: ${repository.name}\n`;
    }

    return msg;
  }

  /**
   * Update status message
   */
  private async updateStatusMessage(state: RalphLoopState): Promise<void> {
    if (!state.messageId) return;

    try {
      const repository = this.repositoryManager.getCurrentRepository(state.userId);
      const keyboard = state.status === RalphLoopStatus.RUNNING ? {
        inline_keyboard: [[
          { text: '🛑 Stop Ralph Loop', callback_data: `ralph_stop:${state.sessionId}` }
        ]]
      } : undefined;

      await this.bot.editMessageText(this.formatStatusMessage(state, repository), {
        chat_id: state.chatId,
        message_id: state.messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch {
      // Ignore edit errors
    }
  }

  /**
   * Send final report
   */
  private async sendFinalReport(state: RalphLoopState): Promise<void> {
    try {
      const duration = state.endTime
        ? Math.round((state.endTime.getTime() - state.startTime.getTime()) / 1000)
        : 0;

      const statusEmoji =
        state.status === RalphLoopStatus.COMPLETED ? '✅' :
        state.status === RalphLoopStatus.MAX_ITERATIONS ? '⚠️' :
        state.status === RalphLoopStatus.TIMEOUT ? '⏰' :
        state.status === RalphLoopStatus.STOPPED ? '🛑' : '❌';

      const statusText =
        state.status === RalphLoopStatus.COMPLETED ? 'Completed!' :
        state.status === RalphLoopStatus.MAX_ITERATIONS ? 'Max Iterations' :
        state.status === RalphLoopStatus.TIMEOUT ? 'Timeout' :
        state.status === RalphLoopStatus.STOPPED ? 'Stopped' : 'Failed';

      let report = `${statusEmoji} **Ralph Loop ${statusText}**\n\n`;
      report += `📋 ${state.originalRequest.substring(0, 200)}\n\n`;
      report += `📊 **Summary**:\n`;
      report += `• Iterations: ${state.iteration}\n`;
      report += `• Duration: ${UIHelpers.formatDuration(duration)}\n`;
      report += `• Promise: ${state.config.completionPromise}\n`;

      await this.bot.sendMessage(state.chatId, report, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to send Ralph final report', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Final commit and push
   */
  private async finalCommitAndPush(state: RalphLoopState): Promise<void> {
    try {
      const commitHash = await this.executor.autoCommitChanges(state.workingDir);
      if (commitHash) {
        const pushResult = await this.executor.autoPushChanges(state.workingDir);

        let message = '💾 **Ralph Loop Changes**\n\n';
        message += `Commit: \`${commitHash.substring(0, 8)}\`\n`;
        message += pushResult === 'success' ? '✅ Pushed' :
                   pushResult === 'no_remote' ? '⚠️ No remote' : '⚠️ Push failed';

        await this.bot.sendMessage(state.chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      logger.error('Failed to commit/push Ralph changes', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
