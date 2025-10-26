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
    workingDir?: string,
    originalUserRequest?: string
  ): Promise<void> {
    const userId = msg.from!.id;
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    const startTime = Date.now();

    // Use current repository if no working directory specified
    const actualWorkingDir = this.getWorkingDirectory(userId, workingDir);

    // Use original user request for commit messages, fallback to prompt
    const commitMessageContext = originalUserRequest || prompt;

    try {
      // Send initial status message
      const statusMsg = await this.bot.sendMessage(
        chatId,
        `🤖 Task started...\n\n\`\`\`\n${commitMessageContext.substring(0, 200)}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );

      // Get user-specific timeout if available
      const userTimeout = await this.getUserTimeout(userId);

      // Execute task
      const task = await this.executor.executeTask(userId, chatId, prompt, {
        workingDir: actualWorkingDir,
        timeout: userTimeout
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

          // Parse output to extract current action
          const currentAction = this.parseCurrentAction(combinedOutput);

          // Build status message
          let newUpdateText;
          const preview = combinedOutput.slice(-1500).trim();

          if (!preview) {
            // No output yet - just show waiting message
            newUpdateText = `⏳ Waiting for Claude... (${UIHelpers.formatDuration(elapsed)})`;
          } else {
            // Has output - show it with current action
            const actionLine = currentAction ? `📌 ${currentAction}\n\n` : '';
            newUpdateText = `🔄 Processing... (${UIHelpers.formatDuration(elapsed)})\n${actionLine}\`\`\`\n${preview}\n\`\`\``;
          }

          // Create control buttons
          const controlButtons = {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🛑 Cancel', callback_data: `cancel_task:${task.id}` },
                  { text: '📋 Full Log', callback_data: `view_log:${task.id}` }
                ]
              ]
            }
          };

          // Only update if text has changed (avoid rate limit errors)
          if (newUpdateText !== lastUpdateText) {
            try {
              await this.bot.editMessageText(newUpdateText, {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                ...controlButtons
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

          // Auto-commit and push changes if task completed successfully
          let commitInfo = '';
          let needsRemoteSetup = false;
          let pushError = '';
          let commitUrl = '';
          if (currentTask.status === TaskStatus.COMPLETED && actualWorkingDir) {
            try {
              const commitHash = await this.executor.autoCommitChanges(actualWorkingDir);
              let shouldPush = false;

              if (commitHash) {
                commitInfo = '\n💾 Changes auto-committed';
                shouldPush = true;

                // Get repository info to build commit URL
                const currentRepo = this.repositoryManager.getCurrentRepository(userId);
                if (currentRepo && currentRepo.gitUrl) {
                  const webUrl = UIHelpers.convertGitUrlToWeb(currentRepo.gitUrl);
                  if (webUrl) {
                    commitUrl = `${webUrl}/commit/${commitHash}`;
                    logger.info('Built commit URL', { commitUrl, commitHash });
                  }
                }
              } else {
                // No uncommitted changes, but check if there are unpushed commits
                const hasUnpushedCommits = await this.executor.hasUnpushedCommits(actualWorkingDir);
                if (hasUnpushedCommits) {
                  logger.info('Found unpushed commits', {
                    taskId: task.id,
                    workingDir: actualWorkingDir
                  });
                  shouldPush = true;
                  commitInfo = '\n💾 Commits ready to push';
                } else {
                  logger.info('No changes to commit or push', {
                    taskId: task.id,
                    workingDir: actualWorkingDir
                  });
                }
              }

              // Attempt push if there are commits to push
              if (shouldPush) {
                logger.info('Starting auto-push', {
                  taskId: task.id,
                  workingDir: actualWorkingDir
                });

                // Auto-push changes
                const pushResult = await this.executor.autoPushChanges(actualWorkingDir);

                logger.info('Auto-push result', {
                  taskId: task.id,
                  result: pushResult
                });

                if (pushResult === 'success') {
                  commitInfo += ' & pushed to GitHub ✅\n';
                  if (commitUrl) {
                    commitInfo += `🔗 [View commit](${commitUrl})\n`;
                  }
                } else if (pushResult === 'no_remote') {
                  commitInfo += '\n⚠️ No remote repository configured\n';
                  needsRemoteSetup = true;
                } else if (pushResult === 'no_changes') {
                  commitInfo += ' (already up to date)\n';
                } else {
                  commitInfo += '\n⚠️ Push failed - check logs for details\n';
                  pushError = 'Push operation failed. This may be due to authentication or network issues.';
                }
              }
            } catch (error) {
              logger.error('Auto-commit/push failed', {
                taskId: task.id,
                error: error instanceof Error ? error.message : String(error)
              });
              commitInfo = '\n⚠️ Commit/push error - check logs\n';
            }
          }

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
            `${statusEmoji} ${statusText}${commitInfo}\n` +
            `Exit code: ${currentTask.exitCode || 0}\n` +
            `Time: ${UIHelpers.formatDuration(executionTime)}\n\n` +
            `\`\`\`\n${fullOutput.slice(-2500)}\n\`\`\`` +
            repoFooter;

          try {
            await this.bot.editMessageText(finalMessage, {
              chat_id: chatId,
              message_id: statusMsg.message_id,
              parse_mode: 'Markdown'
            });

            // Send log file as a document
            const logFilePath = this.executor.getTaskLogFilePath(task.id);
            if (logFilePath) {
              await this.bot.sendDocument(chatId, logFilePath, {
                caption: `📋 Full execution log for task \`${task.id.substring(0, 8)}\``,
                parse_mode: 'Markdown'
              }, {
                filename: `task-${task.id.substring(0, 8)}.log`,
                contentType: 'text/plain'
              });
            }
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

          // Prompt user to create remote repository if needed
          if (needsRemoteSetup && actualWorkingDir) {
            await this.bot.sendMessage(
              chatId,
              '📦 *Create GitHub Repository?*\n\n' +
              'Your changes have been committed locally but no remote repository exists.\n\n' +
              'Would you like to create a GitHub repository and push your changes?',
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: '✅ Create Public Repository', callback_data: `create_repo_public_${actualWorkingDir}` },
                      { text: '🔒 Create Private Repository', callback_data: `create_repo_private_${actualWorkingDir}` }
                    ],
                    [
                      { text: '❌ Skip', callback_data: 'create_repo_skip' }
                    ]
                  ]
                }
              }
            );
          }

          // Show push error details if push failed
          if (pushError) {
            await this.bot.sendMessage(
              chatId,
              `⚠️ *Push Failed*\n\n${pushError}\n\n` +
              `Common causes:\n` +
              `• Not authenticated with GitHub\n` +
              `• No network connection\n` +
              `• Permission denied\n\n` +
              `Check the logs with \`/logs ${task.id.substring(0, 8)}\` for more details.`,
              {
                parse_mode: 'Markdown'
              }
            );
          }

          // Log audit entry
          this.auditLogger.logCommand({
            userId,
            username,
            command: commitMessageContext,
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
        command: commitMessageContext,
        success: false,
        executionTime,
        error: errorMessage
      });

      logger.error('Task execution failed', {
        userId,
        prompt: commitMessageContext.substring(0, 100),
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

    await this.executeAndStream(msg, augmentedPrompt, undefined, taskDescription);
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

    // Execute with enhanced prompt, passing original user message for commit messages
    await this.executeAndStream(msg, enhancedPrompt, undefined, userMessage);
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

    await this.executeAndStream(msg, beastPrompt, undefined, userRequest);
  }

  /**
   * Parse Claude's output to extract current action/file being worked on
   */
  private parseCurrentAction(output: string): string | null {
    if (!output) return null;

    const lines = output.split('\n');
    const recentLines = lines.slice(-50); // Look at last 50 lines

    // Look for common Claude Code patterns
    for (let i = recentLines.length - 1; i >= 0; i--) {
      const line = recentLines[i].trim();

      // Reading files
      if (line.match(/Reading|Read.*file|Opening/i)) {
        const fileMatch = line.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]/);
        if (fileMatch) return `Reading ${fileMatch[1]}`;
      }

      // Writing/editing files
      if (line.match(/Writing|Wrote|Editing|Modified|Updated/i)) {
        const fileMatch = line.match(/['"`]([^'"`]+\.[a-zA-Z]+)['"`]/);
        if (fileMatch) return `Editing ${fileMatch[1]}`;
      }

      // Running commands
      if (line.match(/Running|Executing|Command:/i)) {
        const cmdMatch = line.match(/Running|Executing|Command:\s*(.{0,50})/i);
        if (cmdMatch) return `Running: ${cmdMatch[1] || 'command'}`;
      }

      // Git operations
      if (line.match(/git (add|commit|push|pull|clone)/i)) {
        const gitOp = line.match(/git\s+(\w+)/i);
        if (gitOp) return `Git ${gitOp[1]}`;
      }

      // Installing packages
      if (line.match(/npm install|yarn add|pnpm add|pip install/i)) {
        return 'Installing dependencies';
      }

      // Building/compiling
      if (line.match(/Building|Compiling|Bundling/i)) {
        return 'Building project';
      }

      // Testing
      if (line.match(/Running tests|Testing/i)) {
        return 'Running tests';
      }
    }

    return null;
  }
}

