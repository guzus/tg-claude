import { logger } from '../utils/logger';
import { runClaude, createLogFile, delay } from '../utils/ClaudeRunner';
import * as fs from 'fs';
import * as path from 'path';
import TelegramBot from 'node-telegram-bot-api';

const BROADCAST_CHAT_ID = '@claude_glm';
const CHAMBER_LOGS_DIR = path.join(process.cwd(), 'logs', 'chamber');

interface ConversationMessage {
  role: 'glm' | 'anthropic';
  content: string;
  timestamp: Date;
}

interface ConversationSession {
  id: string;
  startTime: Date;
  messages: ConversationMessage[];
  isRunning: boolean;
}

export class ChamberService {
  private currentSession: ConversationSession | null = null;
  private logStream: fs.WriteStream | null = null;
  private stopRequested: boolean = false;
  private delayBetweenMessages: number = 3000;

  constructor(private bot: TelegramBot) {}

  private async executeWithProvider(provider: 'glm' | 'anthropic', prompt: string): Promise<string> {
    const result = await runClaude({
      prompt,
      provider,
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

  private logMessage(role: string, content: string): void {
    if (this.logStream) {
      const timestamp = new Date().toISOString();
      this.logStream.write(`\n[${timestamp}] ${role.toUpperCase()}:\n${content}\n`);
      this.logStream.write('\n' + '='.repeat(80) + '\n');
    }
  }

  async startConversation(initialTopic?: string): Promise<string> {
    if (this.currentSession?.isRunning) {
      return 'A conversation is already running. Use /chamber stop first.';
    }

    this.stopRequested = false;
    this.currentSession = {
      id: Date.now().toString(),
      startTime: new Date(),
      messages: [],
      isRunning: true,
    };

    this.logStream = createLogFile(CHAMBER_LOGS_DIR, 'chamber');
    this.logStream.write(`=== Chamber Mode Started ===\n`);
    this.logStream.write(`Session ID: ${this.currentSession.id}\n`);
    this.logStream.write(`Start Time: ${this.currentSession.startTime.toISOString()}\n`);
    this.logStream.write('='.repeat(80) + '\n');

    await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏛️ *Chamber Mode Started*\n\nGLM 🤖 ↔️ 🧠 Anthropic\n\nSession: \`${this.currentSession.id}\``,
      { parse_mode: 'Markdown' }
    );

    const topic = initialTopic || 'Discuss the future of artificial intelligence and its impact on humanity. Be thoughtful and engaging.';
    
    logger.info('Starting chamber mode', { sessionId: this.currentSession.id, topic });

    this.runConversationLoop(topic).catch(error => {
      logger.error('Conversation loop error', { error: error.message });
    });

    return `Conversation started with session ID: ${this.currentSession.id}`;
  }

  private async runConversationLoop(initialTopic: string): Promise<void> {
    let currentMessage = `You are starting a deep intellectual conversation with another AI. The topic is: ${initialTopic}\n\nIntroduce yourself briefly and share your initial thoughts. Keep your response under 500 words.`;
    let currentRole: 'glm' | 'anthropic' = 'glm';

    while (this.currentSession?.isRunning && !this.stopRequested) {
      try {
        logger.info(`Executing ${currentRole} turn`);
        
        const response = await this.executeWithProvider(currentRole, currentMessage);
        
        if (this.stopRequested) break;

        this.currentSession.messages.push({
          role: currentRole,
          content: response,
          timestamp: new Date(),
        });

        this.logMessage(currentRole, response);
        await this.broadcastToTelegram(currentRole, response);

        const nextRole: 'glm' | 'anthropic' = currentRole === 'glm' ? 'anthropic' : 'glm';
        currentMessage = this.buildNextPrompt(currentRole, response, nextRole);
        currentRole = nextRole;

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

    this.finalizeSession();
  }

  private buildNextPrompt(previousRole: string, previousResponse: string, nextRole: string): string {
    const roleNames = {
      glm: 'GLM (a Chinese AI)',
      anthropic: 'Claude (Anthropic\'s AI)'
    };

    return `You are ${roleNames[nextRole as keyof typeof roleNames]}, engaged in a deep intellectual conversation with ${roleNames[previousRole as keyof typeof roleNames]}.

The other AI just said:
---
${previousResponse}
---

Continue the conversation naturally. You may:
- Respond to their points
- Ask follow-up questions
- Share your own perspective
- Introduce new related ideas
- Respectfully disagree if appropriate

Keep your response thoughtful but concise (under 500 words). Be genuine and engaging.`;
  }

  private async finalizeSession(): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.isRunning = false;

    if (this.logStream) {
      this.logStream.write('\n' + '='.repeat(80) + '\n');
      this.logStream.write(`=== Conversation Ended ===\n`);
      this.logStream.write(`Total messages: ${this.currentSession.messages.length}\n`);
      this.logStream.write(`End Time: ${new Date().toISOString()}\n`);
      this.logStream.end();
      this.logStream = null;
    }

    await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏁 *Chamber Mode Ended*\n\nSession: \`${this.currentSession.id}\`\nTotal exchanges: ${this.currentSession.messages.length}`,
      { parse_mode: 'Markdown' }
    );

    logger.info('Conversation ended', { 
      sessionId: this.currentSession.id, 
      totalMessages: this.currentSession.messages.length 
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

  getStatus(): { isRunning: boolean; sessionId?: string; messageCount?: number } {
    if (!this.currentSession) {
      return { isRunning: false };
    }
    return {
      isRunning: this.currentSession.isRunning,
      sessionId: this.currentSession.id,
      messageCount: this.currentSession.messages.length,
    };
  }

  getRecentMessages(count: number = 5): ConversationMessage[] {
    if (!this.currentSession) return [];
    return this.currentSession.messages.slice(-count);
  }
}

export default ChamberService;
