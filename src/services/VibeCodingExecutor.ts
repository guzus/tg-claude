import { ClaudeExecutor } from './ClaudeExecutor';
import { voiceCallService, CallStatus } from './VoiceCallService';
import { logger } from '../utils/logger';
import { TaskStatus, ClaudeTask } from '../types';
import { v4 as uuidv4 } from 'uuid';

export interface VibeCodingConfig {
  phoneNumber: string;           // User's phone number for callbacks
  callOnProblem: boolean;        // Whether to call on problems (default: true)
  autoRetry: boolean;            // Auto-retry after user response (default: true)
  maxRetries: number;            // Max consecutive retries (default: 5)
  problemDetectionPatterns: string[]; // Patterns to detect problems
}

export interface VibeCodingSession {
  sessionId: string;
  userId: number;
  chatId: number;
  task: string;
  workingDir: string;
  status: VibeCodingStatus;
  config: VibeCodingConfig;
  startTime: Date;
  endTime?: Date;
  currentTaskId?: string;
  iterations: VibeCodingIteration[];
  messageId?: number;
  awaitingUserResponse: boolean;
  currentProblem?: string;
}

export interface VibeCodingIteration {
  number: number;
  startTime: Date;
  endTime?: Date;
  taskId: string;
  output: string;
  status: 'success' | 'problem' | 'failed';
  problem?: string;
  userResponse?: string;
}

export enum VibeCodingStatus {
  RUNNING = 'running',
  AWAITING_RESPONSE = 'awaiting_response',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STOPPED = 'stopped'
}

// Problem detection patterns
const DEFAULT_PROBLEM_PATTERNS = [
  // Errors
  /error:/i,
  /Error:/,
  /ERROR/,
  /exception/i,
  /failed/i,
  /failure/i,
  // Questions/Need input
  /\?$/m,
  /please (specify|provide|choose|select|confirm)/i,
  /which (one|option|approach)/i,
  /should I/i,
  /do you want/i,
  /would you like/i,
  /need (more|additional) (info|information|details|context)/i,
  // Ambiguity
  /unclear/i,
  /ambiguous/i,
  /multiple options/i,
  /not sure/i,
  // Blockers
  /cannot (proceed|continue)/i,
  /blocked/i,
  /stuck/i,
  /permission denied/i,
  /access denied/i
];

export class VibeCodingExecutor {
  private claudeExecutor: ClaudeExecutor;
  private activeSessions: Map<string, VibeCodingSession> = new Map();
  private userSessions: Map<number, string> = new Map(); // userId -> sessionId
  private onStatusUpdate?: (session: VibeCodingSession, message: string) => Promise<void>;
  private onComplete?: (session: VibeCodingSession) => Promise<void>;

  constructor(claudeExecutor: ClaudeExecutor) {
    this.claudeExecutor = claudeExecutor;

    // Listen for voice call responses
    voiceCallService.on('userResponse', (data) => {
      this.handleUserVoiceResponse(data.userId, data.response, data.problem);
    });

    voiceCallService.on('callEnded', (data) => {
      this.handleCallEnded(data.userId, data.status, data.problem);
    });
  }

  /**
   * Set callback for status updates
   */
  setStatusUpdateCallback(callback: (session: VibeCodingSession, message: string) => Promise<void>): void {
    this.onStatusUpdate = callback;
  }

  /**
   * Set callback for completion
   */
  setCompleteCallback(callback: (session: VibeCodingSession) => Promise<void>): void {
    this.onComplete = callback;
  }

  /**
   * Start a vibe coding session
   */
  async startSession(
    userId: number,
    chatId: number,
    task: string,
    workingDir: string,
    config: Partial<VibeCodingConfig>
  ): Promise<VibeCodingSession> {
    // Cancel existing session for user if any
    const existingSessionId = this.userSessions.get(userId);
    if (existingSessionId) {
      await this.stopSession(existingSessionId);
    }

    const sessionId = uuidv4();
    const session: VibeCodingSession = {
      sessionId,
      userId,
      chatId,
      task,
      workingDir,
      status: VibeCodingStatus.RUNNING,
      config: {
        phoneNumber: config.phoneNumber || '',
        callOnProblem: config.callOnProblem ?? true,
        autoRetry: config.autoRetry ?? true,
        maxRetries: config.maxRetries ?? 5,
        problemDetectionPatterns: config.problemDetectionPatterns || []
      },
      startTime: new Date(),
      iterations: [],
      awaitingUserResponse: false
    };

    this.activeSessions.set(sessionId, session);
    this.userSessions.set(userId, sessionId);

    logger.info('Vibe coding session started', {
      sessionId,
      userId,
      task: task.substring(0, 100),
      hasPhoneNumber: !!config.phoneNumber
    });

    // Start the first iteration
    await this.runIteration(session);

    return session;
  }

  /**
   * Run an iteration of the vibe coding session
   */
  private async runIteration(session: VibeCodingSession): Promise<void> {
    if (session.status !== VibeCodingStatus.RUNNING) {
      return;
    }

    const iterationNumber = session.iterations.length + 1;
    const iteration: VibeCodingIteration = {
      number: iterationNumber,
      startTime: new Date(),
      taskId: '',
      output: '',
      status: 'success'
    };

    // Build prompt - include previous context if this is a retry
    let prompt = session.task;
    if (iterationNumber > 1) {
      const lastIteration = session.iterations[session.iterations.length - 1];
      if (lastIteration.userResponse) {
        prompt = `Previous task: ${session.task}

Problem encountered: ${lastIteration.problem}

User's instruction: ${lastIteration.userResponse}

Please continue with this guidance.`;
      }
    }

    try {
      // Execute the task
      const task = await this.claudeExecutor.executeTask(
        session.userId,
        session.chatId,
        prompt,
        { workingDir: session.workingDir }
      );

      iteration.taskId = task.id;
      session.currentTaskId = task.id;

      // Wait for task completion
      await this.waitForTaskCompletion(task, session, iteration);

    } catch (error) {
      iteration.status = 'failed';
      iteration.output = error instanceof Error ? error.message : String(error);
      session.status = VibeCodingStatus.FAILED;

      logger.error('Vibe coding iteration failed', {
        sessionId: session.sessionId,
        iteration: iterationNumber,
        error: iteration.output
      });
    }

    session.iterations.push(iteration);
  }

  /**
   * Wait for task completion and analyze output
   */
  private async waitForTaskCompletion(
    task: ClaudeTask,
    session: VibeCodingSession,
    iteration: VibeCodingIteration
  ): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        const currentTask = this.claudeExecutor.getTask(task.id);

        if (!currentTask || session.status === VibeCodingStatus.STOPPED) {
          clearInterval(checkInterval);
          resolve();
          return;
        }

        // Check if task is complete
        if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.TIMEOUT, TaskStatus.CANCELLED].includes(currentTask.status)) {
          clearInterval(checkInterval);

          iteration.endTime = new Date();
          iteration.output = currentTask.output + (currentTask.errorOutput ? '\n' + currentTask.errorOutput : '');

          // Analyze the output for problems
          const problem = this.detectProblem(iteration.output, session.config);

          if (problem) {
            iteration.status = 'problem';
            iteration.problem = problem;
            session.currentProblem = problem;

            await this.handleProblemDetected(session, problem);
          } else if (currentTask.status === TaskStatus.COMPLETED) {
            iteration.status = 'success';
            session.status = VibeCodingStatus.COMPLETED;
            session.endTime = new Date();

            await this.notifyStatus(session, `Vibe coding completed successfully after ${session.iterations.length} iteration(s).`);

            if (this.onComplete) {
              await this.onComplete(session);
            }
          } else {
            iteration.status = 'failed';
            session.status = VibeCodingStatus.FAILED;
            session.endTime = new Date();

            await this.notifyStatus(session, `Task failed with status: ${currentTask.status}`);
          }

          resolve();
        }
      }, 3000); // Check every 3 seconds
    });
  }

  /**
   * Detect problems in the output that need user input
   */
  private detectProblem(output: string, config: VibeCodingConfig): string | null {
    const patterns = [
      ...DEFAULT_PROBLEM_PATTERNS,
      ...config.problemDetectionPatterns.map(p => new RegExp(p, 'i'))
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        // Extract context around the match
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            // Get surrounding context (2 lines before, the line, 2 lines after)
            const start = Math.max(0, i - 2);
            const end = Math.min(lines.length, i + 3);
            const context = lines.slice(start, end).join('\n');
            return context;
          }
        }
        return match[0];
      }
    }

    return null;
  }

  /**
   * Handle when a problem is detected
   */
  private async handleProblemDetected(session: VibeCodingSession, problem: string): Promise<void> {
    logger.info('Problem detected in vibe coding', {
      sessionId: session.sessionId,
      problem: problem.substring(0, 200)
    });

    session.status = VibeCodingStatus.AWAITING_RESPONSE;
    session.awaitingUserResponse = true;

    // Try to call the user
    if (session.config.callOnProblem && session.config.phoneNumber && voiceCallService.isConfigured()) {
      await this.notifyStatus(session, `Problem detected. Calling you now...\n\n\`\`\`\n${problem.substring(0, 500)}\n\`\`\``);

      const call = await voiceCallService.initiateCall(
        session.userId,
        session.chatId,
        session.config.phoneNumber,
        problem
      );

      if (!call) {
        // Call failed, fall back to Telegram notification
        await this.notifyStatus(session, `Could not initiate call. Please respond here:\n\n\`\`\`\n${problem}\n\`\`\`\n\nReply with your instructions to continue.`);
      }
    } else {
      // No phone configured, notify via Telegram
      await this.notifyStatus(session, `Problem encountered:\n\n\`\`\`\n${problem.substring(0, 1000)}\n\`\`\`\n\nReply with your instructions to continue, or use /vibe stop to cancel.`);
    }
  }

  /**
   * Handle user's voice response from call
   */
  private async handleUserVoiceResponse(userId: number, response: string, _problem: string): Promise<void> {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return;

    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== VibeCodingStatus.AWAITING_RESPONSE) return;

    await this.handleUserResponse(session, response);
  }

  /**
   * Handle when call ended without response
   */
  private async handleCallEnded(userId: number, status: CallStatus, problem: string): Promise<void> {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return;

    const session = this.activeSessions.get(sessionId);
    if (!session || session.status !== VibeCodingStatus.AWAITING_RESPONSE) return;

    if (status === CallStatus.NO_ANSWER) {
      await this.notifyStatus(session, `No answer on call. Please reply here with instructions:\n\n\`\`\`\n${problem}\n\`\`\``);
    } else if (status === CallStatus.BUSY) {
      await this.notifyStatus(session, `Line was busy. Please reply here with instructions:\n\n\`\`\`\n${problem}\n\`\`\``);
    }
  }

  /**
   * Handle user response (from voice or text)
   */
  async handleUserResponse(session: VibeCodingSession, response: string): Promise<void> {
    if (session.status !== VibeCodingStatus.AWAITING_RESPONSE) {
      return;
    }

    // Update the last iteration with the response
    const lastIteration = session.iterations[session.iterations.length - 1];
    if (lastIteration) {
      lastIteration.userResponse = response;
    }

    session.awaitingUserResponse = false;
    session.status = VibeCodingStatus.RUNNING;

    await this.notifyStatus(session, `Got it! Continuing with your instruction: "${response.substring(0, 100)}..."`);

    // Check retry limit
    if (session.iterations.length >= session.config.maxRetries) {
      session.status = VibeCodingStatus.FAILED;
      session.endTime = new Date();
      await this.notifyStatus(session, `Max retries (${session.config.maxRetries}) reached. Session ended.`);
      return;
    }

    // Continue with next iteration
    await this.runIteration(session);
  }

  /**
   * Handle text message from user (for text-based responses)
   */
  async handleTextResponse(userId: number, message: string): Promise<boolean> {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return false;

    const session = this.activeSessions.get(sessionId);
    if (!session || !session.awaitingUserResponse) return false;

    await this.handleUserResponse(session, message);
    return true;
  }

  /**
   * Send status update via callback
   */
  private async notifyStatus(session: VibeCodingSession, message: string): Promise<void> {
    if (this.onStatusUpdate) {
      await this.onStatusUpdate(session, message);
    }

    logger.info('Vibe coding status update', {
      sessionId: session.sessionId,
      status: session.status,
      message: message.substring(0, 100)
    });
  }

  /**
   * Stop a vibe coding session
   */
  async stopSession(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return false;

    session.status = VibeCodingStatus.STOPPED;
    session.endTime = new Date();

    // Cancel any active task
    if (session.currentTaskId) {
      this.claudeExecutor.cancelTask(session.currentTaskId);
    }

    // End any active call
    const activeCall = voiceCallService.getActiveCallForUser(session.userId);
    if (activeCall) {
      await voiceCallService.endCall(activeCall.callSid);
    }

    this.userSessions.delete(session.userId);

    logger.info('Vibe coding session stopped', { sessionId });

    return true;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string): VibeCodingSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get session for user
   */
  getSessionForUser(userId: number): VibeCodingSession | undefined {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return undefined;
    return this.activeSessions.get(sessionId);
  }

  /**
   * Check if user has active vibe coding session
   */
  hasActiveSession(userId: number): boolean {
    const sessionId = this.userSessions.get(userId);
    if (!sessionId) return false;

    const session = this.activeSessions.get(sessionId);
    return session !== undefined &&
      [VibeCodingStatus.RUNNING, VibeCodingStatus.AWAITING_RESPONSE].includes(session.status);
  }

  /**
   * Clean up old sessions
   */
  cleanupOldSessions(maxAgeMs: number = 3600000): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.endTime && now - session.endTime.getTime() > maxAgeMs) {
        this.activeSessions.delete(sessionId);
        this.userSessions.delete(session.userId);
        cleaned++;
      }
    }

    return cleaned;
  }
}

export default VibeCodingExecutor;
