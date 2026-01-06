import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ClaudeExecutor } from './ClaudeExecutor';
import { RepositoryManager } from './RepositoryManager';
import { TaskStatus, Repository, AIProviderConfig } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { PLUGIN_PRESETS } from '../presets';

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

/**
 * Ralph Loop Executor - Implements the Ralph Wiggum autonomous loop pattern
 * Uses native Claude plugin: claude plugin install ralph-wiggum@claude-plugins-official
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
   * Ensure ralph-wiggum plugin is installed
   */
  private async ensureRalphPluginInstalled(workingDir: string): Promise<void> {
    const preset = PLUGIN_PRESETS['ralph-wiggum'];
    if (!preset) {
      throw new Error('Ralph Wiggum plugin preset not found');
    }

    const pluginSpec = `${preset.name}@${preset.registry}`;

    try {
      // Try to install (will be a no-op if already installed)
      execSync(`claude plugin install ${pluginSpec}`, {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('Ralph Wiggum plugin ready', { workingDir, pluginSpec });
    } catch (error) {
      // Log warning but don't fail - plugin might already be installed
      logger.warn('Plugin install returned non-zero', {
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
      // Ensure ralph-wiggum plugin is installed
      await this.ensureRalphPluginInstalled(state.workingDir);

      // Send initial status message
      const repository = this.repositoryManager.getCurrentRepository(state.userId) ?? null;
      const statusMsg = await this.sendStatusMessage(state, repository);
      state.messageId = statusMsg?.message_id;

      // Build the prompt with Ralph loop instructions
      const prompt = this.buildRalphPrompt(state, repository);

      // Execute Claude task with the Ralph plugin active
      // The plugin handles iterations via stop hooks
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

      // Determine final status based on task outcome
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
   * Build the Ralph loop prompt
   */
  private buildRalphPrompt(state: RalphLoopState, repository: Repository | null): string {
    return `# Ralph Loop Task

You are in a **Ralph Wiggum Loop** - an autonomous development mode.

## How This Works
- The ralph-wiggum plugin intercepts exit attempts via stop hooks
- Your work persists in files and git history
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

        // Update status message periodically
        await this.updateStatusMessage(state);

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
   * Determine outcome based on task result
   */
  private async determineOutcome(state: RalphLoopState): Promise<void> {
    if (state.status !== RalphLoopStatus.RUNNING) return;

    // Check task output for completion promise
    if (state.taskId) {
      const task = this.executor.getTask(state.taskId);
      if (task?.output?.includes(state.config.completionPromise)) {
        state.status = RalphLoopStatus.COMPLETED;
        return;
      }

      // Check if task completed successfully
      if (task?.status === TaskStatus.COMPLETED) {
        state.status = RalphLoopStatus.COMPLETED;
        return;
      }

      // Check if task failed
      if (task?.status === TaskStatus.FAILED || task?.status === TaskStatus.TIMEOUT) {
        state.status = RalphLoopStatus.FAILED;
        return;
      }
    }

    // Default to failed if we can't determine
    state.status = RalphLoopStatus.FAILED;
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
      const repository = this.repositoryManager.getCurrentRepository(state.userId) ?? null;
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
      // Ignore edit errors (message not modified, etc.)
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
