import { logger } from '../utils/logger';
import { runClaude, delay } from '../utils/ClaudeRunner';
import { gitService } from './GitService';
import { AIProviderConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import TelegramBot from 'node-telegram-bot-api';

const BROADCAST_CHAT_ID = '@claude_glm';
const CONVERSATION_LOG_FILE = 'CONVERSATION.md';

interface ConversationSession {
  id: string;
  topic: string;
  repoPath: string;
  repoName: string;
  startTime: Date;
  turnCount: number;
  isRunning: boolean;
  aiProvider?: AIProviderConfig;
}

export class ChamberService {
  private currentSession: ConversationSession | null = null;
  private stopRequested: boolean = false;
  private delayBetweenMessages: number = 5000;

  constructor(private bot: TelegramBot) {}

  private getLogFilePath(): string {
    if (!this.currentSession) throw new Error('No active session');
    return path.join(this.currentSession.repoPath, CONVERSATION_LOG_FILE);
  }

  private async initializeConversationLog(topic: string): Promise<void> {
    const logPath = this.getLogFilePath();
    const header = `# Chamber Conversation

**Topic:** ${topic}
**Started:** ${new Date().toISOString()}
**Session:** ${this.currentSession?.id}

---

## Conversation

`;
    fs.writeFileSync(logPath, header);
    await this.commitAndPush('Start new conversation');
  }

  private async appendToLog(role: 'glm' | 'anthropic', content: string): Promise<void> {
    const logPath = this.getLogFilePath();
    const timestamp = new Date().toISOString();
    const roleName = role === 'glm' ? 'GLM' : 'Anthropic';
    const emoji = role === 'glm' ? '🤖' : '🧠';
    
    const entry = `
### ${emoji} ${roleName}
*${timestamp}*

${content}

---
`;
    fs.appendFileSync(logPath, entry);
    await this.commitAndPush(`${roleName} response`);
  }

  private async commitAndPush(message: string): Promise<void> {
    if (!this.currentSession) return;
    const { repoPath } = this.currentSession;

    try {
      // Stage and commit
      await gitService.commit(repoPath, message);
      
      // Push to remote
      const pushResult = await gitService.push(repoPath);
      if (pushResult.status === 'success') {
        logger.info('Pushed to remote', { message });
      } else {
        logger.warn('Push failed or no remote', { status: pushResult.status });
      }
    } catch (error) {
      logger.error('Commit/push failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  private async executeWithProvider(provider: 'glm' | 'anthropic', prompt: string): Promise<string> {
    if (!this.currentSession) throw new Error('No active session');

    const result = await runClaude({
      prompt,
      provider,
      apiKey: provider === 'glm' ? this.currentSession.aiProvider?.apiKey : undefined,
      workingDir: this.currentSession.repoPath,
      timeout: 300000,
      dangerMode: true
    });

    if (result.exitCode !== 0) {
      throw new Error(result.errorOutput || `Process exited with code ${result.exitCode}`);
    }

    return result.output;
  }

  private async broadcastToTelegram(role: string, content: string): Promise<void> {
    const emoji = role === 'glm' ? '🤖' : '🧠';
    const providerName = role === 'glm' ? 'GLM' : 'Anthropic';
    
    const maxLength = 3800;
    const displayContent = content.length > maxLength 
      ? content.substring(0, maxLength) + '\n\n... (truncated)'
      : content;
    
    try {
      await this.bot.sendMessage(BROADCAST_CHAT_ID, `${emoji} *${providerName}*:\n\n${displayContent}`, { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true 
      });
    } catch {
      try {
        await this.bot.sendMessage(BROADCAST_CHAT_ID, `${emoji} ${providerName}:\n\n${displayContent}`, { 
          disable_web_page_preview: true 
        });
      } catch (error) {
        logger.error('Failed to broadcast to Telegram', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      }
    }
  }

  async startConversation(repoPath: string, repoName: string, initialTopic?: string, aiProvider?: AIProviderConfig): Promise<string> {
    if (this.currentSession?.isRunning) {
      return 'A conversation is already running. Use /chamber stop first.';
    }

    const topic = initialTopic || 'Discuss the future of artificial intelligence and its impact on humanity.';

    this.stopRequested = false;
    this.currentSession = {
      id: Date.now().toString(),
      topic,
      repoPath,
      repoName,
      startTime: new Date(),
      turnCount: 0,
      isRunning: true,
      aiProvider,
    };

    await this.initializeConversationLog(topic);

    await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏛️ *Chamber Mode Started*\n\nRepo: \`${repoName}\`\nTopic: ${topic}\n\nGLM 🤖 ↔️ 🧠 Anthropic`,
      { parse_mode: 'Markdown' }
    );

    logger.info('Starting chamber mode', { 
      sessionId: this.currentSession.id, 
      repoPath, 
      repoName, 
      topic 
    });

    this.runConversationLoop().catch(error => {
      logger.error('Conversation loop error', { error: error.message });
    });

    return `Conversation started in \`${repoName}\`\nSession: \`${this.currentSession.id}\``;
  }

  private buildPrompt(role: 'glm' | 'anthropic'): string {
    const roleNames = {
      glm: 'GLM (a Chinese AI developed by Zhipu AI)',
      anthropic: 'Claude (Anthropic\'s AI)'
    };
    const otherRole = role === 'glm' ? 'anthropic' : 'glm';

    return `You are ${roleNames[role]}, engaged in a conversation with ${roleNames[otherRole]}.

Read the conversation log in ${CONVERSATION_LOG_FILE} to see the full discussion history.

Your task:
1. Read ${CONVERSATION_LOG_FILE} to understand the conversation so far
2. Write your response to continue the conversation naturally

Guidelines:
- Respond to points made by the other AI
- Ask follow-up questions when appropriate  
- Share your unique perspective
- Introduce new related ideas
- Respectfully disagree if you have a different view
- Keep your response thoughtful but concise (under 500 words)
- Be genuine and engaging

IMPORTANT: Output ONLY your conversational response. Do not include meta-commentary about reading files or what you're doing.`;
  }

  private async runConversationLoop(): Promise<void> {
    let currentRole: 'glm' | 'anthropic' = 'glm';

    const firstPrompt = `You are GLM (a Chinese AI developed by Zhipu AI), starting a conversation with Claude (Anthropic's AI).

Read ${CONVERSATION_LOG_FILE} to see the topic for discussion.

Introduce yourself briefly and share your initial thoughts on the topic. Keep your response under 500 words.

IMPORTANT: Output ONLY your conversational response. Do not include meta-commentary.`;

    while (this.currentSession?.isRunning && !this.stopRequested) {
      try {
        logger.info(`Executing ${currentRole} turn`, { turn: this.currentSession.turnCount });
        
        const prompt = this.currentSession.turnCount === 0 ? firstPrompt : this.buildPrompt(currentRole);
        const response = await this.executeWithProvider(currentRole, prompt);
        
        if (this.stopRequested) break;

        // Append response to log, commit and push
        await this.appendToLog(currentRole, response);
        this.currentSession.turnCount++;

        // Broadcast to Telegram
        await this.broadcastToTelegram(currentRole, response);

        // Switch roles
        currentRole = currentRole === 'glm' ? 'anthropic' : 'glm';

        await delay(this.delayBetweenMessages);

      } catch (error) {
        logger.error('Error in conversation turn', { 
          role: currentRole, 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        await this.bot.sendMessage(
          BROADCAST_CHAT_ID,
          `⚠️ *Error in ${currentRole} response*\n\n\`${error instanceof Error ? error.message : String(error)}\`\n\nRetrying in 10 seconds...`,
          { parse_mode: 'Markdown' }
        );
        
        await delay(10000);
      }
    }

    await this.finalizeSession();
  }

  private async finalizeSession(): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.isRunning = false;

    const endMarker = `
---

## Session Ended

**Ended:** ${new Date().toISOString()}
**Total turns:** ${this.currentSession.turnCount}
`;
    fs.appendFileSync(this.getLogFilePath(), endMarker);
    await this.commitAndPush('End conversation');

    await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏁 *Chamber Mode Ended*\n\nRepo: \`${this.currentSession.repoName}\`\nTotal turns: ${this.currentSession.turnCount}`,
      { parse_mode: 'Markdown' }
    );

    logger.info('Conversation ended', { 
      sessionId: this.currentSession.id, 
      totalTurns: this.currentSession.turnCount 
    });
  }

  async stopConversation(): Promise<string> {
    if (!this.currentSession?.isRunning) {
      return 'No conversation is currently running.';
    }

    this.stopRequested = true;
    await delay(1000);
    
    return `Conversation stopped. Session ID: ${this.currentSession.id}`;
  }

  getStatus(): { 
    isRunning: boolean; 
    sessionId?: string; 
    turnCount?: number; 
    topic?: string;
    repoName?: string;
  } {
    if (!this.currentSession) {
      return { isRunning: false };
    }
    return {
      isRunning: this.currentSession.isRunning,
      sessionId: this.currentSession.id,
      turnCount: this.currentSession.turnCount,
      topic: this.currentSession.topic,
      repoName: this.currentSession.repoName,
    };
  }
}

export default ChamberService;
