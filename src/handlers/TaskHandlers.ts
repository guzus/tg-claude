import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { TaskStatus } from '../types';
import { logger } from '../utils/logger';
import { UIHelpers } from '../utils/UIHelpers';
import { PromptBuilder } from '../utils/PromptBuilder';

/**
 * Handlers for task execution commands
 */
export class TaskHandlers extends BaseHandler {
  /**
   * Execute a Claude task and stream output
   */
  async executeAndStream(
    msg: Message,
    prompt: string,
    workingDir?: string
  ): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const startTime = Date.now();

    // Use current repository if no working directory specified
    const actualWorkingDir = this.getWorkingDirectory(userId, workingDir);

    try {
      // Send initial status message
      const statusMsg = await this.bot.sendMessage(
        chatId,
        `🤖 Task started...\n\n\`\`\`\n${prompt.substring(0, 200)}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Execute task
      const task = await this.executor.executeTask(userId, chatId, prompt, {
        workingDir: actualWorkingDir
      });

      task.messageId = statusMsg.message_id;

      // Track last update to avoid hitting rate limits
      let lastUpdateText = '';
      let updateCount = 0;

      // Poll for updates
      const updateInterval = setInterval(async () => {
        const currentTask = this.executor.getTask(task.id);
        if (!currentTask) {
          clearInterval(updateInterval);
          return;
        }

        // Update message if task is still running
        if (currentTask.status === TaskStatus.RUNNING) {
          updateCount++;
          const elapsed = Math.round((Date.now() - currentTask.startTime.getTime()) / 1000);

          // Get both stdout and stderr
          const output = this.executor.getTaskOutput(task.id);
          const errorOutput = currentTask.errorOutput || '';

          // Combine outputs
          let combinedOutput = '';
          if (output) {
            combinedOutput += output;
          }
          if (errorOutput) {
            combinedOutput += (combinedOutput ? '\n---STDERR---\n' : '') + errorOutput;
          }

          // If no output yet, show waiting message
          if (!combinedOutput.trim()) {
            combinedOutput = `⏳ Waiting for Claude to respond...\n\nElapsed: ${elapsed}s\nThis may take a few moments as Claude analyzes your request.`;
          }

          const preview = combinedOutput.slice(-1500);
          const newUpdateText =
            `🔄 Processing... (${elapsed}s)\n\n` +
            `Updates: ${updateCount}\n` +
            `Output size: ${combinedOutput.length} chars\n\n` +
            `\`\`\`\n${preview}\n\`\`\``;

          // Only update if text has changed (avoid rate limit errors)
          if (newUpdateText !== lastUpdateText) {
            try {
              await this.bot.editMessageText(newUpdateText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
              });
              lastUpdateText = newUpdateText;
            } catch (error) {
              // Ignore edit errors (message not modified, rate limit, etc.)
              logger.debug('Failed to update message', {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }
        } else {
          // Task completed
          clearInterval(updateInterval);

          const output = this.executor.getTaskOutput(task.id);
          const errorOutput = currentTask.errorOutput || '';
          const statusEmoji = currentTask.status === TaskStatus.COMPLETED ? '✅' : '❌';
          const statusText = currentTask.status === TaskStatus.COMPLETED ? 'Completed' : 'Failed';

          const executionTime = currentTask.endTime
            ? Math.round((currentTask.endTime.getTime() - currentTask.startTime.getTime()) / 1000)
            : 0;

          // Combine outputs for final display
          let fullOutput = '';
          if (output) {
            fullOutput += output;
          }
          if (errorOutput) {
            fullOutput += (fullOutput ? '\n\n---STDERR---\n' : '') + errorOutput;
          }
          if (!fullOutput.trim()) {
            fullOutput = 'No output captured';
          }

          // Get repository info for quick access
          const currentRepo = this.repositoryManager.getCurrentRepository(userId);
          const repoFooter = UIHelpers.createRepositoryFooter(currentRepo || null);

          const finalMessage =
            `${statusEmoji} ${statusText}\n\n` +
            `Exit code: ${currentTask.exitCode || 0}\n` +
            `Time: ${executionTime}s\n` +
            `Total output: ${fullOutput.length} chars\n\n` +
            `\`\`\`\n${fullOutput.slice(-2500)}\n\`\`\`` +
            repoFooter;

          try {
            await this.bot.editMessageText(finalMessage, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown'
            });
          } catch (error) {
            // If message is too long, send as document
            await this.bot.sendDocument(
              chatId,
              Buffer.from(fullOutput),
              {},
              {
                filename: 'task-output.txt',
                contentType: 'text/plain'
              }
            );

            // Send repo dashboard separately
            if (currentRepo) {
              const { message: repoMessage, keyboard: repoKeyboard } =
                UIHelpers.createRepositoryDashboard(currentRepo);
              await this.bot.sendMessage(chatId, repoMessage, {
                parse_mode: 'Markdown',
                reply_markup: repoKeyboard
              });
            }
          }

          // Log audit entry
          this.auditLogger.logCommand({
            userId,
            username,
            command: prompt,
            taskId: task.id,
            success: currentTask.status === TaskStatus.COMPLETED,
            executionTime,
            error: currentTask.status !== TaskStatus.COMPLETED ? currentTask.errorOutput : undefined
          });
        }
      }, 2000); // Update every 2 seconds

    } catch (error) {
      const executionTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      await this.bot.sendMessage(chatId, `❌ Error: ${errorMessage}`);

      this.auditLogger.logCommand({
        userId,
        username,
        command: prompt,
        success: false,
        executionTime,
        error: errorMessage
      });

      logger.error('Task execution failed', {
        userId,
        prompt: prompt.substring(0, 100),
        error: errorMessage
      });
    }
  }

  /**
   * /task command
   */
  async handleTask(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(chatId, '❌ Usage: /task <description>');
      return;
    }

    // Check if user has a repository set up
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        `⚠️ No active repository!\n\n` +
        `Please set up a repository first:\n` +
        `• /repo clone <url> - Clone a repository\n` +
        `• /repo new <name> - Create a new repository\n` +
        `• /repo add <path> - Add existing repository\n\n` +
        `Example: \`/repo new my-calculator-app\``,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const taskDescription = match[1].trim();

    // Augment prompt to instruct AI to commit and push changes
    const augmentedPrompt = `${taskDescription}

IMPORTANT: After completing the coding task:
1. Use git commands to stage all changes (git add .)
2. Create a commit with a descriptive message using: git commit -m "your message"
3. Push changes to the remote repository using: git push
4. If there's no remote repository set up, initialize one and push using gh CLI:
   - gh repo create (if needed)
   - git push -u origin main (or appropriate branch)

Always commit and push your changes after completing the task unless explicitly told not to.`;

    await this.executeAndStream(msg, augmentedPrompt);
  }

  /**
   * /commit command
   */
  async handleCommit(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    if (!match || !match[1]) {
      await this.bot.sendMessage(chatId, '❌ Usage: /commit <message>');
      return;
    }

    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    if (!currentRepo) {
      await this.bot.sendMessage(chatId, '❌ No repository selected');
      return;
    }

    const commitMessage = match[1].trim();
    const prompt = PromptBuilder.buildCommitPrompt(currentRepo) + `\n\nCommit message: "${commitMessage}"`;

    // Execute the commit
    await this.executeAndStream(msg, prompt);

    // After execution, try to get commit hash and show button
    // This will be handled in the task completion callback
    const repoWebUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);
    if (repoWebUrl) {
      // Try to get the latest commit hash
      try {
        const commitHash = await this.executor.executeTask(userId, chatId, 'git rev-parse HEAD', {
          workingDir: currentRepo.path
        });

        if (commitHash) {
          const commitUrl = `${repoWebUrl}/commit/${commitHash}`;

          await this.bot.sendMessage(chatId, '✅ *Commit Created*', {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔗 View Commit on GitHub', url: commitUrl }]
              ]
            }
          });
        }
      } catch (error) {
        // Silently fail - commit message was already sent
        logger.debug('Could not fetch commit hash', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  /**
   * /read command
   */
  async handleRead(msg: Message, match: RegExpExecArray | null): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    if (!match || !match[1]) {
      await this.bot.sendMessage(msg.chat.id, '❌ Usage: /read <url>');
      return;
    }

    const url = match[1].trim();
    const prompt = `Read and summarize the documentation at ${url}`;
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /review command
   */
  async handleReview(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Review the current code changes and provide feedback';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /test command
   */
  async handleTest(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Run all tests and report results';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * /build command
   */
  async handleBuild(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const prompt = 'Build the project and fix any errors';
    await this.executeAndStream(msg, prompt);
  }

  /**
   * Handle plain text messages (no /task prefix needed)
   */
  async handlePlainMessage(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;
    const userMessage = msg.text || '';

    // Get current repository
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.sendMessage(
        chatId,
        '📁 *No repository selected*\n\n' +
        'Please set up a repository first:\n' +
        '• /repo clone <url> - Clone a repository\n' +
        '• /repo new <name> - Create new repository\n' +
        '• /scan - Scan for existing repositories',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Add user message to conversation history
    this.conversationManager?.addUserMessage(userId, userMessage, currentRepo.id);

    // Get conversation context
    const context = this.conversationManager?.getContext(userId);

    // Build enhanced prompt with context
    const enhancedPrompt = PromptBuilder.buildEnhancedPrompt(
      userMessage,
      currentRepo,
      context,
      false // Not beast mode for plain messages
    );

    // Execute with enhanced prompt
    await this.executeAndStream(msg, enhancedPrompt);
  }

  /**
   * Execute task in beast mode (autonomous execution)
   */
  async executeBeastMode(msg: Message, userRequest: string): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);

    if (!currentRepo) {
      await this.bot.sendMessage(
        msg.chat.id,
        '❌ Beast mode requires an active repository'
      );
      return;
    }

    // Add to conversation
    this.conversationManager?.addUserMessage(userId, `[BEAST MODE] ${userRequest}`, currentRepo.id);

    const context = this.conversationManager?.getContext(userId);

    // Build beast mode prompt
    const beastPrompt = PromptBuilder.buildEnhancedPrompt(
      userRequest,
      currentRepo,
      context,
      true // Beast mode ON
    );

    await this.executeAndStream(msg, beastPrompt);
  }
}

