import TelegramBot from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeExecutor } from './ClaudeExecutor';
import { RepositoryManager } from './RepositoryManager';
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

// Default beast mode configuration
const DEFAULT_BEAST_CONFIG: BeastModeConfig = {
  maxIterations: 10,
  maxDurationMs: 30 * 60 * 1000,      // 30 minutes
  iterationTimeoutMs: 10 * 60 * 1000, // 10 minutes per iteration
  stopOnSuccess: true,
  autoCommitPerIteration: false
};

export class BeastModeExecutor {
  private bot: TelegramBot;
  private executor: ClaudeExecutor;
  private repositoryManager: RepositoryManager;
  private activeSessions: Map<string, BeastModeState> = new Map();
  private userSessions: Map<number, string> = new Map(); // userId -> sessionId

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
   * Start a beast mode session
   */
  async startSession(
    userId: number,
    chatId: number,
    request: string,
    workingDir: string,
    config: Partial<BeastModeConfig> = {}
  ): Promise<BeastModeState> {
    // Check if user already has an active session
    const existingSessionId = this.userSessions.get(userId);
    if (existingSessionId) {
      const existingSession = this.activeSessions.get(existingSessionId);
      if (existingSession && existingSession.status === BeastModeStatus.RUNNING) {
        throw new Error('You already have an active beast mode session. Stop it first with the cancel button.');
      }
    }

    const sessionId = uuidv4();
    const finalConfig: BeastModeConfig = { ...DEFAULT_BEAST_CONFIG, ...config };

    const state: BeastModeState = {
      sessionId,
      userId,
      chatId,
      originalRequest: request,
      workingDir,
      status: BeastModeStatus.RUNNING,
      iteration: 0,
      startTime: new Date(),
      iterations: [],
      config: finalConfig
    };

    this.activeSessions.set(sessionId, state);
    this.userSessions.set(userId, sessionId);

    logger.info('Beast mode session started', {
      sessionId,
      userId,
      request: request.substring(0, 100),
      config: finalConfig
    });

    // Start the iteration loop
    this.runIterationLoop(state).catch(error => {
      logger.error('Beast mode iteration loop failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    return state;
  }

  /**
   * Stop a beast mode session
   */
  stopSession(sessionId: string): boolean {
    const state = this.activeSessions.get(sessionId);
    if (!state) {
      return false;
    }

    state.status = BeastModeStatus.STOPPED;
    state.endTime = new Date();

    // Cancel any active task
    const activeIteration = state.iterations[state.iterations.length - 1];
    if (activeIteration && !activeIteration.endTime) {
      this.executor.cancelTask(activeIteration.taskId);
    }

    this.userSessions.delete(state.userId);

    logger.info('Beast mode session stopped', {
      sessionId,
      iterations: state.iteration
    });

    return true;
  }

  /**
   * Stop session by user ID
   */
  stopSessionByUser(userId: number): boolean {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) {
      return false;
    }
    return this.stopSession(sessionId);
  }

  /**
   * Get session state
   */
  getSession(sessionId: string): BeastModeState | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get user's active session
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
    const statusMsg = await this.bot.sendMessage(
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

    const repository = this.repositoryManager.getCurrentRepository(state.userId) || null;

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
      const iteration = await this.runIteration(state, repository);
      state.iterations.push(iteration);

      // Update status message
      await this.updateStatusMessage(state);

      // Analyze result and decide next action
      if (iteration.analysis.isComplete && state.config.stopOnSuccess) {
        state.status = BeastModeStatus.COMPLETED;
        state.endTime = new Date();
        break;
      }

      // Check if we should continue
      if (!iteration.analysis.hasErrors &&
          !iteration.analysis.hasTestFailures &&
          !iteration.analysis.hasBuildFailures) {
        // No issues found - task might be complete
        state.status = BeastModeStatus.COMPLETED;
        state.endTime = new Date();
        break;
      }

      // Auto-commit if enabled
      if (state.config.autoCommitPerIteration) {
        await this.executor.autoCommitChanges(state.workingDir);
      }

      // Small delay between iterations
      await this.delay(2000);
    }

    // Final status update
    await this.sendFinalReport(state);

    // Final commit and push
    if (state.status === BeastModeStatus.COMPLETED ||
        state.status === BeastModeStatus.MAX_ITERATIONS) {
      await this.finalCommitAndPush(state);
    }

    // Cleanup
    this.userSessions.delete(state.userId);

    logger.info('Beast mode session ended', {
      sessionId: state.sessionId,
      status: state.status,
      iterations: state.iteration,
      duration: state.endTime
        ? state.endTime.getTime() - state.startTime.getTime()
        : 0
    });
  }

  /**
   * Run a single iteration
   */
  private async runIteration(
    state: BeastModeState,
    repository: Repository | null
  ): Promise<BeastIteration> {
    const iterationStart = new Date();

    // Build prompt for this iteration
    const prompt = this.buildIterationPrompt(state, repository);

    logger.info('Starting beast mode iteration', {
      sessionId: state.sessionId,
      iteration: state.iteration,
      prompt: prompt.substring(0, 200)
    });

    // Execute the task
    const task = await this.executor.executeTask(
      state.userId,
      state.chatId,
      prompt,
      {
        workingDir: state.workingDir,
        timeout: state.config.iterationTimeoutMs
      }
    );

    // Wait for task to complete
    const output = await this.waitForTaskCompletion(task.id, state);

    // Analyze the output
    const analysis = this.analyzeOutput(output, state);

    const iteration: BeastIteration = {
      number: state.iteration,
      startTime: iterationStart,
      endTime: new Date(),
      prompt,
      output,
      analysis,
      taskId: task.id
    };

    logger.info('Beast mode iteration completed', {
      sessionId: state.sessionId,
      iteration: state.iteration,
      analysis
    });

    return iteration;
  }

  /**
   * Wait for a task to complete and return its output
   */
  private async waitForTaskCompletion(taskId: string, state: BeastModeState): Promise<string> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // Check if session was stopped
        if (state.status !== BeastModeStatus.RUNNING) {
          clearInterval(checkInterval);
          resolve('Session stopped by user');
          return;
        }

        const task = this.executor.getTask(taskId);
        if (!task) {
          clearInterval(checkInterval);
          resolve('Task not found');
          return;
        }

        if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
          clearInterval(checkInterval);
          const output = task.output + (task.errorOutput ? '\n\nSTDERR:\n' + task.errorOutput : '');
          resolve(output);
        }
      }, 1000);
    });
  }

  /**
   * Build prompt for an iteration
   */
  private buildIterationPrompt(state: BeastModeState, repository: Repository | null): string {
    const isFirstIteration = state.iteration === 1;
    const previousIterations = state.iterations;

    if (isFirstIteration) {
      // First iteration - original request with beast mode instructions
      return `# Beast Mode Task

You are operating in **BEAST MODE** - an autonomous development mode where you:
- Take FULL AUTONOMY to complete tasks without asking for permission
- Make ALL necessary changes automatically
- Run tests and FIX any failures
- Handle errors proactively
- Iterate until the task is FULLY complete

## Repository Context
${repository ? `- **Name**: ${repository.name}\n- **Path**: ${repository.path}\n- **Branch**: ${repository.branch || 'main'}` : 'No repository context'}

## Task
${state.originalRequest}

## Instructions
1. Analyze what needs to be done
2. Implement the solution completely
3. Run any relevant tests
4. Fix any errors or test failures
5. Ensure the code is clean and working

When done, provide a summary of:
- What you implemented
- Files changed
- Tests run and results
- Any issues found and how you fixed them

**GO! Execute with full autonomy.**`;
    }

    // Subsequent iterations - build on previous results
    const lastIteration = previousIterations[previousIterations.length - 1];
    const errorContext = lastIteration.analysis.errorSummary || 'Unknown issues';

    return `# Beast Mode - Iteration ${state.iteration}

You are in **BEAST MODE** continuing from the previous iteration.

## Original Task
${state.originalRequest}

## Previous Iteration Summary
The last iteration found the following issues:
${errorContext}

${lastIteration.analysis.suggestedAction ? `**Suggested Action**: ${lastIteration.analysis.suggestedAction}` : ''}

## Output from Last Iteration (last 2000 chars)
\`\`\`
${lastIteration.output.slice(-2000)}
\`\`\`

## Your Task for This Iteration
1. Review the errors/failures from the previous iteration
2. Fix ALL identified issues
3. Re-run tests to verify fixes
4. Continue until everything passes

${lastIteration.analysis.hasTestFailures ? '**Focus**: Fix the failing tests!' : ''}
${lastIteration.analysis.hasBuildFailures ? '**Focus**: Fix the build errors!' : ''}
${lastIteration.analysis.hasErrors ? '**Focus**: Resolve all errors!' : ''}

**Do NOT give up. Fix the issues and make it work!**`;
  }

  /**
   * Analyze output from an iteration
   */
  private analyzeOutput(output: string, _state: BeastModeState): IterationAnalysis {
    const lowerOutput = output.toLowerCase();

    // Check for test failures
    const hasTestFailures =
      lowerOutput.includes('test failed') ||
      lowerOutput.includes('tests failed') ||
      lowerOutput.includes('failing tests') ||
      lowerOutput.includes('assertion failed') ||
      lowerOutput.includes('expected') && lowerOutput.includes('received') ||
      /\d+ failed/.test(lowerOutput) ||
      lowerOutput.includes('fail ');

    // Check for build failures
    const hasBuildFailures =
      lowerOutput.includes('build failed') ||
      lowerOutput.includes('compilation error') ||
      lowerOutput.includes('compile error') ||
      lowerOutput.includes('syntax error') ||
      lowerOutput.includes('type error') ||
      lowerOutput.includes('cannot find module') ||
      lowerOutput.includes('module not found');

    // Check for general errors
    const hasErrors =
      lowerOutput.includes('error:') ||
      lowerOutput.includes('exception:') ||
      lowerOutput.includes('traceback') ||
      lowerOutput.includes('fatal:') ||
      (lowerOutput.includes('error') && lowerOutput.includes('failed'));

    // Determine if complete (no issues found)
    const isComplete = !hasTestFailures && !hasBuildFailures && !hasErrors &&
      (lowerOutput.includes('all tests passed') ||
       lowerOutput.includes('tests passed') ||
       lowerOutput.includes('success') ||
       lowerOutput.includes('completed successfully') ||
       /\d+ passed/.test(lowerOutput));

    // Build error summary
    let errorSummary = '';
    let suggestedAction = '';

    if (hasTestFailures) {
      errorSummary += 'Test failures detected. ';
      suggestedAction = 'Review and fix the failing test cases.';

      // Try to extract test failure details
      const failureMatch = output.match(/(?:FAIL|FAILED|Error).*?(?:\n|$)/gi);
      if (failureMatch) {
        errorSummary += `Found ${failureMatch.length} failure(s). `;
      }
    }

    if (hasBuildFailures) {
      errorSummary += 'Build/compilation errors detected. ';
      suggestedAction = suggestedAction || 'Fix the compilation/build errors.';

      // Try to extract error details
      const errorMatch = output.match(/(?:error|Error)[\s:]+.*?(?:\n|$)/gi);
      if (errorMatch) {
        errorSummary += `Found ${errorMatch.length} error(s). `;
      }
    }

    if (hasErrors && !hasTestFailures && !hasBuildFailures) {
      errorSummary += 'Runtime or other errors detected. ';
      suggestedAction = suggestedAction || 'Investigate and fix the errors.';
    }

    if (isComplete) {
      errorSummary = 'All checks passed! Task appears complete.';
      suggestedAction = 'Verify the implementation meets requirements.';
    }

    return {
      hasErrors: hasErrors || hasTestFailures || hasBuildFailures,
      hasTestFailures,
      hasBuildFailures,
      isComplete,
      errorSummary: errorSummary || 'No specific issues identified.',
      suggestedAction: suggestedAction || 'Continue with the task.'
    };
  }

  /**
   * Format status message for display
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
   * Update the status message
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
    } catch (error) {
      // Ignore edit errors (message not modified, etc.)
      logger.debug('Failed to update beast mode status', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Send final report
   */
  private async sendFinalReport(state: BeastModeState): Promise<void> {
    const duration = state.endTime
      ? Math.round((state.endTime.getTime() - state.startTime.getTime()) / 1000)
      : 0;

    const statusEmoji =
      state.status === BeastModeStatus.COMPLETED ? '✅' :
      state.status === BeastModeStatus.MAX_ITERATIONS ? '⚠️' :
      state.status === BeastModeStatus.TIMEOUT ? '⏰' :
      state.status === BeastModeStatus.STOPPED ? '🛑' : '❌';

    const statusText =
      state.status === BeastModeStatus.COMPLETED ? 'Completed Successfully!' :
      state.status === BeastModeStatus.MAX_ITERATIONS ? 'Max Iterations Reached' :
      state.status === BeastModeStatus.TIMEOUT ? 'Timeout' :
      state.status === BeastModeStatus.STOPPED ? 'Stopped by User' : 'Failed';

    let report = `${statusEmoji} **Beast Mode ${statusText}**\n\n`;
    report += `📋 **Task**: ${state.originalRequest.substring(0, 200)}\n\n`;
    report += `📊 **Summary**:\n`;
    report += `• Iterations: ${state.iteration}\n`;
    report += `• Duration: ${UIHelpers.formatDuration(duration)}\n`;

    // Summarize iterations
    if (state.iterations.length > 0) {
      report += `\n📝 **Iteration Summary**:\n`;
      for (const iter of state.iterations.slice(-5)) { // Show last 5
        const emoji = iter.analysis.isComplete ? '✅' :
                      iter.analysis.hasErrors ? '❌' : '🔄';
        report += `${emoji} #${iter.number}: ${iter.analysis.errorSummary?.substring(0, 50) || 'Processed'}\n`;
      }
    }

    // Get last iteration output preview
    if (state.iterations.length > 0) {
      const lastOutput = state.iterations[state.iterations.length - 1].output;
      report += `\n📄 **Last Output (preview)**:\n\`\`\`\n${lastOutput.slice(-1000)}\n\`\`\``;
    }

    await this.bot.sendMessage(state.chatId, report, { parse_mode: 'Markdown' });
  }

  /**
   * Final commit and push after beast mode
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
      logger.error('Failed to commit/push beast mode changes', {
        sessionId: state.sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Helper delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default BeastModeExecutor;
