import TelegramBot, { Message } from 'node-telegram-bot-api';
import { BaseHandler } from './BaseHandler';
import { MemoService } from '../services/MemoService';
import { MemoType, MemoStatus } from '../types';
import { UIHelpers } from '../utils/UIHelpers';
import { logger } from '../utils/logger';

/**
 * Handles memo-related commands for tracking tasks done and to-do
 */
export class MemoHandlers extends BaseHandler {
  private memoService: MemoService;

  constructor(
    bot: TelegramBot,
    memoService: MemoService,
    ...baseArgs: ConstructorParameters<typeof BaseHandler> extends [any, ...infer Rest] ? Rest : never
  ) {
    super(bot, ...baseArgs);
    this.memoService = memoService;
  }

  /**
   * Handle /memo command
   */
  async handleMemo(msg: Message, match: RegExpExecArray | null): Promise<void> {
    const chatId = msg.chat.id;
    const userId = msg.from?.id;

    if (!userId || !(await this.checkAccess(msg))) return;

    const args = match?.[1]?.trim() || '';
    const parts = args.split(/\s+/);
    const subCommand = parts[0]?.toLowerCase();
    const content = parts.slice(1).join(' ');

    switch (subCommand) {
      case 'add':
      case 'todo':
        if (content) {
          await this.addTodo(chatId, userId, content);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/memo add <task description>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'done':
        if (content) {
          await this.addDone(chatId, userId, content);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/memo done <completed task>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'note':
        if (content) {
          await this.addNote(chatId, userId, content);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/memo note <note content>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'list':
        await this.listMemos(chatId, userId, parts[1]);
        break;

      case 'complete':
        if (content) {
          await this.completeMemo(chatId, userId, content);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/memo complete <memo-id>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'delete':
      case 'remove':
        if (content) {
          await this.deleteMemo(chatId, userId, content);
        } else {
          await this.bot.sendMessage(chatId, 'Usage: `/memo delete <memo-id>`', { parse_mode: 'Markdown' });
        }
        break;

      case 'clear':
        await this.clearMemos(chatId, userId, parts[1]);
        break;

      case 'summary':
        await this.showSummary(chatId, userId);
        break;

      default:
        if (args) {
          // Treat any unrecognized text as a new todo
          await this.addTodo(chatId, userId, args);
        } else {
          await this.showMemoHelp(chatId, userId);
        }
    }
  }

  /**
   * Show memo help and summary
   */
  private async showMemoHelp(chatId: number, userId: number): Promise<void> {
    const summary = this.memoService.getSummary(userId);

    const help = `
*Memo - Task Tracker*

*Quick Stats:*
- Pending TODOs: ${summary.todos}
- Completed: ${summary.done}
- Notes: ${summary.notes}

*Commands:*
\`/memo <task>\` - Quick add a TODO
\`/memo add <task>\` - Add a TODO
\`/memo done <task>\` - Log completed task
\`/memo note <text>\` - Add a note
\`/memo list [todos|done|notes]\` - List memos
\`/memo complete <id>\` - Mark TODO as done
\`/memo delete <id>\` - Delete a memo
\`/memo clear [todos|done|notes]\` - Clear memos
\`/memo summary\` - Show summary
`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: 'View TODOs', callback_data: 'memo_list_todos' },
          { text: 'View Done', callback_data: 'memo_list_done' }
        ],
        [
          { text: 'View Notes', callback_data: 'memo_list_notes' },
          { text: 'Summary', callback_data: 'memo_summary' }
        ]
      ]
    };

    await this.bot.sendMessage(chatId, help, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  /**
   * Add a TODO
   */
  private async addTodo(chatId: number, userId: number, content: string): Promise<void> {
    try {
      const memo = await this.memoService.addMemo(userId, content, MemoType.TODO);
      const shortId = memo.id.substring(0, 8);

      await this.bot.sendMessage(
        chatId,
        `Added TODO: ${UIHelpers.escapeMarkdown(content)}\n\nID: \`${shortId}\``,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Complete', callback_data: `memo_complete_${shortId}` },
                { text: 'Delete', callback_data: `memo_delete_${shortId}` }
              ]
            ]
          }
        }
      );

      logger.info('Added TODO memo', { userId, memoId: memo.id });
    } catch (error) {
      await this.bot.sendMessage(chatId, 'Failed to add TODO.');
    }
  }

  /**
   * Add a completed task (DONE)
   */
  private async addDone(chatId: number, userId: number, content: string): Promise<void> {
    try {
      const memo = await this.memoService.addMemo(userId, content, MemoType.DONE);
      const shortId = memo.id.substring(0, 8);

      await this.bot.sendMessage(
        chatId,
        `Logged completed task: ${UIHelpers.escapeMarkdown(content)}\n\nID: \`${shortId}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info('Added DONE memo', { userId, memoId: memo.id });
    } catch (error) {
      await this.bot.sendMessage(chatId, 'Failed to log completed task.');
    }
  }

  /**
   * Add a note
   */
  private async addNote(chatId: number, userId: number, content: string): Promise<void> {
    try {
      const memo = await this.memoService.addMemo(userId, content, MemoType.NOTE);
      const shortId = memo.id.substring(0, 8);

      await this.bot.sendMessage(
        chatId,
        `Added note: ${UIHelpers.escapeMarkdown(content)}\n\nID: \`${shortId}\``,
        { parse_mode: 'Markdown' }
      );

      logger.info('Added NOTE memo', { userId, memoId: memo.id });
    } catch (error) {
      await this.bot.sendMessage(chatId, 'Failed to add note.');
    }
  }

  /**
   * List memos
   */
  private async listMemos(chatId: number, userId: number, typeFilter?: string): Promise<void> {
    let type: MemoType | undefined;
    let title: string;

    switch (typeFilter?.toLowerCase()) {
      case 'todos':
      case 'todo':
        type = MemoType.TODO;
        title = 'TODOs';
        break;
      case 'done':
      case 'completed':
        type = MemoType.DONE;
        title = 'Completed Tasks';
        break;
      case 'notes':
      case 'note':
        type = MemoType.NOTE;
        title = 'Notes';
        break;
      default:
        title = 'All Memos';
    }

    const memos = this.memoService.getMemos(userId, type);

    if (memos.length === 0) {
      await this.bot.sendMessage(chatId, `No ${title.toLowerCase()} found.`);
      return;
    }

    let message = `*${title}*\n\n`;

    for (const memo of memos.slice(0, 20)) {
      const shortId = memo.id.substring(0, 8);
      const typeEmoji = this.getMemoTypeEmoji(memo.type);
      const statusEmoji = this.getMemoStatusEmoji(memo.status);
      const date = memo.createdAt.toLocaleDateString();

      message += `${typeEmoji}${statusEmoji} \`${shortId}\` - ${UIHelpers.escapeMarkdown(memo.content)}\n`;
      message += `   _${date}_\n\n`;
    }

    if (memos.length > 20) {
      message += `\n_...and ${memos.length - 20} more_`;
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Complete a memo
   */
  private async completeMemo(chatId: number, userId: number, memoIdPrefix: string): Promise<void> {
    const memos = this.memoService.getMemos(userId);
    const memo = memos.find(m => m.id.startsWith(memoIdPrefix));

    if (!memo) {
      await this.bot.sendMessage(chatId, 'Memo not found.');
      return;
    }

    try {
      await this.memoService.completeMemo(userId, memo.id);

      await this.bot.sendMessage(
        chatId,
        `Completed: ${UIHelpers.escapeMarkdown(memo.content)}`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Completed memo', { userId, memoId: memo.id });
    } catch (error) {
      await this.bot.sendMessage(chatId, 'Failed to complete memo.');
    }
  }

  /**
   * Delete a memo
   */
  private async deleteMemo(chatId: number, userId: number, memoIdPrefix: string): Promise<void> {
    const memos = this.memoService.getMemos(userId);
    const memo = memos.find(m => m.id.startsWith(memoIdPrefix));

    if (!memo) {
      await this.bot.sendMessage(chatId, 'Memo not found.');
      return;
    }

    try {
      await this.memoService.deleteMemo(userId, memo.id);

      await this.bot.sendMessage(
        chatId,
        `Deleted: ${UIHelpers.escapeMarkdown(memo.content)}`,
        { parse_mode: 'Markdown' }
      );

      logger.info('Deleted memo', { userId, memoId: memo.id });
    } catch (error) {
      await this.bot.sendMessage(chatId, 'Failed to delete memo.');
    }
  }

  /**
   * Clear memos
   */
  private async clearMemos(chatId: number, _userId: number, typeFilter?: string): Promise<void> {
    let type: MemoType | undefined;
    let typeLabel: string;

    switch (typeFilter?.toLowerCase()) {
      case 'todos':
      case 'todo':
        type = MemoType.TODO;
        typeLabel = 'TODOs';
        break;
      case 'done':
      case 'completed':
        type = MemoType.DONE;
        typeLabel = 'completed tasks';
        break;
      case 'notes':
      case 'note':
        type = MemoType.NOTE;
        typeLabel = 'notes';
        break;
      default:
        type = undefined;
        typeLabel = 'all memos';
    }

    // Confirm before clearing
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'Yes, clear', callback_data: `memo_clear_confirm_${type || 'all'}` },
          { text: 'Cancel', callback_data: 'memo_clear_cancel' }
        ]
      ]
    };

    await this.bot.sendMessage(
      chatId,
      `Are you sure you want to clear ${typeLabel}?`,
      { reply_markup: keyboard }
    );
  }

  /**
   * Show summary
   */
  private async showSummary(chatId: number, userId: number): Promise<void> {
    const summary = this.memoService.getSummary(userId);
    const pendingTodos = this.memoService.getPendingTodos(userId);

    let message = `*Memo Summary*\n\n`;
    message += `Pending TODOs: ${summary.todos}\n`;
    message += `Completed: ${summary.done}\n`;
    message += `Notes: ${summary.notes}\n`;

    if (pendingTodos.length > 0) {
      message += `\n*Pending TODOs:*\n`;
      for (const todo of pendingTodos.slice(0, 5)) {
        message += `- ${UIHelpers.escapeMarkdown(todo.content)}\n`;
      }
      if (pendingTodos.length > 5) {
        message += `_...and ${pendingTodos.length - 5} more_\n`;
      }
    }

    await this.bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  /**
   * Get emoji for memo type
   */
  private getMemoTypeEmoji(type: MemoType): string {
    switch (type) {
      case MemoType.TODO: return '';
      case MemoType.DONE: return '';
      case MemoType.NOTE: return '';
      default: return '';
    }
  }

  /**
   * Get emoji for memo status
   */
  private getMemoStatusEmoji(status: MemoStatus): string {
    switch (status) {
      case MemoStatus.PENDING: return '';
      case MemoStatus.IN_PROGRESS: return '';
      case MemoStatus.COMPLETED: return '';
      case MemoStatus.CANCELLED: return '';
      default: return '';
    }
  }

  /**
   * Handle callback query for memo actions
   */
  async handleMemoCallback(
    chatId: number,
    messageId: number,
    userId: number,
    action: string
  ): Promise<void> {
    const parts = action.split('_');

    switch (parts[0]) {
      case 'list':
        await this.listMemos(chatId, userId, parts[1]);
        break;

      case 'complete':
        if (parts[1]) {
          await this.completeMemo(chatId, userId, parts[1]);
        }
        break;

      case 'delete':
        if (parts[1]) {
          await this.deleteMemo(chatId, userId, parts[1]);
        }
        break;

      case 'clear':
        if (parts[1] === 'confirm') {
          const type = parts[2] === 'all' ? undefined : parts[2] as MemoType;
          const cleared = await this.memoService.clearMemos(userId, type);
          await this.bot.editMessageText(`Cleared ${cleared} memos.`, {
            chat_id: chatId,
            message_id: messageId
          });
        } else if (parts[1] === 'cancel') {
          await this.bot.editMessageText('Clear cancelled.', {
            chat_id: chatId,
            message_id: messageId
          });
        }
        break;

      case 'summary':
        await this.showSummary(chatId, userId);
        break;
    }
  }
}

export default MemoHandlers;
