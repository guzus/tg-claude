import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { PRService } from '../services/PRService';
import { CIStatus } from '../types';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';

/**
 * Handles PR-related commands
 */
export class PRHandlers extends BaseHandler {
  private prService: PRService;

  constructor(
    bot: TelegramBot,
    ...baseArgs: ConstructorParameters<typeof BaseHandler> extends [any, ...infer Rest] ? Rest : never
  ) {
    super(bot, ...baseArgs);
    this.prService = new PRService();
  }

  /**
   * Handle /pr command
   */
  async handlePR(msg: Message, match: RegExpExecArray | null): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !(await this.checkAccess(msg))) return;

    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subCommand = args[0]?.toLowerCase();

    const workingDir = this.getWorkingDirectory(userId);

    switch (subCommand) {
      case 'list':
        await this.listPRs(chatId, workingDir);
        break;

      case 'my':
        await this.listMyPRs(chatId, workingDir);
        break;

      case 'view':
        if (args[1]) {
          await this.viewPR(chatId, workingDir, parseInt(args[1]));
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/pr view <number>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'checks':
        if (args[1]) {
          await this.checkPRCI(chatId, workingDir, parseInt(args[1]));
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/pr checks <number>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'merge':
        if (args[1]) {
          await this.mergePR(chatId, workingDir, parseInt(args[1]), userId);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/pr merge <number>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'wait':
        if (args[1]) {
          await this.waitForCI(chatId, workingDir, parseInt(args[1]));
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/pr wait <number>`', { parse_mode: 'Markdown' });
        }
        break;

      default:
        await this.showPRHelp(chatId);
    }
  }

  /**
   * Show PR help
   */
  private async showPRHelp(chatId: number): Promise<void> {
    const help = `
*Pull Request Management*

\`/pr list\` - List open PRs
\`/pr my\` - List my open PRs
\`/pr view <number>\` - View PR details
\`/pr checks <number>\` - Check CI status
\`/pr merge <number>\` - Squash merge PR (after CI passes)
\`/pr wait <number>\` - Wait for CI to complete

_Note: Only squash merge is supported._
`;
    await this.bot.sendMessage(chatId, help, { parse_mode: 'Markdown' });
  }

  /**
   * List open PRs
   */
  private async listPRs(chatId: number, workingDir: string): Promise<void> {
    const statusMsg = await this.bot.sendMessage(chatId, 'Fetching PRs...');

    try {
      const prs = await this.prService.listPRs(workingDir);

      if (prs.length === 0) {
        await this.bot.editMessageText('No open PRs found.', {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      let message = '*Open Pull Requests*\n\n';
      for (const pr of prs) {
        const ciEmoji = this.getCIStatusEmoji(pr.ciStatus);
        message += `${ciEmoji} #${pr.number} - ${UIHelpers.escapeMarkdown(pr.title)}\n`;
        message += `   by @${pr.author} | \`${pr.branch}\` -> \`${pr.baseBranch}\`\n\n`;
      }

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      await this.bot.editMessageText('Failed to fetch PRs. Make sure gh CLI is authenticated.', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * List my open PRs
   */
  private async listMyPRs(chatId: number, workingDir: string): Promise<void> {
    const statusMsg = await this.bot.sendMessage(chatId, 'Fetching your PRs...');

    try {
      const prs = await this.prService.getMyPRs(workingDir);

      if (prs.length === 0) {
        await this.bot.editMessageText('You have no open PRs.', {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      let message = '*Your Open Pull Requests*\n\n';
      for (const pr of prs) {
        const ciEmoji = this.getCIStatusEmoji(pr.ciStatus);
        message += `${ciEmoji} #${pr.number} - ${UIHelpers.escapeMarkdown(pr.title)}\n`;
        message += `   \`${pr.branch}\` -> \`${pr.baseBranch}\`\n\n`;
      }

      // Add action buttons
      const keyboard = {
        inline_keyboard: prs.slice(0, 3).map(pr => [
          { text: `View #${pr.number}`, callback_data: `pr_view_${pr.number}` },
          { text: `Checks #${pr.number}`, callback_data: `pr_checks_${pr.number}` }
        ])
      };

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      await this.bot.editMessageText('Failed to fetch your PRs.', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * View PR details
   */
  private async viewPR(chatId: number, workingDir: string, prNumber: number): Promise<void> {
    const statusMsg = await this.bot.sendMessage(chatId, `Fetching PR #${prNumber}...`);

    try {
      const pr = await this.prService.getPR(workingDir, prNumber);

      if (!pr) {
        await this.bot.editMessageText(`PR #${prNumber} not found.`, {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      const ciEmoji = this.getCIStatusEmoji(pr.ciStatus);
      const checksInfo = pr.checks.length > 0
        ? pr.checks.map(c => `  ${this.getCheckEmoji(c.status)} ${c.name}`).join('\n')
        : '  No CI checks configured';

      const message = `
*PR #${pr.number}: ${UIHelpers.escapeMarkdown(pr.title)}*

*Author:* @${pr.author}
*Branch:* \`${pr.branch}\` -> \`${pr.baseBranch}\`
*State:* ${pr.state}
*CI Status:* ${ciEmoji} ${pr.ciStatus}

*Checks:*
${checksInfo}

[View on GitHub](${pr.url})
`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Refresh Checks', callback_data: `pr_checks_${prNumber}` },
            { text: 'Merge (Squash)', callback_data: `pr_merge_${prNumber}` }
          ]
        ]
      };

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });
    } catch (error) {
      await this.bot.editMessageText(`Failed to fetch PR #${prNumber}.`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Check PR CI status
   */
  private async checkPRCI(chatId: number, workingDir: string, prNumber: number): Promise<void> {
    const statusMsg = await this.bot.sendMessage(chatId, `Checking CI for PR #${prNumber}...`);

    try {
      const checks = await this.prService.getPRChecks(workingDir, prNumber);

      if (checks.length === 0) {
        await this.bot.editMessageText(`No CI checks found for PR #${prNumber}.`, {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      let message = `*CI Checks for PR #${prNumber}*\n\n`;
      for (const check of checks) {
        const emoji = this.getCheckEmoji(check.status);
        message += `${emoji} *${check.name}*\n`;
        if (check.conclusion) {
          message += `   Conclusion: ${check.conclusion}\n`;
        }
        if (check.url) {
          message += `   [View Details](${check.url})\n`;
        }
        message += '\n';
      }

      const allPassing = checks.every(c => c.status === 'success' || c.status === 'skipped');
      const hasPending = checks.some(c => c.status === 'pending');

      if (allPassing) {
        message += '\n_All checks passing! Ready to merge._';
      } else if (hasPending) {
        message += '\n_Some checks are still running..._';
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Refresh', callback_data: `pr_checks_${prNumber}` },
            ...(allPassing ? [{ text: 'Merge (Squash)', callback_data: `pr_merge_${prNumber}` }] : [])
          ]
        ]
      };

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
        disable_web_page_preview: true
      });
    } catch (error) {
      await this.bot.editMessageText(`Failed to check CI for PR #${prNumber}.`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Merge a PR using squash merge
   */
  private async mergePR(chatId: number, workingDir: string, prNumber: number, userId: number): Promise<void> {
    const statusMsg = await this.bot.sendMessage(chatId, `Attempting to merge PR #${prNumber}...`);

    try {
      const result = await this.prService.mergePR(workingDir, prNumber);

      if (result.success) {
        await this.bot.editMessageText(
          `*PR #${prNumber} Merged Successfully*\n\n${result.message}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );

        logger.info('PR merged', { prNumber, userId, workingDir });
      } else {
        await this.bot.editMessageText(
          `*Failed to merge PR #${prNumber}*\n\n${result.message}`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
    } catch (error) {
      await this.bot.editMessageText(`Error merging PR #${prNumber}. Please try again.`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Wait for CI to complete
   */
  private async waitForCI(chatId: number, workingDir: string, prNumber: number): Promise<void> {
    const statusMsg = await this.bot.sendMessage(
      chatId,
      `Waiting for CI checks to complete on PR #${prNumber}...\n\nThis may take a few minutes.`
    );

    try {
      const result = await this.prService.waitForCI(workingDir, prNumber, 300000); // 5 min timeout

      const ciEmoji = this.getCIStatusEmoji(result.status);
      let message = `*CI Results for PR #${prNumber}*\n\nStatus: ${ciEmoji} ${result.status}\n\n`;

      for (const check of result.checks) {
        const emoji = this.getCheckEmoji(check.status);
        message += `${emoji} ${check.name}\n`;
      }

      if (result.status === CIStatus.PASSING) {
        message += '\n_All checks passed! Ready to merge._';
      } else if (result.status === CIStatus.FAILING) {
        message += '\n_Some checks failed. Please fix before merging._';
      } else if (result.status === CIStatus.PENDING) {
        message += '\n_Timed out waiting for checks. Some are still pending._';
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Refresh', callback_data: `pr_checks_${prNumber}` },
            ...(result.status === CIStatus.PASSING
              ? [{ text: 'Merge (Squash)', callback_data: `pr_merge_${prNumber}` }]
              : [])
          ]
        ]
      };

      await this.bot.editMessageText(message, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    } catch (error) {
      await this.bot.editMessageText(`Error waiting for CI on PR #${prNumber}.`, {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  }

  /**
   * Get emoji for CI status
   */
  private getCIStatusEmoji(status: CIStatus): string {
    switch (status) {
      case CIStatus.PASSING: return '✅';
      case CIStatus.FAILING: return '❌';
      case CIStatus.PENDING: return '🔄';
      default: return '❓';
    }
  }

  /**
   * Get emoji for check status
   */
  private getCheckEmoji(status: string): string {
    switch (status) {
      case 'success': return '✅';
      case 'failure': return '❌';
      case 'pending': return '🔄';
      case 'cancelled': return '⚪';
      case 'skipped': return '⏭️';
      default: return '❓';
    }
  }
}

export default PRHandlers;
