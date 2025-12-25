import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { ClaudeExecutor } from './ClaudeExecutor';
import { RepositoryManager } from './RepositoryManager';
import { MemoService } from './MemoService';
import {
  BeastModeConfig,
  BeastModeState,
  BeastModeStatus,
  BeastIteration,
  IterationAnalysis,
  TaskStatus,
  Repository
} from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { PromptBuilder, COMPLETION_SIGNAL, COMPLETION_THRESHOLD } from '../utils/PromptBuilder';

// Default beast mode configuration
const DEFAULT_BEAST_CONFIG: BeastModeConfig = {
  maxIterations: 10,
  maxDurationMs: 30 * 60 * 1000,      // 30 minutes
  iterationTimeoutMs: 10 * 60 * 1000, // 10 minutes per iteration
  stopOnSuccess: true,
  autoCommitPerIteration: false
};

// Session cleanup delay (1 hour after completion)
const SESSION_CLEANUP_DELAY_MS = 60 * 60 * 1000;

// Polling interval for task completion check
const TASK_POLL_INTERVAL_MS = 3000;

// Maximum request length
const MAX_REQUEST_LENGTH = 10000;

// Maximum output size to analyze
const MAX_ANALYSIS_WINDOW = 50000;

/**
 * BeastModeExecutor - Autonomous development mode inspired by continuous-claude
 *
 * Key features:
 * - Persistent memo for context across runs
 * - Completion signal detection
 * - Self-review mechanism
 * - Iterative improvement loop
 */
export class BeastModeExecutor {
  private bot: TelegramBot;
  private executor: ClaudeExecutor;
  private repositoryManager: RepositoryManager;
  private memoService: MemoService;
  private activeSessions: Map<string, BeastModeState> = new Map();
  private userSessions: Map<number, string> = new Map();

  constructor(
    bot: TelegramBot,
    executor: ClaudeExecutor,
    repositoryManager: RepositoryManager
  ) {
    this.bot = bot;
    this.executor = executor;
    this.repositoryManager = repositoryManager;
    this.memoService = new MemoService();
  }

  /**
   * Validate working directory
   */
  private validateWorkingDirectory(workingDir: string): void {
    if (!path.isAbsolute(workingDir)) {
      throw new Error('Working directory must be an absolute path');
    }
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }
    const stats = fs.statSync(workingDir);
    if (!stats.isDirectory()) {
      throw new Error(`Path is not a directory: ${workingDir}`);
    }
  }

  /**
   * Validate and sanitize request
   */
  private validateRequest(request: string): string {
    if (!request || typeof request !== 'string') {
      throw new Error('Request must be a non-empty string');
    }

    let sanitized = request.trim();
    if (sanitized.length > MAX_REQUEST_LENGTH) {
      sanitized = sanitized.substring(0, MAX_REQUEST_LENGTH);
      logger.warn('Request truncated', { originalLength: request.length });
    }

    if (sanitized.length === 0) {
      throw new Error('Request cannot be empty');
    }

    return sanitized;
  }

  /**
   * Start a beast mode session
   */
  async startSession(
    userId: number,
    chatId: number,
    request: string,
    workingDir: string,
    config: Partial<BeastModeConfig> = {}
  ): Promise<BeastModeState> {
    this.validateWorkingDirectory(workingDir);
    const sanitizedRequest = this.validateRequest(request);

    // Check for existing session
    const existingSessionId = this.userSessions.get(userId);
    if (existingSessionId) {
      const existingSession = this.activeSessions.get(existingSessionId);
      if (existingSession && existingSession.status === BeastModeStatus.RUNNING) {
        throw new Error('You already have an active beast mode session. Stop it first.');
      }
    }

    const sessionId = uuidv4();
    const finalConfig: BeastModeConfig = { ...DEFAULT_BEAST_CONFIG, ...config };

    const state: BeastModeState = {
      sessionId,
      userId,
      chatId,
      originalRequest: sanitizedRequest,
      workingDir,
      status: BeastModeStatus.RUNNING,
      iteration: 0,
      startTime: new Date(),
      iterations: [],
      config: finalConfig,
      cleanedUp: false
    };

    this.userSessions.set(userId, sessionId);
    this.activeSessions.set(sessionId, state);

    logger.info('Beast mode session started', {
      sessionId,
      userId,
      request: request.substring(0, 100),
      config: finalConfig
    });

    // Start iteration loop (non-blocking)
    this.runIterationLoop(state).catch(error => {
      logger.error('Beast mode iteration loop failed', {
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
  private cleanupSession(state: BeastModeState): void {
    if (state.cleanedUp) {
      return;
    }
    state.cleanedUp = true;
    this.userSessions.delete(state.userId);

    if (!state.endTime) {
      state.endTime = new Date();
    }
    if (state.status === BeastModeStatus.RUNNING) {
      state.status = BeastModeStatus.FAILED;
    }

    setTimeout(() => {
      this.activeSessions.delete(state.sessionId);
    }, SESSION_CLEANUP_DELAY_MS);

    logger.info('Beast mode session cleaned up', {
      sessionId: state.sessionId,
      status: state.status,
      iterations: state.iteration
    });
  }

  /**
   * Stop session
   */
  stopSession(sessionId: string): boolean {
    const state = this.activeSessions.get(sessionId);
    if (!state || state.cleanedUp) {
      return false;
    }

    state.status = BeastModeStatus.STOPPED;
    state.endTime = new Date();

    const activeIteration = state.iterations[state.iterations.length - 1];
    if (activeIteration && !activeIteration.endTime) {
      this.executor.cancelTask(activeIteration.taskId);
    }

    this.cleanupSession(state);
    logger.info('Beast mode session stopped', { sessionId, iterations: state.iteration });
    return true;
  }

  /**
   * Stop session by user
   */
  stopSessionByUser(userId: number): boolean {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return false;
    return this.stopSession(sessionId);
  }

  /**
   * Get session
   */
  getSession(sessionId: string): BeastModeState | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get user's session
   */
  getUserSession(userId: number): BeastModeState | undefined {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return undefined;
    return this.activeSessions.get(sessionId);
  }

  /**
   * Main iteration loop
   */
  private async runIterationLoop(state: BeastModeState): Promise<void> {
    try {
      // Send initial status message
      let statusMsg;
      try {
        statusMsg = await this.bot.sendMessage(
          state.chatId,
          this.formatStatusMessage(state),
          {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [[
                { text: '🛑 Stop Beast Mode', callback_data: `beast_stop:${state.sessionId}` }
              ]]
            }
          }
        );
        state.messageId = statusMsg.message_id;
      } catch (error) {
        logger.error('Failed to send status message', { sessionId: state.sessionId });
      }

      const repository = this.repositoryManager.getCurrentRepository(state.userId) || null;

      // Read existing memo for context
      const memoContext = this.memoService.getMemoSummary(state.workingDir);
      if (memoContext) {
        logger.info('Loaded memo context', {
          sessionId: state.sessionId,
          memoLength: memoContext.length
        });
      }

      // Record session start in memo
      this.memoService.appendEntry(state.workingDir, {
        timestamp: new Date(),
        type: 'task',
        content: `**New Session Started**\n\nTask: ${state.originalRequest}`
      });

      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 3;

      while (state.status === BeastModeStatus.RUNNING) {
        // Check timeout
        const elapsed = Date.now() - state.startTime.getTime();
        if (elapsed >= state.config.maxDurationMs) {
          state.status = BeastModeStatus.TIMEOUT;
          state.endTime = new Date();
          break;
        }

        // Check max iterations
        if (state.iteration >= state.config.maxIterations) {
          state.status = BeastModeStatus.MAX_ITERATIONS;
          state.endTime = new Date();
          break;
        }

        // Run iteration
        state.iteration++;
        const iteration = await this.runIteration(state, repository, memoContext);
        state.iterations.push(iteration);

        // Update status message
        await this.updateStatusMessage(state);

        // Check for completion signals
        const completionSignals = this.detectCompletionSignals(iteration.output);
        if (completionSignals >= COMPLETION_THRESHOLD) {
          logger.info('Completion signals detected', {
            sessionId: state.sessionId,
            signals: completionSignals
          });

          // Verify completion with analysis
          if (iteration.analysis.isComplete && state.config.stopOnSuccess) {
            state.status = BeastModeStatus.COMPLETED;
            state.endTime = new Date();

            // Record success in memo
            this.memoService.recordTaskSummary(
              state.workingDir,
              state.originalRequest,
              'completed',
              `Task completed successfully after ${state.iteration} iteration(s).`,
              this.extractLearnings(iteration.output)
            );
            break;
          }
        }

        // Check if complete based on analysis
        if (iteration.analysis.isComplete && state.config.stopOnSuccess) {
          state.status = BeastModeStatus.COMPLETED;
          state.endTime = new Date();

          this.memoService.recordTaskSummary(
            state.workingDir,
            state.originalRequest,
            'completed',
            `Task completed after ${state.iteration} iteration(s).`
          );
          break;
        }

        // Handle errors
        if (iteration.analysis.hasErrors) {
          consecutiveErrors++;
          if (consecutiveErrors >= maxConsecutiveErrors) {
            logger.warn('Max consecutive errors reached', { sessionId: state.sessionId });

            // Record blocker in memo
            this.memoService.recordBlocker(
              state.workingDir,
              `Task stalled after ${consecutiveErrors} consecutive errors: ${iteration.analysis.errorSummary}`,
              iteration.analysis.suggestedAction
            );
          }
        } else {
          consecutiveErrors = 0;
        }

        // Record iteration in memo
        this.memoService.recordIteration(
          state.workingDir,
          state.iteration,
          state.originalRequest,
          iteration.analysis.errorSummary || 'Processing...',
          iteration.analysis.suggestedAction
        );

        // Auto-commit if enabled
        if (state.config.autoCommitPerIteration) {
          try {
            await this.executor.autoCommitChanges(state.workingDir);
          } catch (error) {
            logger.warn('Auto-commit failed', { sessionId: state.sessionId });
          }
        }

        // Delay between iterations
        await this.delay(2000);
      }

      // Final report
      await this.sendFinalReport(state);

      // Final commit and push
      if (state.status === BeastModeStatus.COMPLETED ||
          state.status === BeastModeStatus.MAX_ITERATIONS) {
        await this.finalCommitAndPush(state);
      }

      // Record final status in memo
      if (state.status !== BeastModeStatus.COMPLETED) {
        this.memoService.recordTaskSummary(
          state.workingDir,
          state.originalRequest,
          state.status === BeastModeStatus.MAX_ITERATIONS ? 'partial' : 'failed',
          `Session ended with status: ${state.status}. Iterations: ${state.iteration}`
        );
      }

    } finally {
      this.cleanupSession(state);
    }
  }

  /**
   * Run single iteration
   */
  private async runIteration(
    state: BeastModeState,
    repository: Repository | null,
    memoContext: string
  ): Promise<BeastIteration> {
    const iterationStart = new Date();
    const prompt = this.buildIterationPrompt(state, repository, memoContext);

    logger.info('Starting iteration', {
      sessionId: state.sessionId,
      iteration: state.iteration
    });

    const task = await this.executor.executeTask(
      state.userId,
      state.chatId,
      prompt,
      {
        workingDir: state.workingDir,
        timeout: state.config.iterationTimeoutMs
      }
    );

    const output = await this.waitForTaskCompletion(
      task.id,
      state,
      state.config.iterationTimeoutMs
    );

    const analysis = this.analyzeOutput(output);

    const iteration: BeastIteration = {
      number: state.iteration,
      startTime: iterationStart,
      endTime: new Date(),
      prompt,
      output,
      analysis,
      taskId: task.id
    };

    logger.info('Iteration completed', {
      sessionId: state.sessionId,
      iteration: state.iteration,
      isComplete: analysis.isComplete,
      hasErrors: analysis.hasErrors
    });

    return iteration;
  }

  /**
   * Wait for task completion
   */
  private async waitForTaskCompletion(
    taskId: string,
    state: BeastModeState,
    timeoutMs: number
  ): Promise<string> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkInterval: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (checkInterval) {
          clearInterval(checkInterval);
          checkInterval = null;
        }
      };

      const safeResolve = (value: string) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(value);
      };

      checkInterval = setInterval(() => {
        try {
          if (Date.now() - startTime > timeoutMs) {
            safeResolve('Task timed out');
            return;
          }

          if (state.status !== BeastModeStatus.RUNNING) {
            safeResolve('Session stopped');
            return;
          }

          const task = this.executor.getTask(taskId);
          if (!task) {
            safeResolve('Task not found');
            return;
          }

          if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
            const output = task.output + (task.errorOutput ? '\n\nSTDERR:\n' + task.errorOutput : '');
            safeResolve(output);
          }
        } catch (error) {
          logger.error('Error in task polling', { taskId });
          safeResolve('Error waiting for task');
        }
      }, TASK_POLL_INTERVAL_MS);
    });
  }

  /**
   * Build iteration prompt with memo context
   */
  private buildIterationPrompt(
    state: BeastModeState,
    repository: Repository | null,
    memoContext: string
  ): string {
    const isFirstIteration = state.iteration === 1;
    const previousIterations = state.iterations;

    if (isFirstIteration) {
      // First iteration - use enhanced prompt builder
      if (repository) {
        return PromptBuilder.buildEnhancedPrompt(
          state.originalRequest,
          repository,
          {
            memoContext,
            beastMode: true
          }
        );
      }

      return `# Beast Mode Task

You are in **BEAST MODE** - fully autonomous development mode.

${memoContext ? `## Context from Previous Runs\n\n${memoContext}\n\n` : ''}

## Task
${state.originalRequest}

## Instructions

1. Take FULL AUTONOMY to complete this task
2. Make ALL necessary changes without asking
3. Run tests and FIX any failures
4. Update SHARED_NOTES.md with learnings
5. Emit \`${COMPLETION_SIGNAL}\` twice when fully complete

**GO! Execute with full autonomy.**`;
    }

    // Subsequent iterations
    const lastIteration = previousIterations[previousIterations.length - 1];
    const errorContext = lastIteration.analysis.errorSummary || 'Unknown issues';

    if (repository) {
      return PromptBuilder.buildEnhancedPrompt(
        state.originalRequest,
        repository,
        {
          memoContext,
          beastMode: true,
          iterationNumber: state.iteration,
          previousOutput: lastIteration.output,
          errorContext
        }
      );
    }

    return `# Beast Mode - Iteration ${state.iteration}

## Original Task
${state.originalRequest}

## Previous Iteration Issues
${errorContext}

${lastIteration.analysis.suggestedAction ? `**Action**: ${lastIteration.analysis.suggestedAction}` : ''}

## Recent Output
\`\`\`
${lastIteration.output.slice(-2000)}
\`\`\`

## Your Task
1. Fix ALL identified issues
2. Re-run tests to verify
3. Update SHARED_NOTES.md with progress
4. Emit \`${COMPLETION_SIGNAL}\` twice when complete

**Do NOT give up. Fix the issues!**`;
  }

  /**
   * Detect completion signals in output
   */
  private detectCompletionSignals(output: string): number {
    const matches = output.match(new RegExp(COMPLETION_SIGNAL, 'g'));
    return matches ? matches.length : 0;
  }

  /**
   * Extract learnings from output
   */
  private extractLearnings(output: string): string[] {
    const learnings: string[] = [];

    // Look for explicit learning markers
    const learningPatterns = [
      /(?:learned|discovered|realized|found that|note for future):?\s*(.+?)(?:\n|$)/gi,
      /(?:key insight|important):?\s*(.+?)(?:\n|$)/gi
    ];

    for (const pattern of learningPatterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        const learning = match[1].trim();
        if (learning.length > 10 && learning.length < 200) {
          learnings.push(learning);
        }
      }
    }

    return learnings.slice(0, 5);
  }

  /**
   * Analyze output
   */
  private analyzeOutput(output: string): IterationAnalysis {
    const analysisWindow = output.length > MAX_ANALYSIS_WINDOW
      ? output.slice(-MAX_ANALYSIS_WINDOW)
      : output;
    const lowerOutput = analysisWindow.toLowerCase();

    const hasTestFailures =
      lowerOutput.includes('test failed') ||
      lowerOutput.includes('tests failed') ||
      lowerOutput.includes('failing tests') ||
      lowerOutput.includes('assertion failed') ||
      (lowerOutput.includes('expected') && lowerOutput.includes('received')) ||
      /\d+ failed/.test(lowerOutput);

    const hasBuildFailures =
      lowerOutput.includes('build failed') ||
      lowerOutput.includes('compilation error') ||
      lowerOutput.includes('compile error') ||
      lowerOutput.includes('syntax error') ||
      lowerOutput.includes('type error') ||
      lowerOutput.includes('cannot find module');

    const hasErrors =
      lowerOutput.includes('error:') ||
      lowerOutput.includes('exception:') ||
      lowerOutput.includes('traceback') ||
      lowerOutput.includes('fatal:');

    const hasSuccessIndicators =
      lowerOutput.includes('all tests passed') ||
      lowerOutput.includes('tests passed') ||
      lowerOutput.includes('completed successfully') ||
      /\d+ passed/.test(lowerOutput);

    const hasCompletionSignal = output.includes(COMPLETION_SIGNAL);

    const isComplete = (
      !hasTestFailures &&
      !hasBuildFailures &&
      !hasErrors &&
      (hasSuccessIndicators || hasCompletionSignal)
    );

    let errorSummary = '';
    let suggestedAction = '';

    if (hasTestFailures) {
      errorSummary += 'Test failures detected. ';
      suggestedAction = 'Fix the failing tests.';
    }

    if (hasBuildFailures) {
      errorSummary += 'Build errors detected. ';
      suggestedAction = suggestedAction || 'Fix build/compilation errors.';
    }

    if (hasErrors && !hasTestFailures && !hasBuildFailures) {
      errorSummary += 'Runtime errors detected. ';
      suggestedAction = suggestedAction || 'Investigate and fix errors.';
    }

    if (isComplete) {
      errorSummary = 'All checks passed. Task complete.';
      suggestedAction = 'Verify implementation meets requirements.';
    } else if (!hasErrors && !hasTestFailures && !hasBuildFailures) {
      errorSummary = 'No errors, but no success confirmation.';
      suggestedAction = 'Run tests to verify implementation.';
    }

    return {
      hasErrors: hasErrors || hasTestFailures || hasBuildFailures,
      hasTestFailures,
      hasBuildFailures,
      isComplete,
      errorSummary: errorSummary || 'Processing...',
      suggestedAction: suggestedAction || 'Continue with task.'
    };
  }

  /**
   * Format status message
   */
  private formatStatusMessage(state: BeastModeState): string {
    const elapsed = Math.round((Date.now() - state.startTime.getTime()) / 1000);
    const statusEmoji = state.status === BeastModeStatus.RUNNING ? '🔥' :
                        state.status === BeastModeStatus.COMPLETED ? '✅' : '⚠️';

    let message = `${statusEmoji} **BEAST MODE**\n\n`;
    message += `📋 Task: ${state.originalRequest.substring(0, 100)}${state.originalRequest.length > 100 ? '...' : ''}\n\n`;
    message += `🔄 Iteration: ${state.iteration} / ${state.config.maxIterations}\n`;
    message += `⏱️ Time: ${UIHelpers.formatDuration(elapsed)}\n`;
    message += `📊 Status: ${state.status}\n`;

    if (state.iterations.length > 0) {
      const lastIteration = state.iterations[state.iterations.length - 1];
      message += `\n**Last Iteration**:\n`;
      message += `${lastIteration.analysis.isComplete ? '✅' : '🔧'} ${lastIteration.analysis.errorSummary || 'Processing...'}\n`;
    }

    return message;
  }

  /**
   * Update status message
   */
  private async updateStatusMessage(state: BeastModeState): Promise<void> {
    if (!state.messageId) return;

    try {
      const keyboard = state.status === BeastModeStatus.RUNNING ? {
        inline_keyboard: [[
          { text: '🛑 Stop Beast Mode', callback_data: `beast_stop:${state.sessionId}` }
        ]]
      } : undefined;

      await this.bot.editMessageText(this.formatStatusMessage(state), {
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
  private async sendFinalReport(state: BeastModeState): Promise<void> {
    try {
      const duration = state.endTime
        ? Math.round((state.endTime.getTime() - state.startTime.getTime()) / 1000)
        : 0;

      const statusEmoji =
        state.status === BeastModeStatus.COMPLETED ? '✅' :
        state.status === BeastModeStatus.MAX_ITERATIONS ? '⚠️' :
        state.status === BeastModeStatus.TIMEOUT ? '⏰' :
        state.status === BeastModeStatus.STOPPED ? '🛑' : '❌';

      const statusText =
        state.status === BeastModeStatus.COMPLETED ? 'Completed!' :
        state.status === BeastModeStatus.MAX_ITERATIONS ? 'Max Iterations' :
        state.status === BeastModeStatus.TIMEOUT ? 'Timeout' :
        state.status === BeastModeStatus.STOPPED ? 'Stopped' : 'Failed';

      let report = `${statusEmoji} **Beast Mode ${statusText}**\n\n`;
      report += `📋 **Task**: ${state.originalRequest.substring(0, 200)}\n\n`;
      report += `📊 **Summary**:\n`;
      report += `• Iterations: ${state.iteration}\n`;
      report += `• Duration: ${UIHelpers.formatDuration(duration)}\n`;

      if (state.iterations.length > 0) {
        report += `\n📝 **Iteration Summary**:\n`;
        for (const iter of state.iterations.slice(-5)) {
          const emoji = iter.analysis.isComplete ? '✅' : iter.analysis.hasErrors ? '❌' : '🔄';
          report += `${emoji} #${iter.number}: ${iter.analysis.errorSummary?.substring(0, 50) || 'Processed'}\n`;
        }
      }

      if (state.iterations.length > 0) {
        const lastOutput = state.iterations[state.iterations.length - 1].output;
        report += `\n📄 **Last Output (preview)**:\n\`\`\`\n${lastOutput.slice(-1000)}\n\`\`\``;
      }

      await this.bot.sendMessage(state.chatId, report, { parse_mode: 'Markdown' });
    } catch (error) {
      logger.error('Failed to send final report', { sessionId: state.sessionId });
    }
  }

  /**
   * Final commit and push
   */
  private async finalCommitAndPush(state: BeastModeState): Promise<void> {
    try {
      const commitHash = await this.executor.autoCommitChanges(state.workingDir);
      if (commitHash) {
        const pushResult = await this.executor.autoPushChanges(state.workingDir);

        let message = '💾 **Beast Mode Changes**\n\n';
        message += `Commit: \`${commitHash.substring(0, 8)}\`\n`;
        message += pushResult === 'success'
          ? '✅ Pushed to remote'
          : pushResult === 'no_remote'
            ? '⚠️ No remote configured'
            : '⚠️ Push failed';

        await this.bot.sendMessage(state.chatId, message, { parse_mode: 'Markdown' });
      }
    } catch (error) {
      logger.error('Failed to commit/push', { sessionId: state.sessionId });
    }
  }

  /**
   * Delay helper
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BeastModeExecutor;
