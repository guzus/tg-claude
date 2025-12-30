import TelegramBot, { Message } from 'node-telegram-bot-api';
import { v4 as uuidv4 } from 'uuid';
import { QueuedTask, QueueStatus } from '../types';
import { ClaudeExecutor } from './ClaudeExecutor';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';

export class TaskQueue extends EventEmitter {
  private queue: Map<number, QueuedTask[]> = new Map(); // userId -> tasks
  private status: QueueStatus = QueueStatus.IDLE;
  private bot: TelegramBot;
  private executor: ClaudeExecutor;
  private processingUsers: Set<number> = new Set(); // Track users currently being processed

  constructor(bot: TelegramBot, executor: ClaudeExecutor) {
    super();
    this.bot = bot;
    this.executor = executor;

    // Start queue processor
    this.startProcessor();
  }

  /**
   * Add a task to the queue
   */
  async enqueue(
    msg: Message,
    prompt: string,
    originalUserRequest: string,
    workingDir: string
  ): Promise<QueuedTask> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    // Initialize user queue if needed
    if (!this.queue.has(userId)) {
      this.queue.set(userId, []);
    }

    const userQueue = this.queue.get(userId)!;
    const position = userQueue.length + 1;

    const task: QueuedTask = {
      id: uuidv4(),
      userId,
      chatId,
      prompt,
      originalUserRequest,
      workingDir,
      queuedAt: new Date(),
      position
    };

    userQueue.push(task);

    logger.info('Task enqueued', {
      taskId: task.id,
      userId,
      position,
      queueLength: userQueue.length
    });

    // Send queue notification
    const statusMsg = await this.bot.sendMessage(
      chatId,
      `📋 *Task Queued* (Position: #${position})\n\n` +
      `\`\`\`\n${originalUserRequest.substring(0, 200)}${originalUserRequest.length > 200 ? '...' : ''}\n\`\`\`\n\n` +
      `_Your task will start when current tasks complete._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '❌ Cancel', callback_data: `queue_cancel:${task.id}` }]
          ]
        }
      }
    );

    task.messageId = statusMsg.message_id;

    this.emit('task_queued', task);
    return task;
  }

  /**
   * Remove a task from the queue
   */
  dequeue(taskId: string): QueuedTask | null {
    for (const [userId, tasks] of this.queue.entries()) {
      const index = tasks.findIndex(t => t.id === taskId);
      if (index !== -1) {
        const [task] = tasks.splice(index, 1);

        // Update positions for remaining tasks
        this.updatePositions(userId);

        logger.info('Task dequeued', {
          taskId,
          userId,
          remainingInQueue: tasks.length
        });

        return task;
      }
    }
    return null;
  }

  /**
   * Cancel a queued task
   */
  async cancelQueuedTask(taskId: string, chatId: number): Promise<boolean> {
    const task = this.dequeue(taskId);
    if (task) {
      // Update the status message
      if (task.messageId) {
        try {
          await this.bot.editMessageText(
            `❌ *Task Cancelled*\n\n` +
            `\`\`\`\n${task.originalUserRequest.substring(0, 200)}\n\`\`\``,
            {
              chat_id: chatId,
              message_id: task.messageId,
              parse_mode: 'Markdown'
            }
          );
        } catch (error) {
          // Ignore edit errors
        }
      }

      this.emit('task_cancelled', task);
      return true;
    }
    return false;
  }

  /**
   * Get queue for a user
   */
  getQueueForUser(userId: number): QueuedTask[] {
    return this.queue.get(userId) || [];
  }

  /**
   * Get total queue size across all users
   */
  getTotalQueueSize(): number {
    let total = 0;
    for (const tasks of this.queue.values()) {
      total += tasks.length;
    }
    return total;
  }

  /**
   * Get queue status
   */
  getStatus(): QueueStatus {
    return this.status;
  }

  /**
   * Clear queue for a user
   */
  async clearQueueForUser(userId: number): Promise<number> {
    const tasks = this.queue.get(userId) || [];
    const count = tasks.length;

    // Notify each task of cancellation
    for (const task of tasks) {
      if (task.messageId) {
        try {
          await this.bot.editMessageText(
            `❌ *Task Cancelled* (Queue cleared)\n\n` +
            `\`\`\`\n${task.originalUserRequest.substring(0, 100)}\n\`\`\``,
            {
              chat_id: task.chatId,
              message_id: task.messageId,
              parse_mode: 'Markdown'
            }
          );
        } catch (error) {
          // Ignore edit errors
        }
      }
    }

    this.queue.set(userId, []);

    logger.info('Queue cleared for user', { userId, clearedCount: count });
    return count;
  }

  /**
   * Update positions after removal
   */
  private updatePositions(userId: number): void {
    const tasks = this.queue.get(userId) || [];
    tasks.forEach((task, index) => {
      task.position = index + 1;
    });
  }

  /**
   * Check if user can start a new task immediately (no active tasks)
   */
  canProcessImmediately(userId: number): boolean {
    const activeTasks = this.executor.getActiveTasksForUser(userId);
    return activeTasks.length === 0 && !this.processingUsers.has(userId);
  }

  /**
   * Start the queue processor
   */
  private startProcessor(): void {
    // Check queue every 2 seconds
    setInterval(async () => {
      await this.processQueue();
    }, 2000);
  }

  /**
   * Process queued tasks
   */
  private async processQueue(): Promise<void> {
    if (this.status === QueueStatus.PAUSED) return;

    for (const [userId, tasks] of this.queue.entries()) {
      if (tasks.length === 0) continue;
      if (this.processingUsers.has(userId)) continue;

      // Check if user has active tasks
      const activeTasks = this.executor.getActiveTasksForUser(userId);
      if (activeTasks.length > 0) continue;

      // Get next task
      const nextTask = tasks[0];
      if (!nextTask) continue;

      // Mark user as processing to prevent race conditions
      this.processingUsers.add(userId);

      // Remove from queue
      tasks.shift();
      this.updatePositions(userId);

      logger.info('Processing queued task', {
        taskId: nextTask.id,
        userId,
        remainingInQueue: tasks.length
      });

      // Update status message
      if (nextTask.messageId) {
        try {
          await this.bot.editMessageText(
            `🚀 *Task Starting*\n\n` +
            `\`\`\`\n${nextTask.originalUserRequest.substring(0, 200)}\n\`\`\``,
            {
              chat_id: nextTask.chatId,
              message_id: nextTask.messageId,
              parse_mode: 'Markdown'
            }
          );
        } catch (error) {
          // Ignore edit errors
        }
      }

      // Emit event - the handler will execute the task
      this.emit('task_ready', nextTask);

      // Release processing lock after a short delay
      setTimeout(() => {
        this.processingUsers.delete(userId);
      }, 3000);
    }
  }

  /**
   * Get queue info for display
   */
  getQueueInfo(userId: number): string {
    const userQueue = this.getQueueForUser(userId);
    const activeTasks = this.executor.getActiveTasksForUser(userId);
    const totalQueued = this.getTotalQueueSize();

    if (activeTasks.length === 0 && userQueue.length === 0) {
      return '✅ No active or queued tasks';
    }

    let info = '';

    if (activeTasks.length > 0) {
      info += `🔄 *Running* (${activeTasks.length}):\n`;
      for (const task of activeTasks) {
        const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000);
        const elapsedStr = this.formatDuration(elapsed);
        info += `  • \`${task.id.substring(0, 8)}\` - ${task.prompt.substring(0, 30)}... (${elapsedStr})\n`;
      }
      info += '\n';
    }

    if (userQueue.length > 0) {
      info += `📋 *Queued* (${userQueue.length}):\n`;
      for (const task of userQueue) {
        const waitTime = Math.round((Date.now() - task.queuedAt.getTime()) / 1000);
        const waitStr = this.formatDuration(waitTime);
        info += `  ${task.position}. \`${task.id.substring(0, 8)}\` - ${task.originalUserRequest.substring(0, 30)}... (waiting ${waitStr})\n`;
      }
    }

    if (totalQueued > userQueue.length) {
      info += `\n_${totalQueued} total tasks queued system-wide_`;
    }

    return info;
  }

  /**
   * Format duration in human-readable format
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  }
}

export default TaskQueue;
