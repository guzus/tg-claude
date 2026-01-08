import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ClaudeExecutor } from './ClaudeExecutor';
import { RepositoryManager } from './RepositoryManager';
import { ensureDefaultPluginMarketplaces } from './ClaudePluginMarketplace';
import { TaskStatus, Repository, AIProviderConfig, StreamEvent, ClaudeTaskWithStreaming } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../clients/telegram/utils/UIHelpers';
import { PLUGIN_PRESETS } from '../presets';
import { getErrorMessage } from '../utils/errors';

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
 * Uses native Claude plugin: claude plugin install ralph-loop@claude-plugins-official
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
   * Ensure ralph-loop plugin is installed
   */
  private async ensureRalphPluginInstalled(
    workingDir: string
  ): Promise<{ ok: true } | { ok: false; error: string; pluginSpec: string }> {
    const preset = PLUGIN_PRESETS['ralph-loop'];
    if (!preset) {
      throw new Error('Ralph Wiggum plugin preset not found');
    }

    const pluginSpec = `${preset.name}@${preset.registry}`;

    try {
      // Ensure default marketplaces exist before installing the plugin
      ensureDefaultPluginMarketplaces(workingDir);

      // Try to install (will be a no-op if already installed)
      execSync(`claude plugin install ${pluginSpec}`, {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('Ralph Wiggum plugin ready', { workingDir, pluginSpec });
      return { ok: true };
    } catch (error) {
      // Log warning but don't fail - plugin might already be installed
      const errMsg = getErrorMessage(error);
      logger.warn('Plugin install returned non-zero', {
        workingDir,
        error: errMsg
      });

      // If it looks like a marketplace issue, try adding marketplaces and retry once.
      if (errMsg.includes('marketplace') || errMsg.includes('Plugin') && errMsg.includes('not found')) {
        try {
          ensureDefaultPluginMarketplaces(workingDir);
          execSync(`claude plugin install ${pluginSpec}`, {
            cwd: workingDir,
            encoding: 'utf-8',
            timeout: 60000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          logger.info('Ralph Wiggum plugin ready after marketplace ensure', { workingDir, pluginSpec });
          return { ok: true };
        } catch (retryError) {
          const retryMsg = getErrorMessage(retryError);
          return { ok: false, error: retryMsg, pluginSpec };
        }
      }
      return { ok: false, error: errMsg, pluginSpec };
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
        error: getErrorMessage(error)
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
      // Ensure ralph-loop plugin is installed
      const pluginResult = await this.ensureRalphPluginInstalled(state.workingDir);
      if (!pluginResult.ok) {
        // Let the user know the loop may not be enforced if the plugin isn't available
        try {
          const msg =
            `⚠️ Could not install the \`ralph-loop\` plugin.\n\n` +
            `Install error:\n` +
            `\`${UIHelpers.escapeMarkdown(pluginResult.error.substring(0, 500))}\`\n\n` +
            `Try:\n` +
            `- \`/plugin preset ralph-loop\`\n` +
            `- \`/plugin install ${UIHelpers.escapeMarkdown(pluginResult.pluginSpec)}\`\n` +
            `- Or update Claude Code CLI if the marketplace has changed.\n\n` +
            `Continuing anyway…`;
          await this.bot.sendMessage(state.chatId, msg, { parse_mode: 'Markdown' });
        } catch {
          // Ignore notification errors
        }
      }

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

      // Update status message to remove "Stop" button and show final state
      await this.updateStatusMessage(state);

      // Send final report
      await this.sendFinalReport(state);

      // Always try to commit and push changes (work may have been done even if not completed)
      await this.finalCommitAndPush(state);

    } finally {
      this.cleanupSession(state);
    }
  }

  /**
   * Build the Ralph loop command using the plugin's /ralph-loop format
   */
  private buildRalphPrompt(state: RalphLoopState, repository: Repository | null): string {
    // Build the task prompt with clear completion criteria
    const repoContext = repository
      ? `Repository: ${repository.name} (branch: ${repository.branch || 'main'})\n\n`
      : '';

    const taskPrompt = `${repoContext}${state.originalRequest}

ITERATION TRACKING: At the START of each iteration, output: [RALPH_LOOP_ITERATION]

When COMPLETELY done and verified, output: <promise>${state.config.completionPromise}</promise>`;

    // Escape the prompt for shell (double quotes inside the command)
    const escapedPrompt = taskPrompt.replace(/"/g, '\\"').replace(/\n/g, '\\n');

    // Use the plugin's /ralph-loop command format
    return `/ralph-loop:ralph-loop "${escapedPrompt}" --max-iterations ${state.config.maxIterations} --completion-promise "${state.config.completionPromise}"`;
  }

  /**
   * Count iterations from task output
   */
  private countIterationsFromOutput(taskId: string): number {
    const task = this.executor.getTask(taskId);
    if (!task?.output) return 1;

    // Count explicit iteration markers
    const markerMatches = task.output.match(/\[RALPH_LOOP_ITERATION\]/g);
    if (markerMatches && markerMatches.length > 0) {
      return markerMatches.length;
    }

    // Fallback: count common iteration patterns
    const iterationPatterns = [
      /iteration\s*#?\d+/gi,
      /loop\s*#?\d+/gi,
      /cycle\s*#?\d+/gi,
      /round\s*#?\d+/gi,
      /attempt\s*#?\d+/gi
    ];

    let maxCount = 0;
    for (const pattern of iterationPatterns) {
      const matches = task.output.match(pattern);
      if (matches) {
        maxCount = Math.max(maxCount, matches.length);
      }
    }

    return Math.max(1, maxCount);
  }

  /**
   * Monitor task progress using stream events (DRY - reuses ClaudeExecutor's streaming)
   */
  private async monitorTask(state: RalphLoopState, taskId: string): Promise<void> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let lastUpdateTime = 0;

      // Stream event handler - reuses ClaudeExecutor's parsed events
      const handleStreamEvent = (eventTaskId: string, event: StreamEvent) => {
        if (eventTaskId !== taskId) return;

        // Check for iteration markers in note/text events
        if (event.type === 'action' && event.action?.kind === 'note') {
          const text = String(event.action.detail?.text || event.message || '');
          if (text.includes('[RALPH_LOOP_ITERATION]')) {
            state.iteration++;
            logger.info('Ralph loop iteration (stream)', {
              sessionId: state.sessionId,
              iteration: state.iteration
            });
          }
        }

        // Throttle UI updates (every 2s) for any action event
        if (event.type === 'action' && Date.now() - lastUpdateTime > 2000) {
          lastUpdateTime = Date.now();
          this.updateStreamingStatusMessage(state, taskId).catch(() => {});
        }

        // Task completed via stream
        if (event.type === 'completed') {
          cleanup();
          state.endTime = new Date();
          logger.info('Ralph loop task finished (stream)', {
            sessionId: state.sessionId,
            ok: event.ok,
            iterations: state.iteration
          });
          resolve();
        }
      };

      this.executor.on('streamEvent', handleStreamEvent);

      const cleanup = () => {
        this.executor.off('streamEvent', handleStreamEvent);
        clearInterval(fallbackInterval);
      };

      // Fallback interval for timeout/stop checks
      const fallbackInterval = setInterval(async () => {
        if (Date.now() - startTime > state.config.maxDurationMs) {
          cleanup();
          state.status = RalphLoopStatus.TIMEOUT;
          state.endTime = new Date();
          logger.warn('Ralph loop timeout', { sessionId: state.sessionId, iterations: state.iteration });
          resolve();
          return;
        }

        if (state.status !== RalphLoopStatus.RUNNING) {
          cleanup();
          logger.info('Ralph loop stopped externally', { sessionId: state.sessionId, status: state.status });
          resolve();
          return;
        }

        const task = this.executor.getTask(taskId);
        if (!task) {
          cleanup();
          logger.warn('Ralph loop task not found', { sessionId: state.sessionId, taskId });
          resolve();
          return;
        }

        // Fallback task completion check
        if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
          cleanup();
          state.endTime = new Date();
          // Final count from output in case stream missed some
          const finalCount = this.countIterationsFromOutput(taskId);
          if (finalCount > state.iteration) state.iteration = finalCount;
          logger.info('Ralph loop task finished (fallback)', {
            sessionId: state.sessionId,
            taskStatus: task.status,
            iterations: state.iteration
          });
          resolve();
        }
      }, TASK_POLL_INTERVAL_MS);
    });
  }

  /**
   * Determine outcome based on task result
   */
  private async determineOutcome(state: RalphLoopState): Promise<void> {
    if (state.status !== RalphLoopStatus.RUNNING) {
      logger.info('Ralph loop outcome already determined', {
        sessionId: state.sessionId,
        status: state.status,
        iterations: state.iteration
      });
      return;
    }

    // Check task output for completion promise
    if (state.taskId) {
      const task = this.executor.getTask(state.taskId);
      const hasPromise = task?.output?.includes(state.config.completionPromise);

      logger.info('Ralph loop determining outcome', {
        sessionId: state.sessionId,
        taskStatus: task?.status,
        hasCompletionPromise: hasPromise,
        iterations: state.iteration,
        outputLength: task?.output?.length ?? 0
      });

      if (hasPromise) {
        state.status = RalphLoopStatus.COMPLETED;
        logger.info('Ralph loop completed via promise', {
          sessionId: state.sessionId,
          iterations: state.iteration
        });
        return;
      }

      // Check if task completed successfully
      if (task?.status === TaskStatus.COMPLETED) {
        state.status = RalphLoopStatus.COMPLETED;
        logger.info('Ralph loop completed via task status', {
          sessionId: state.sessionId,
          iterations: state.iteration
        });
        return;
      }

      // Check if task failed
      if (task?.status === TaskStatus.FAILED || task?.status === TaskStatus.TIMEOUT) {
        state.status = RalphLoopStatus.FAILED;
        logger.warn('Ralph loop failed', {
          sessionId: state.sessionId,
          taskStatus: task?.status,
          iterations: state.iteration
        });
        return;
      }
    }

    // Default to failed if we can't determine
    state.status = RalphLoopStatus.FAILED;
    logger.warn('Ralph loop failed - could not determine outcome', {
      sessionId: state.sessionId,
      iterations: state.iteration
    });
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
        error: getErrorMessage(error)
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

    const requestSnippet = state.originalRequest.substring(0, 100) + (state.originalRequest.length > 100 ? '...' : '');
    const escapedRequest = UIHelpers.escapeMarkdown(requestSnippet);
    const escapedPromise = UIHelpers.escapeMarkdown(state.config.completionPromise);

    let msg = `${emoji} *Ralph Loop*\n\n`;
    msg += `📋 ${escapedRequest}\n\n`;
    msg += `🔁 Loops: ${state.iteration}/${state.config.maxIterations}\n`;
    msg += `⏱️ Time: ${UIHelpers.formatDuration(elapsed)}\n`;
    msg += `🎯 Promise: ${escapedPromise}\n`;
    if (repository) {
      msg += `📁 Repo: ${UIHelpers.escapeMarkdown(repository.name)}\n`;
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
          { text: '🛑 Stop Ralph Loop', callback_data: `ralph_stop:${state.sessionId}` },
          ...(state.taskId ? [{ text: '📋 Log', callback_data: `view_log:${state.taskId}` }] : [])
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
   * Update status message with streaming actions (DRY - reuses UIHelpers)
   */
  private async updateStreamingStatusMessage(state: RalphLoopState, taskId: string): Promise<void> {
    if (!state.messageId) return;

    const task = this.executor.getTask(taskId) as ClaudeTaskWithStreaming | undefined;
    if (!task) return;

    try {
      const elapsed = Math.round((Date.now() - state.startTime.getTime()) / 1000);
      const providerLabel = state.aiProvider?.provider === 'glm' ? 'GLM' :
        state.aiProvider?.provider === 'openrouter' ? 'OpenRouter' : 'Claude';

      // Ralph header
      const header = `🔄 *Ralph Loop* · ${state.iteration}/${state.config.maxIterations}`;

      // Use shared streaming status builder
      const message = UIHelpers.buildStreamingStatusMessage(task, elapsed, providerLabel, header);

      const keyboard = state.status === RalphLoopStatus.RUNNING ? {
        inline_keyboard: [[
          { text: '🛑 Stop', callback_data: `ralph_stop:${state.sessionId}` },
          { text: '📋 Log', callback_data: `view_log:${taskId}` }
        ]]
      } : undefined;

      await this.bot.editMessageText(message, {
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

      const escapedReq = UIHelpers.escapeMarkdown(state.originalRequest.substring(0, 200));
      const escapedPromise = UIHelpers.escapeMarkdown(state.config.completionPromise);

      let report = `${statusEmoji} *Ralph Loop ${statusText}*\n\n`;
      report += `📋 ${escapedReq}\n\n`;
      report += `📊 *Summary:*\n`;
      report += `- Loops: ${state.iteration}\n`;
      report += `- Duration: ${UIHelpers.formatDuration(duration)}\n`;
      report += `- Promise: ${escapedPromise}\n`;

      const keyboard = state.taskId ? {
        inline_keyboard: [[
          { text: '📋 View Log', callback_data: `view_log:${state.taskId}` }
        ]]
      } : undefined;

      await this.bot.sendMessage(state.chatId, report, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      logger.error('Failed to send Ralph final report', {
        sessionId: state.sessionId,
        error: getErrorMessage(error)
      });
    }
  }

  /**
   * Get GitHub commit URL from working directory
   */
  private getCommitUrl(workingDir: string, commitHash: string): string | null {
    try {
      const remoteUrl = execSync('git config --get remote.origin.url', {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 5000
      }).trim();

      // Convert SSH or HTTPS URL to web URL
      // git@github.com:user/repo.git -> https://github.com/user/repo
      // https://github.com/user/repo.git -> https://github.com/user/repo
      const webUrl = remoteUrl
        .replace(/^git@github\.com:/, 'https://github.com/')
        .replace(/^git@([^:]+):/, 'https://$1/')
        .replace(/\.git$/, '');

      return `${webUrl}/commit/${commitHash}`;
    } catch {
      return null;
    }
  }

  /**
   * Final commit and push
   */
  private async finalCommitAndPush(state: RalphLoopState): Promise<void> {
    logger.info('Ralph loop attempting commit', {
      sessionId: state.sessionId,
      status: state.status,
      iterations: state.iteration,
      workingDir: state.workingDir
    });

    try {
      const commitHash = await this.executor.autoCommitChanges(state.workingDir);
      if (commitHash) {
        logger.info('Ralph loop committed changes', {
          sessionId: state.sessionId,
          commitHash,
          iterations: state.iteration
        });

        const pushResult = await this.executor.autoPushChanges(state.workingDir);

        logger.info('Ralph loop push result', {
          sessionId: state.sessionId,
          commitHash,
          pushResult
        });

        const commitUrl = this.getCommitUrl(state.workingDir, commitHash);
        const shortHash = commitHash.substring(0, 8);

        let message = '💾 **Ralph Loop Changes**\n\n';
        if (commitUrl) {
          message += `Commit: [${shortHash}](${commitUrl})\n`;
        } else {
          message += `Commit: \`${shortHash}\`\n`;
        }
        message += pushResult === 'success' ? '✅ Pushed' :
          pushResult === 'no_remote' ? '⚠️ No remote' : '⚠️ Push failed';

        await this.bot.sendMessage(state.chatId, message, { parse_mode: 'Markdown' });
      } else {
        logger.info('Ralph loop no changes to commit', {
          sessionId: state.sessionId,
          iterations: state.iteration
        });
      }
    } catch (error) {
      logger.error('Failed to commit/push Ralph changes', {
        sessionId: state.sessionId,
        error: getErrorMessage(error)
      });
    }
  }
}
