import TelegramBot, { Message } from 'node-telegram-bot-api';
import { ChamberService } from '../services/ChamberService';
import { RepositoryManager } from '../services/RepositoryManager';
import { UserConfigManager } from '../services/UserConfigManager';
import { config } from '../config';
import { logger } from '../utils/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class ChamberHandlers {
  private chamberService: ChamberService;

  constructor(
    private bot: TelegramBot,
    private repositoryManager: RepositoryManager,
    private userConfigManager: UserConfigManager
  ) {
    this.chamberService = new ChamberService(bot);
  }

  async handleChamber(msg: Message, match: RegExpExecArray | null): Promise<void> {
    const userId = msg.from?.id;
    const chatId = msg.chat.id;

    if (!userId || !config.allowedUserIds.includes(userId)) {
      await this.bot.sendMessage(chatId, '⛔ Access denied');
      return;
    }

    const args = match?.[1]?.trim().split(/\s+/) || [];
    const subcommand = args[0] || 'status';
    const topic = args.slice(1).join(' ');

    try {
      switch (subcommand) {
        case 'start':
          await this.handleStart(chatId, userId, topic);
          break;

        case 'resume':
          await this.handleResume(chatId, userId);
          break;

        case 'stop':
          await this.handleStop(chatId);
          break;

        case 'status':
        default:
          await this.handleStatus(chatId);
          break;
      }
    } catch (error) {
      logger.error('Chamber command error', {
        userId,
        subcommand,
        error: error instanceof Error ? error.message : String(error)
      });
      await this.bot.sendMessage(chatId, '❌ An error occurred');
    }
  }

  private async findNextChamberIndex(userId: number): Promise<number> {
    const repos = await this.repositoryManager.listRepositories(userId);
    const chamberNames = repos
      .map(r => r.name)
      .filter(name => /^chamber-\d+$/.test(name));
    
    const indices = chamberNames.map(name => parseInt(name.replace('chamber-', '')));
    let index = 1;
    while (indices.includes(index)) {
      index++;
    }
    return index;
  }

  private async createPrivateGitHubRepo(repoPath: string, repoName: string): Promise<boolean> {
    try {
      await execAsync('git config user.email "clerk@chamber" && git config user.name "Clerk"', { cwd: repoPath });
      await execAsync('echo "# Chamber Conversation" > README.md && git add . && git commit -m "init"', { cwd: repoPath });
      await execAsync(
        `gh repo create ${repoName} --private --source=. --remote=origin --push`,
        { cwd: repoPath, timeout: 30000 }
      );
      return true;
    } catch (error) {
      logger.error('Failed to create GitHub repo', { 
        repoName, 
        error: error instanceof Error ? error.message : String(error) 
      });
      return false;
    }
  }

  private async handleStart(chatId: number, userId: number, topic?: string): Promise<void> {
    const index = await this.findNextChamberIndex(userId);
    const repoName = `chamber-${index}`;

    await this.bot.sendMessage(chatId, `🏛️ Creating \`${repoName}\`...`, { parse_mode: 'Markdown' });

    const repo = await this.repositoryManager.createRepository(userId, repoName, true);
    const ghCreated = await this.createPrivateGitHubRepo(repo.path, repoName);
    
    if (!ghCreated) {
      await this.bot.sendMessage(chatId, '⚠️ GitHub repo creation failed. Continuing with local repo only.');
    }

    const userConfig = await this.userConfigManager.getConfig(userId);
    const aiProvider = userConfig?.aiProvider;

    const result = await this.chamberService.startConversation(
      repo.path,
      repo.name,
      topic || undefined,
      aiProvider
    );
    await this.bot.sendMessage(chatId, `🏛️ ${result}`, { parse_mode: 'Markdown' });
  }

  private async handleResume(chatId: number, userId: number): Promise<void> {
    const currentRepo = this.repositoryManager.getCurrentRepository(userId);
    
    if (!currentRepo) {
      await this.bot.sendMessage(chatId, '❌ No repository selected.', { parse_mode: 'Markdown' });
      return;
    }

    const userConfig = await this.userConfigManager.getConfig(userId);
    const aiProvider = userConfig?.aiProvider;

    const result = await this.chamberService.resumeConversation(
      currentRepo.path,
      currentRepo.name,
      aiProvider
    );
    await this.bot.sendMessage(chatId, `🏛️ ${result}`, { parse_mode: 'Markdown' });
  }

  private async handleStop(chatId: number): Promise<void> {
    const result = await this.chamberService.stopConversation();
    await this.bot.sendMessage(chatId, `🛑 ${result}`, { parse_mode: 'Markdown' });
  }

  private async handleStatus(chatId: number): Promise<void> {
    const status = this.chamberService.getStatus();

    if (status.isRunning) {
      await this.bot.sendMessage(
        chatId,
        `🏛️ *Chamber Mode*\n\n` +
        `Status: 🟢 Running\n` +
        `Repo: \`${status.repoName}\`\n` +
        `Topic: ${status.topic}\n` +
        `Turns: ${status.turnCount}\n\n` +
        `Commands:\n` +
        `/chamber stop - Stop the conversation`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await this.bot.sendMessage(
        chatId,
        `🏛️ *Chamber Mode*\n\n` +
        `Status: 🔴 Stopped\n\n` +
        `GLM and Anthropic take turns responding. Each reads CONVERSATION.md, responds, commits & pushes.\n\n` +
        `Commands:\n` +
        `/chamber start [topic] - Auto-creates private repo\n` +
        `/chamber resume - Continue existing conversation\n` +
        `/chamber stop\n` +
        `/chamber status`,
        { parse_mode: 'Markdown' }
      );
    }
  }
}
