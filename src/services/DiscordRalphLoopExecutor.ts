import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Message, TextBasedChannel } from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ClaudeExecutorInstance } from './IClaudeExecutor';
import { ensureDefaultPluginMarketplaces } from './ClaudePluginMarketplace';
import { TaskStatus, Repository, RepositoryType, AIProviderConfig, StreamEvent, ClaudeTaskWithStreaming } from '../types';
import { PLUGIN_PRESETS } from '../presets';
import { logger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { formatDuration } from '../utils/time';
import { gitService } from './GitService';
import { getProviderLabel } from '../utils/providers';

export enum DiscordRalphLoopStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  STOPPED = 'stopped',
  MAX_ITERATIONS = 'max_iterations',
  TIMEOUT = 'timeout',
  FAILED = 'failed'
}

export interface DiscordRalphLoopConfig {
  maxIterations: number;
  completionPromise: string;
  maxDurationMs: number;
}

export interface DiscordRalphLoopState {
  sessionId: string;
  userId: number;
  chatKey: number;
  channelId: string;
  channel: TextBasedChannel;
  originalRequest: string;
  workingDir: string;
  status: DiscordRalphLoopStatus;
  iteration: number;
  startTime: Date;
  endTime?: Date;
  config: DiscordRalphLoopConfig;
  message?: Message;
  taskId?: string;
  cleanedUp: boolean;
  aiProvider?: AIProviderConfig;
  pluginReady?: boolean;
  pluginError?: string;
}

const DEFAULT_RALPH_CONFIG: DiscordRalphLoopConfig = {
  maxIterations: 50,
  completionPromise: 'RALPH_COMPLETE',
  maxDurationMs: 60 * 60 * 1000
};

const SESSION_CLEANUP_DELAY_MS = 60 * 60 * 1000;
const TASK_POLL_INTERVAL_MS = 5000;

export class DiscordRalphLoopExecutor {
  private executor: ClaudeExecutorInstance;
  private activeSessions: Map<string, DiscordRalphLoopState> = new Map();
  private userSessions: Map<number, string> = new Map();

  constructor(executor: ClaudeExecutorInstance) {
    this.executor = executor;
  }

  async startSession(
    userId: number,
    chatKey: number,
    channel: TextBasedChannel,
    request: string,
    workingDir: string,
    config: Partial<DiscordRalphLoopConfig> = {},
    aiProvider?: AIProviderConfig
  ): Promise<DiscordRalphLoopState> {
    if (!path.isAbsolute(workingDir) || !fs.existsSync(workingDir)) {
      throw new Error('Invalid working directory');
    }

    const existingSessionId = this.userSessions.get(userId);
    if (existingSessionId) {
      const existingSession = this.activeSessions.get(existingSessionId);
      if (existingSession && existingSession.status === DiscordRalphLoopStatus.RUNNING) {
        throw new Error('You already have an active Ralph loop. Stop it first.');
      }
    }

    const sessionId = uuidv4();
    const finalConfig: DiscordRalphLoopConfig = { ...DEFAULT_RALPH_CONFIG, ...config };

    const state: DiscordRalphLoopState = {
      sessionId,
      userId,
      chatKey,
      channelId: channel.id,
      channel,
      originalRequest: request.trim().substring(0, 10000),
      workingDir,
      status: DiscordRalphLoopStatus.RUNNING,
      iteration: 1,
      startTime: new Date(),
      config: finalConfig,
      cleanedUp: false,
      aiProvider
    };

    this.userSessions.set(userId, sessionId);
    this.activeSessions.set(sessionId, state);

    logger.info('Discord Ralph loop session started', {
      sessionId,
      userId,
      channelId: channel.id,
      maxIterations: finalConfig.maxIterations,
      completionPromise: finalConfig.completionPromise
    });

    this.runRalphLoop(state).catch(error => {
      logger.error('Discord Ralph loop failed', {
        sessionId,
        error: getErrorMessage(error)
      });
      this.cleanupSession(state);
    });

    return state;
  }

  stopSession(sessionId: string): boolean {
    const state = this.activeSessions.get(sessionId);
    if (!state || state.cleanedUp) return false;

    state.status = DiscordRalphLoopStatus.STOPPED;
    state.endTime = new Date();

    if (state.taskId) {
      this.executor.cancelTask(state.taskId);
    }

    this.cleanupSession(state);
    return true;
  }

  stopSessionByUser(userId: number): boolean {
    const sessionId = this.userSessions.get(userId);
    return sessionId ? this.stopSession(sessionId) : false;
  }

  getUserSession(userId: number): DiscordRalphLoopState | undefined {
    const sessionId = this.userSessions.get(userId);
    return sessionId ? this.activeSessions.get(sessionId) : undefined;
  }

  private async ensureRalphPluginInstalled(
    workingDir: string
  ): Promise<{ ok: true } | { ok: false; error: string; pluginSpec: string }> {
    const preset = PLUGIN_PRESETS['ralph-loop'];
    if (!preset) {
      throw new Error('Ralph Wiggum plugin preset not found');
    }

    const pluginSpec = `${preset.name}@${preset.registry}`;

    try {
      ensureDefaultPluginMarketplaces(workingDir);
      execSync(`claude plugin install ${pluginSpec}`, {
        cwd: workingDir,
        encoding: 'utf-8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      logger.info('Ralph Wiggum plugin ready', { workingDir, pluginSpec });
      return { ok: true };
    } catch (error) {
      const errMsg = getErrorMessage(error);
      logger.warn('Plugin install returned non-zero', {
        workingDir,
        error: errMsg
      });

      if (errMsg.includes('marketplace') || (errMsg.includes('Plugin') && errMsg.includes('not found'))) {
        try {
          ensureDefaultPluginMarketplaces(workingDir);
          execSync(`claude plugin install ${pluginSpec}`, {
            cwd: workingDir,
            encoding: 'utf-8',
            timeout: 60000,
            stdio: ['pipe', 'pipe', 'pipe']
          });
          logger.info('Ralph Wiggum plugin ready after marketplace ensure', { workingDir, pluginSpec });
          return { ok: true };
        } catch (retryError) {
          const retryMsg = getErrorMessage(retryError);
          return { ok: false, error: retryMsg, pluginSpec };
        }
      }
      return { ok: false, error: errMsg, pluginSpec };
    }
  }

  private async runRalphLoop(state: DiscordRalphLoopState): Promise<void> {
    try {
      const pluginResult = await this.ensureRalphPluginInstalled(state.workingDir);
      state.pluginReady = pluginResult.ok;
      if (!pluginResult.ok) {
        state.pluginError = pluginResult.error;
        const warning = this.buildPluginWarning(pluginResult.error, pluginResult.pluginSpec);
        await this.safeSendMessage(state.channel, warning);
      }

      const repository = await this.getRepositoryContext(state.workingDir);
      const statusMessage = await this.sendStatusMessage(state, repository);
      if (statusMessage) state.message = statusMessage;

      const prompt = this.buildRalphPrompt(state);
      const task = this.executor.startTask(
        state.userId,
        state.chatKey,
        prompt,
        {
          workingDir: state.workingDir,
          timeout: state.config.maxDurationMs,
          aiProvider: state.aiProvider,
          ralphLoop: {
            completionPromise: state.config.completionPromise,
            maxIterations: state.config.maxIterations,
          },
        }
      );

      state.taskId = task.id;

      await this.monitorTask(state, task.id);
      await this.determineOutcome(state);
      await this.updateStatusMessage(state, repository);
      await this.sendFinalReport(state, repository);
      await this.finalCommitAndPush(state);
    } finally {
      this.cleanupSession(state);
    }
  }

  private buildPluginWarning(error: string, pluginSpec: string): string {
    const trimmedError = error.substring(0, 500);
    return [
      '⚠️ Could not install the `ralph-loop` plugin.',
      '',
      `Install error:`,
      `\`${trimmedError}\``,
      '',
      'Try:',
      `- \`/plugin preset ralph-loop\``,
      `- \`/plugin install ${pluginSpec}\``,
      '- Or update Claude Code CLI if the marketplace has changed.',
      '',
      'Continuing anyway…'
    ].join('\n');
  }

  private buildRalphPrompt(state: DiscordRalphLoopState): string {
    return state.originalRequest;
  }

  private async monitorTask(state: DiscordRalphLoopState, taskId: string): Promise<void> {
    return new Promise(resolve => {
      const startTime = Date.now();
      let lastUpdateTime = 0;

      const handleStreamEvent = (eventTaskId: string, event: StreamEvent) => {
        if (eventTaskId !== taskId) return;

        if (event.type === 'action' && Date.now() - lastUpdateTime > 2000) {
          lastUpdateTime = Date.now();
          this.updateStreamingStatusMessage(state, taskId).catch(() => {});
        }

        if (event.type === 'completed') {
          cleanup();
          state.endTime = new Date();
          logger.info('Discord Ralph loop task finished (stream)', {
            sessionId: state.sessionId,
            ok: event.ok
          });
          resolve();
        }
      };

      this.executor.on('streamEvent', handleStreamEvent);

      const cleanup = () => {
        this.executor.off('streamEvent', handleStreamEvent);
        clearInterval(fallbackInterval);
      };

      const fallbackInterval = setInterval(() => {
        if (Date.now() - startTime > state.config.maxDurationMs) {
          cleanup();
          state.status = DiscordRalphLoopStatus.TIMEOUT;
          state.endTime = new Date();
          logger.warn('Discord Ralph loop timeout', { sessionId: state.sessionId });
          resolve();
          return;
        }

        if (state.status !== DiscordRalphLoopStatus.RUNNING) {
          cleanup();
          logger.info('Discord Ralph loop stopped externally', { sessionId: state.sessionId, status: state.status });
          resolve();
          return;
        }

        const task = this.executor.getTask(taskId);
        if (!task) {
          cleanup();
          logger.warn('Discord Ralph loop task not found', { sessionId: state.sessionId, taskId });
          resolve();
          return;
        }

        if (task.status !== TaskStatus.RUNNING && task.status !== TaskStatus.PENDING) {
          cleanup();
          state.endTime = new Date();
          logger.info('Discord Ralph loop task finished (fallback)', {
            sessionId: state.sessionId,
            taskStatus: task.status
          });
          resolve();
        }
      }, TASK_POLL_INTERVAL_MS);
    });
  }

  private async determineOutcome(state: DiscordRalphLoopState): Promise<void> {
    if (state.status !== DiscordRalphLoopStatus.RUNNING) return;

    if (state.taskId) {
      const task = this.executor.getTask(state.taskId);
      const hasPromise = task?.output?.includes(state.config.completionPromise);

      if (hasPromise) {
        state.status = DiscordRalphLoopStatus.COMPLETED;
        return;
      }

      if (task?.status === TaskStatus.COMPLETED) {
        state.status = DiscordRalphLoopStatus.COMPLETED;
        return;
      }

      if (task?.status === TaskStatus.FAILED || task?.status === TaskStatus.TIMEOUT) {
        state.status = DiscordRalphLoopStatus.FAILED;
        return;
      }
    }

    state.status = DiscordRalphLoopStatus.FAILED;
  }

  private async sendStatusMessage(
    state: DiscordRalphLoopState,
    repository: Repository | null
  ): Promise<Message | undefined> {
    const embed = this.createStatusEmbed(state, repository);
    const components = [this.createControlRow(state, state.taskId)];

    try {
      return await state.channel.send({ embeds: [embed], components });
    } catch (error) {
      logger.error('Failed to send Ralph status message (Discord)', {
        sessionId: state.sessionId,
        error: getErrorMessage(error)
      });
      return undefined;
    }
  }

  private async updateStatusMessage(
    state: DiscordRalphLoopState,
    repository: Repository | null
  ): Promise<void> {
    if (!state.message) return;

    const embed = this.createStatusEmbed(state, repository);
    const components = state.status === DiscordRalphLoopStatus.RUNNING
      ? [this.createControlRow(state, state.taskId)]
      : [];

    try {
      await state.message.edit({ embeds: [embed], components });
    } catch {
      // Ignore edit errors
    }
  }

  private async updateStreamingStatusMessage(
    state: DiscordRalphLoopState,
    taskId: string
  ): Promise<void> {
    if (!state.message) return;
    const task = this.executor.getTask(taskId) as ClaudeTaskWithStreaming | undefined;
    if (!task) return;

    const repository = await this.getRepositoryContext(state.workingDir);
    const embed = this.createStatusEmbed(state, repository, task);
    const components = [this.createControlRow(state, taskId)];

    try {
      await state.message.edit({ embeds: [embed], components });
    } catch {
      // Ignore edit errors
    }
  }

  private async sendFinalReport(state: DiscordRalphLoopState, repository: Repository | null): Promise<void> {
    const duration = state.endTime
      ? Math.round((state.endTime.getTime() - state.startTime.getTime()) / 1000)
      : 0;

    const statusEmoji = this.getStatusEmoji(state.status);
    const statusText = this.getStatusText(state.status);

    const embed = new EmbedBuilder()
      .setColor(this.getStatusColor(state.status))
      .setTitle(`${statusEmoji} Ralph Loop ${statusText}`)
      .addFields(
        { name: 'Request', value: this.truncate(state.originalRequest, 800) },
        { name: 'Duration', value: formatDuration(duration), inline: true },
        { name: 'Promise', value: state.config.completionPromise, inline: true }
      );

    if (repository) {
      embed.addFields({ name: 'Repo', value: repository.name, inline: true });
    }

    const components = state.taskId ? [this.createViewLogRow(state.taskId)] : [];
    await this.safeSendMessage(state.channel, { embeds: [embed], components });
  }

  private async finalCommitAndPush(state: DiscordRalphLoopState): Promise<void> {
    logger.info('Discord Ralph loop attempting commit', {
      sessionId: state.sessionId,
      status: state.status,
      workingDir: state.workingDir
    });

    try {
      const commitHash = await gitService.autoCommit(state.workingDir);
      if (!commitHash) return;

      const pushResult = (await gitService.push(state.workingDir)).status;
      const shortHash = commitHash.substring(0, 8);
      const commitUrl = await this.getCommitUrl(state.workingDir, commitHash);

      const embed = new EmbedBuilder()
        .setColor(0x2B8A3E)
        .setTitle('💾 Ralph Loop Changes')
        .addFields(
          {
            name: 'Commit',
            value: commitUrl ? `[${shortHash}](${commitUrl})` : `\`${shortHash}\``,
            inline: true
          },
          { name: 'Push', value: this.describePushResult(pushResult), inline: true }
        );

      await this.safeSendMessage(state.channel, { embeds: [embed] });
    } catch (error) {
      logger.error('Failed to commit/push Ralph changes (Discord)', {
        sessionId: state.sessionId,
        error: getErrorMessage(error)
      });
    }
  }

  private describePushResult(result: 'success' | 'no_remote' | 'failed' | 'no_changes'): string {
    switch (result) {
      case 'success':
        return 'Pushed ✓';
      case 'no_remote':
        return 'No remote';
      case 'no_changes':
        return 'No changes';
      default:
        return 'Push failed';
    }
  }

  private getStatusEmoji(status: DiscordRalphLoopStatus): string {
    switch (status) {
      case DiscordRalphLoopStatus.RUNNING:
        return '🔄';
      case DiscordRalphLoopStatus.COMPLETED:
        return '✅';
      case DiscordRalphLoopStatus.STOPPED:
        return '🛑';
      case DiscordRalphLoopStatus.TIMEOUT:
        return '⏰';
      case DiscordRalphLoopStatus.MAX_ITERATIONS:
        return '⚠️';
      default:
        return '❌';
    }
  }

  private getStatusText(status: DiscordRalphLoopStatus): string {
    switch (status) {
      case DiscordRalphLoopStatus.COMPLETED:
        return 'Completed';
      case DiscordRalphLoopStatus.MAX_ITERATIONS:
        return 'Max Iterations';
      case DiscordRalphLoopStatus.TIMEOUT:
        return 'Timeout';
      case DiscordRalphLoopStatus.STOPPED:
        return 'Stopped';
      case DiscordRalphLoopStatus.RUNNING:
        return 'Running';
      default:
        return 'Failed';
    }
  }

  private getStatusColor(status: DiscordRalphLoopStatus): number {
    switch (status) {
      case DiscordRalphLoopStatus.COMPLETED:
        return 0x2B8A3E;
      case DiscordRalphLoopStatus.RUNNING:
        return 0x5865F2;
      case DiscordRalphLoopStatus.STOPPED:
        return 0xF59F00;
      case DiscordRalphLoopStatus.TIMEOUT:
      case DiscordRalphLoopStatus.MAX_ITERATIONS:
        return 0xFCC419;
      default:
        return 0xE03131;
    }
  }

  private createStatusEmbed(
    state: DiscordRalphLoopState,
    repository: Repository | null,
    task?: ClaudeTaskWithStreaming
  ): EmbedBuilder {
    const elapsed = Math.round((Date.now() - state.startTime.getTime()) / 1000);
    const providerLabel = getProviderLabel(state.aiProvider?.provider);

    const embed = new EmbedBuilder()
      .setColor(this.getStatusColor(state.status))
      .setTitle(`${this.getStatusEmoji(state.status)} Ralph Loop`)
      .addFields(
        { name: 'Request', value: this.truncate(state.originalRequest, 800) },
        { name: 'Duration', value: formatDuration(elapsed), inline: true },
        { name: 'Provider', value: providerLabel, inline: true },
        { name: 'Promise', value: this.truncate(state.config.completionPromise, 200), inline: true }
      );

    if (repository) {
      embed.addFields({ name: 'Repo', value: repository.name, inline: true });
    }

    if (state.pluginReady !== undefined) {
      embed.addFields({
        name: 'Plugin',
        value: state.pluginReady ? 'ralph-loop ✓' : 'ralph-loop missing',
        inline: true
      });
    }

    if (task?.currentAction) {
      embed.addFields({ name: 'Current Action', value: this.truncate(task.currentAction.title, 1024) });
    }

    return embed;
  }

  private createControlRow(
    state: DiscordRalphLoopState,
    taskId?: string
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`ralph_stop:${state.sessionId}`)
          .setLabel('Stop Ralph Loop')
          .setStyle(ButtonStyle.Danger)
          .setEmoji('🛑')
      );

    if (taskId) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`view_log:${taskId}`)
          .setLabel('View Log')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋')
      );
    }

    return row;
  }

  private createViewLogRow(taskId: string): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`view_log:${taskId}`)
          .setLabel('View Log')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('📋')
      );
  }

  private truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return value.substring(0, max - 3) + '...';
  }

  private async getRepositoryContext(workingDir: string): Promise<Repository | null> {
    try {
      const [remoteUrl, branch] = await Promise.all([
        gitService.getRemoteUrl(workingDir),
        gitService.getCurrentBranch(workingDir)
      ]);

      return {
        id: workingDir,
        name: path.basename(workingDir),
        path: workingDir,
        type: RepositoryType.EXISTING,
        gitUrl: remoteUrl || undefined,
        branch: branch || undefined,
        createdAt: new Date(),
        lastUsed: new Date()
      };
    } catch {
      return null;
    }
  }

  private async getCommitUrl(workingDir: string, commitHash: string): Promise<string | null> {
    const remoteUrl = await gitService.getRemoteUrl(workingDir);
    if (!remoteUrl) return null;

    const webUrl = gitService.toWebUrl(remoteUrl);
    return webUrl ? `${webUrl}/commit/${commitHash}` : null;
  }

  private cleanupSession(state: DiscordRalphLoopState): void {
    if (state.cleanedUp) return;
    state.cleanedUp = true;

    this.userSessions.delete(state.userId);

    if (!state.endTime) state.endTime = new Date();
    if (state.status === DiscordRalphLoopStatus.RUNNING) {
      state.status = DiscordRalphLoopStatus.FAILED;
    }

    setTimeout(() => {
      this.activeSessions.delete(state.sessionId);
    }, SESSION_CLEANUP_DELAY_MS);

    logger.info('Discord Ralph loop session cleaned up', {
      sessionId: state.sessionId,
      status: state.status
    });
  }

  private async safeSendMessage(
    channel: TextBasedChannel,
    content: string | { embeds?: EmbedBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] }
  ): Promise<void> {
    try {
      if (typeof content === 'string') {
        await channel.send({ content });
      } else {
        await channel.send(content);
      }
    } catch (error) {
      logger.debug('Failed to send Discord Ralph message', { error: getErrorMessage(error) });
    }
  }
}
