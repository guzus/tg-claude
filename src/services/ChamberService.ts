import { logger } from '../utils/logger';
import { runClaudeWithTools, delay, ToolCall } from '../utils/ClaudeRunner';
import { gitService } from './GitService';
import { AIProviderConfig } from '../types';
import * as fs from 'fs';
import * as path from 'path';
import TelegramBot from 'node-telegram-bot-api';

function remoteUrlToHttps(remoteUrl: string | null): string | null {
  if (!remoteUrl) return null;
  if (remoteUrl.startsWith('https://')) return remoteUrl.replace(/\.git$/, '');
  const match = remoteUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) return `https://github.com/${match[1]}`;
  return null;
}

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

  private formatToolCalls(toolCalls: ToolCall[]): string {
    if (toolCalls.length === 0) return '';
    
    let formatted = '\n<details>\n<summary>🔧 Tool Usage</summary>\n\n';
    for (const tool of toolCalls) {
      formatted += `**${tool.name}**\n`;
      if (tool.input) {
        const inputPreview = tool.input.length > 200 ? tool.input.substring(0, 200) + '...' : tool.input;
        formatted += `\`\`\`\n${inputPreview}\n\`\`\`\n`;
      }
    }
    formatted += '</details>\n';
    return formatted;
  }

  private formatToolCallsForTelegram(toolCalls: ToolCall[]): string {
    if (toolCalls.length === 0) return '';
    
    const toolNames = toolCalls.map(t => t.name).join(', ');
    return `\n\n🔧 Tools: ${toolNames}`;
  }

  private async appendToLog(role: 'glm' | 'anthropic', content: string, toolCalls: ToolCall[]): Promise<void> {
    const logPath = this.getLogFilePath();
    const timestamp = new Date().toISOString();
    const roleName = role === 'glm' ? 'GLM' : 'Claude';
    const emoji = role === 'glm' ? '🤖' : '🧠';
    const toolSection = this.formatToolCalls(toolCalls);
    
    const entry = `
### ${emoji} ${roleName}
*${timestamp}*
${toolSection}
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

  private async executeWithProvider(provider: 'glm' | 'anthropic', prompt: string): Promise<{ output: string; toolCalls: ToolCall[] }> {
    if (!this.currentSession) throw new Error('No active session');

    const result = await runClaudeWithTools({
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

    return { output: result.output, toolCalls: result.toolCalls };
  }

  private async broadcastToTelegram(role: string, content: string, toolCalls: ToolCall[]): Promise<void> {
    const emoji = role === 'glm' ? '🤖' : '🧠';
    const providerName = role === 'glm' ? 'GLM' : 'Claude';
    const toolSummary = this.formatToolCallsForTelegram(toolCalls);
    const fullContent = content + toolSummary;
    
    const header = `${emoji} *${providerName}*:\n\n`;
    const maxChunkSize = 4000;
    const chunks: string[] = [];
    
    let remaining = fullContent;
    while (remaining.length > 0) {
      if (remaining.length <= maxChunkSize) {
        chunks.push(remaining);
        break;
      }
      let splitAt = remaining.lastIndexOf('\n', maxChunkSize);
      if (splitAt === -1 || splitAt < maxChunkSize / 2) {
        splitAt = remaining.lastIndexOf(' ', maxChunkSize);
      }
      if (splitAt === -1 || splitAt < maxChunkSize / 2) {
        splitAt = maxChunkSize;
      }
      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }
    
    for (let i = 0; i < chunks.length; i++) {
      const prefix = i === 0 ? header : `${emoji} *(cont.)*\n\n`;
      const text = prefix + chunks[i];
      try {
        await this.bot.sendMessage(BROADCAST_CHAT_ID, text, { 
          parse_mode: 'Markdown',
          disable_web_page_preview: true 
        });
      } catch {
        try {
          await this.bot.sendMessage(BROADCAST_CHAT_ID, text.replace(/\*/g, ''), { 
            disable_web_page_preview: true 
          });
        } catch (error) {
          logger.error('Failed to broadcast to Telegram', { 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      }
      if (i < chunks.length - 1) await delay(500);
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

    const remoteUrl = await gitService.getRemoteUrl(repoPath);
    const repoLink = remoteUrlToHttps(remoteUrl);
    const repoDisplay = repoLink ? `[${repoName}](${repoLink})` : `\`${repoName}\``;
    
    const startMsg = await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏛️ *Chamber Mode Started*\n\nRepo: ${repoDisplay}\nTopic: ${topic}\n\nGLM 🤖 ↔️ 🧠 Claude`,
      { parse_mode: 'Markdown' }
    );
    await this.bot.pinChatMessage(BROADCAST_CHAT_ID, startMsg.message_id).catch(() => {});

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
      glm: 'GLM (developed by Zhipu AI)',
      anthropic: 'Claude (developed by Anthropic)'
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

    const firstPrompt = `You are GLM (developed by Zhipu AI), starting a conversation with Claude (developed by Anthropic).

Read ${CONVERSATION_LOG_FILE} to see the topic for discussion.

Introduce yourself briefly and share your initial thoughts on the topic. Keep your response under 500 words.

IMPORTANT: Output ONLY your conversational response. Do not include meta-commentary.`;

    while (this.currentSession?.isRunning && !this.stopRequested) {
      try {
        logger.info(`Executing ${currentRole} turn`, { turn: this.currentSession.turnCount });
        
        const prompt = this.currentSession.turnCount === 0 ? firstPrompt : this.buildPrompt(currentRole);
        const { output, toolCalls } = await this.executeWithProvider(currentRole, prompt);
        
        if (this.stopRequested) break;

        await this.appendToLog(currentRole, output, toolCalls);
        this.currentSession.turnCount++;

        await this.broadcastToTelegram(currentRole, output, toolCalls);

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

  private parseConversationLog(repoPath: string): { topic: string; lastSpeaker: 'glm' | 'anthropic' | null; turnCount: number } | null {
    const logPath = path.join(repoPath, CONVERSATION_LOG_FILE);
    
    if (!fs.existsSync(logPath)) return null;
    
    const content = fs.readFileSync(logPath, 'utf-8');
    
    const topicMatch = content.match(/\*\*Topic:\*\*\s*(.+)/);
    const topic = topicMatch?.[1]?.trim() || 'Continuing conversation';
    
    const speakerMatches = content.match(/### (🤖|🧠)/g) || [];
    const turnCount = speakerMatches.length;
    
    if (turnCount === 0) return { topic, lastSpeaker: null, turnCount: 0 };
    
    const lastEmoji = speakerMatches[speakerMatches.length - 1];
    const lastSpeaker = lastEmoji.includes('🤖') ? 'glm' : 'anthropic';
    
    return { topic, lastSpeaker, turnCount };
  }

  async resumeConversation(repoPath: string, repoName: string, aiProvider?: AIProviderConfig): Promise<string> {
    if (this.currentSession?.isRunning) {
      return 'A conversation is already running. Use /chamber stop first.';
    }

    const parsed = this.parseConversationLog(repoPath);
    
    if (!parsed) {
      return 'No CONVERSATION.md found. Use /chamber start to begin a new conversation.';
    }

    if (parsed.turnCount === 0) {
      return 'Conversation log is empty. Use /chamber start to begin.';
    }

    const nextRole: 'glm' | 'anthropic' = parsed.lastSpeaker === 'glm' ? 'anthropic' : 'glm';

    this.stopRequested = false;
    this.currentSession = {
      id: Date.now().toString(),
      topic: parsed.topic,
      repoPath,
      repoName,
      startTime: new Date(),
      turnCount: parsed.turnCount,
      isRunning: true,
      aiProvider,
    };

    const remoteUrl = await gitService.getRemoteUrl(repoPath);
    const repoLink = remoteUrlToHttps(remoteUrl);
    const repoDisplay = repoLink ? `[${repoName}](${repoLink})` : `\`${repoName}\``;

    const resumeMsg = await this.bot.sendMessage(
      BROADCAST_CHAT_ID,
      `🏛️ *Chamber Resumed*\n\nRepo: ${repoDisplay}\nTopic: ${parsed.topic}\nContinuing from turn ${parsed.turnCount + 1} (${nextRole === 'glm' ? 'GLM 🤖' : 'Claude 🧠'})`,
      { parse_mode: 'Markdown' }
    );
    await this.bot.pinChatMessage(BROADCAST_CHAT_ID, resumeMsg.message_id).catch(() => {});

    logger.info('Resuming chamber mode', { 
      sessionId: this.currentSession.id, 
      repoPath, 
      repoName, 
      topic: parsed.topic,
      nextRole,
      turnCount: parsed.turnCount
    });

    this.runConversationLoopFrom(nextRole).catch(error => {
      logger.error('Conversation loop error', { error: error.message });
    });

    return `Resumed conversation in \`${repoName}\`\nSession: \`${this.currentSession.id}\``;
  }

  private async runConversationLoopFrom(startRole: 'glm' | 'anthropic'): Promise<void> {
    let currentRole = startRole;

    while (this.currentSession?.isRunning && !this.stopRequested) {
      try {
        logger.info(`Executing ${currentRole} turn`, { turn: this.currentSession.turnCount });
        
        const prompt = this.buildPrompt(currentRole);
        const { output, toolCalls } = await this.executeWithProvider(currentRole, prompt);
        
        if (this.stopRequested) break;

        await this.appendToLog(currentRole, output, toolCalls);
        this.currentSession.turnCount++;

        await this.broadcastToTelegram(currentRole, output, toolCalls);

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
