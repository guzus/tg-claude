import { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { formatDuration } from '../../../utils/time';
import { gitService } from '../../../services/GitService';
import { getVersionHash } from '../../../utils/version';

/**
 * Handlers for status and monitoring commands
 */
export class StatusHandlers extends BaseHandler {
  /**
   * /status command - Show active tasks
   */
  async handleStatus(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const userId = msg.from!.id;
    const chatId = msg.chat.id;

    const activeTasks = this.executor.getActiveTasksForUser(userId);

    if (activeTasks.length === 0) {
      await this.bot.sendMessage(chatId, '✅ No active tasks');
      return;
    }

    let message = `📊 Active Tasks (${activeTasks.length}):\n\n`;

    for (const task of activeTasks) {
      const elapsed = Math.round((Date.now() - task.startTime.getTime()) / 1000);
      message += `• \`${task.id.substring(0, 8)}\` - ${task.prompt.substring(0, 40)}... (${formatDuration(elapsed)})\n`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * /system command - Show system configuration status
   */
  async handleSystem(msg: Message): Promise<void> {
    if (!(await this.checkAccess(msg))) return;

    const chatId = msg.chat.id;
    const userId = msg.from!.id;

    const statusMsg = await this.bot.sendMessage(chatId, '🔍 Checking system status...');

    // Check GitHub token and auth status
    const tokenStatus = gitService.getTokenStatus();
    const isGhAuth = tokenStatus.configured ? await gitService.isGhAuthenticated() : false;

    // Build GitHub status line with detailed feedback
    let githubStatusLine: string;
    let githubHelpLine = '';

    if (!tokenStatus.configured) {
      githubStatusLine = '  ❌ Not configured';
      githubHelpLine = '  → Set `GITHUB_PAT` in Railway';
    } else if (tokenStatus.reason === 'contains_whitespace') {
      githubStatusLine = '  ⚠️ Token has whitespace';
      githubHelpLine = '  → Remove spaces/newlines from `GITHUB_PAT`';
    } else if (tokenStatus.reason === 'invalid_format') {
      githubStatusLine = isGhAuth ? '  ⚠️ Unusual format (working)' : '  ❌ Invalid token format';
      githubHelpLine = isGhAuth ? '' : '  → Check `GITHUB_PAT` is a valid PAT';
    } else if (!isGhAuth) {
      githubStatusLine = '  ❌ Token rejected';
      githubHelpLine = '  → Verify token has "repo" scope';
    } else {
      githubStatusLine = '  ✅ Authenticated';
    }

    // Get current repo
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    const repos = await this.repositoryManager.listRepositories(userId);

    // Get version
    const version = getVersionHash();

    // Build status message
    const lines: string[] = [
      '⚙️ *System Status*\n',
      '*GitHub:*',
      githubStatusLine,
      githubHelpLine,
      '',
      '*Repository:*',
      currentRepo ? `  📁 ${currentRepo.name}` : '  ⚠️ None selected',
      `  📊 ${repos.length} total`,
      '',
      '*Version:*',
      `  \`${version}\``,
    ].filter(Boolean);

    await this.bot.editMessageText(lines.join('\n'), {
      chat_id: chatId,
      message_id: statusMsg.message_id,
      parse_mode: 'Markdown'
    });
  }

}
