import { spawn, ChildProcess } from 'child_process';
import { ClaudeTask, ClaudeExecutionOptions, TaskStatus } from '../types';
import { config } from '../config';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export class ClaudeExecutor {
  private activeTasks: Map<string, ChildProcess> = new Map();
  private taskHistory: Map<string, ClaudeTask> = new Map();

  /**
   * Execute a Claude Code command
   */
  async executeTask(
    userId: number,
    chatId: number,
    prompt: string,
    options: ClaudeExecutionOptions = {}
  ): Promise<ClaudeTask> {
    const {
      workingDir = config.workspacePath,
      dangerMode = true,
      additionalFlags = [],
      timeout = config.taskTimeoutMs
    } = options;

    // Create task
    const task: ClaudeTask = {
      id: uuidv4(),
      userId,
      chatId,
      prompt,
      workingDir,
      status: TaskStatus.PENDING,
      startTime: new Date(),
      output: '',
      errorOutput: ''
    };

    logger.info('Starting Claude task', {
      taskId: task.id,
      userId,
      prompt: prompt.substring(0, 100)
    });

    try {
      // Build command arguments
      const args = [
        prompt,
        ...(dangerMode ? ['--dangerously-skip-permission'] : []),
        ...additionalFlags
      ];

      // Spawn Claude Code process
      const claudeProcess = spawn('claude', args, {
        cwd: workingDir,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: config.claudeApiKey
        }
      });

      // Track process
      this.activeTasks.set(task.id, claudeProcess);
      task.status = TaskStatus.RUNNING;
      this.taskHistory.set(task.id, task);

      // Set timeout
      const timeoutHandle = setTimeout(() => {
        if (this.activeTasks.has(task.id)) {
          logger.warn('Task timeout, killing process', { taskId: task.id });
          claudeProcess.kill('SIGTERM');
          task.status = TaskStatus.TIMEOUT;
        }
      }, timeout);

      // Handle stdout
      claudeProcess.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        task.output += chunk;

        // Limit output size
        if (task.output.length > config.maxOutputSize * 10) {
          task.output = task.output.slice(-config.maxOutputSize * 10);
        }

        logger.debug('Task output chunk', {
          taskId: task.id,
          chunkSize: chunk.length
        });
      });

      // Handle stderr
      claudeProcess.stderr?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        task.errorOutput += chunk;

        // Limit error output size
        if (task.errorOutput.length > config.maxOutputSize * 10) {
          task.errorOutput = task.errorOutput.slice(-config.maxOutputSize * 10);
        }

        logger.debug('Task error output chunk', {
          taskId: task.id,
          chunkSize: chunk.length
        });
      });

      // Handle process completion
      claudeProcess.on('close', (code: number | null) => {
        clearTimeout(timeoutHandle);
        this.activeTasks.delete(task.id);

        task.exitCode = code || 0;
        task.endTime = new Date();

        if (task.status !== TaskStatus.TIMEOUT && task.status !== TaskStatus.CANCELLED) {
          task.status = code === 0 ? TaskStatus.COMPLETED : TaskStatus.FAILED;
        }

        const executionTime = task.endTime.getTime() - task.startTime.getTime();

        logger.info('Task completed', {
          taskId: task.id,
          status: task.status,
          exitCode: code,
          executionTime: `${executionTime}ms`
        });
      });

      // Handle process errors
      claudeProcess.on('error', (error: Error) => {
        clearTimeout(timeoutHandle);
        this.activeTasks.delete(task.id);

        task.status = TaskStatus.FAILED;
        task.errorOutput += `\nProcess error: ${error.message}`;
        task.endTime = new Date();

        logger.error('Task process error', {
          taskId: task.id,
          error: error.message
        });
      });

      return task;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      task.errorOutput = error instanceof Error ? error.message : String(error);
      task.endTime = new Date();

      logger.error('Failed to start task', {
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error)
      });

      throw error;
    }
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): ClaudeTask | undefined {
    return this.taskHistory.get(taskId);
  }

  /**
   * Get all active tasks
   */
  getActiveTasks(): ClaudeTask[] {
    return Array.from(this.taskHistory.values()).filter(
      task => task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING
    );
  }

  /**
   * Get active tasks for a specific user
   */
  getActiveTasksForUser(userId: number): ClaudeTask[] {
    return this.getActiveTasks().filter(task => task.userId === userId);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const process = this.activeTasks.get(taskId);
    const task = this.taskHistory.get(taskId);

    if (!process || !task) {
      return false;
    }

    try {
      process.kill('SIGTERM');
      task.status = TaskStatus.CANCELLED;
      task.endTime = new Date();
      this.activeTasks.delete(taskId);

      logger.info('Task cancelled', { taskId });
      return true;
    } catch (error) {
      logger.error('Failed to cancel task', {
        taskId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Cancel all tasks for a user
   */
  cancelAllTasksForUser(userId: number): number {
    const userTasks = this.getActiveTasksForUser(userId);
    let cancelledCount = 0;

    for (const task of userTasks) {
      if (this.cancelTask(task.id)) {
        cancelledCount++;
      }
    }

    return cancelledCount;
  }

  /**
   * Get task count
   */
  getTaskCount(): number {
    return this.activeTasks.size;
  }

  /**
   * Check if user has reached concurrent task limit
   */
  hasReachedConcurrentLimit(userId: number): boolean {
    const userActiveTasks = this.getActiveTasksForUser(userId);
    return userActiveTasks.length >= config.maxConcurrentTasks;
  }

  /**
   * Get task output (truncated to max size)
   */
  getTaskOutput(taskId: string): string {
    const task = this.taskHistory.get(taskId);
    if (!task) {
      return 'Task not found';
    }

    const output = task.output || task.errorOutput || 'No output';
    return output.slice(-config.maxOutputSize);
  }

  /**
   * Clean up old completed tasks
   */
  cleanupOldTasks(maxAge: number = 3600000): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [taskId, task] of this.taskHistory.entries()) {
      if (
        task.status !== TaskStatus.RUNNING &&
        task.status !== TaskStatus.PENDING &&
        task.endTime &&
        now - task.endTime.getTime() > maxAge
      ) {
        this.taskHistory.delete(taskId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('Cleaned up old tasks', { count: cleanedCount });
    }

    return cleanedCount;
  }
}

export default ClaudeExecutor;
