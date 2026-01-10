import {
  ClaudeStreamEvent,
  StreamEvent,
  StreamAction,
  StreamActionKind,
  ClaudeAssistantEvent,
  ClaudeUserEvent,
} from '../types';
import { logger } from '../utils/logger';

/**
 * Parses Claude Code CLI JSON streaming output into structured events
 * Based on the approach used by takopi (https://github.com/banteg/takopi)
 */
export class StreamingOutputParser {
  private buffer: string = '';
  private actionCounter: number = 0;
  private sessionId: string | null = null;
  private activeActions: Map<string, StreamAction> = new Map();

  /**
   * Process a chunk of data from stdout and return any complete events
   */
  processChunk(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];

    // Split by newlines and process complete JSON lines
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const rawEvent = JSON.parse(trimmed) as ClaudeStreamEvent;
        const parsedEvents = this.translateEvent(rawEvent);
        events.push(...parsedEvents);
      } catch {
        // Not JSON - could be regular text output, ignore
        logger.debug('Non-JSON line in stream', { line: trimmed.substring(0, 100) });
      }
    }

    return events;
  }

  /**
   * Translate a raw Claude event into normalized StreamEvent(s)
   */
  private translateEvent(raw: ClaudeStreamEvent): StreamEvent[] {
    const events: StreamEvent[] = [];

    switch (raw.type) {
      case 'system':
        if (raw.subtype === 'init' && raw.session_id) {
          this.sessionId = raw.session_id;
          events.push({
            type: 'started',
            sessionId: raw.session_id,
            title: raw.message,
          });
        }
        break;

      case 'assistant':
        events.push(...this.translateAssistantEvent(raw));
        break;

      case 'user':
        events.push(...this.translateUserEvent(raw));
        break;

      case 'result':
        events.push({
          type: 'completed',
          ok: !raw.is_error,
          answer: raw.result || '',
          sessionId: raw.session_id,
          error: raw.is_error ? raw.result : undefined,
          costUsd: raw.total_cost_usd || raw.cost_usd,  // CLI uses total_cost_usd
          durationMs: raw.duration_ms,
        });
        break;
    }

    return events;
  }

  /**
   * Translate assistant events (tool calls)
   */
  private translateAssistantEvent(event: ClaudeAssistantEvent): StreamEvent[] {
    const events: StreamEvent[] = [];

    for (const content of event.message.content) {
      if (content.type === 'tool_use' && content.name && content.tool_use_id) {
        const action = this.createAction(content.name, content.input || {});
        this.activeActions.set(content.tool_use_id, action);

        events.push({
          type: 'action',
          action,
          phase: 'started',
        });
      } else if (content.type === 'text' && content.text) {
        // Text output from assistant - treat as a note
        const action = this.createAction('note', { text: content.text });
        events.push({
          type: 'action',
          action,
          phase: 'completed',
          ok: true,
          message: content.text.substring(0, 200),
        });
      }
    }

    return events;
  }

  /**
   * Translate user events (tool results)
   */
  private translateUserEvent(event: ClaudeUserEvent): StreamEvent[] {
    const events: StreamEvent[] = [];

    for (const content of event.message.content) {
      if (content.type === 'tool_result' && content.tool_use_id) {
        const action = this.activeActions.get(content.tool_use_id);
        if (action) {
          const ok = !content.is_error;
          const preview = this.extractPreview(content.content || '');

          events.push({
            type: 'action',
            action,
            phase: 'completed',
            ok,
            message: preview,
            level: ok ? 'info' : 'error',
          });

          this.activeActions.delete(content.tool_use_id);
        }
      }
    }

    return events;
  }

  /**
   * Create an action object from a tool call
   */
  private createAction(toolName: string, input: Record<string, unknown>): StreamAction {
    this.actionCounter++;
    const kind = this.mapToolToKind(toolName);
    const title = this.generateActionTitle(toolName, input);

    return {
      id: `action-${this.actionCounter}`,
      kind,
      title,
      detail: input,
    };
  }

  /**
   * Map tool names to action kinds
   */
  private mapToolToKind(toolName: string): StreamActionKind {
    const toolLower = toolName.toLowerCase();

    if (toolLower === 'bash' || toolLower.includes('command')) {
      return 'command';
    }
    if (toolLower === 'write' || toolLower === 'edit' || toolLower.includes('file')) {
      return 'file_change';
    }
    if (toolLower.includes('search') || toolLower.includes('web')) {
      return 'web_search';
    }
    if (toolLower === 'note' || toolLower === 'text') {
      return 'note';
    }

    return 'tool';
  }

  /**
   * Generate a human-readable title for an action
   */
  private generateActionTitle(toolName: string, input: Record<string, unknown>): string {
    const tool = toolName.toLowerCase();

    if (tool === 'bash') {
      const cmd = String(input.command || '').substring(0, 60);
      return `$ ${cmd}${String(input.command || '').length > 60 ? '...' : ''}`;
    }

    if (tool === 'read') {
      return `Read ${input.file_path || 'file'}`;
    }

    if (tool === 'write') {
      return `Write ${input.file_path || 'file'}`;
    }

    if (tool === 'edit') {
      return `Edit ${input.file_path || 'file'}`;
    }

    if (tool === 'glob') {
      return `Find ${input.pattern || 'files'}`;
    }

    if (tool === 'grep') {
      return `Search "${input.pattern || ''}"`;
    }

    if (tool === 'webfetch' || tool === 'web_fetch') {
      return `Fetch ${input.url || 'URL'}`;
    }

    if (tool === 'websearch' || tool === 'web_search') {
      return `Search: ${input.query || ''}`;
    }

    if (tool === 'note') {
      const text = String(input.text || '').trim();
      if (text) {
        // Show first line or truncated preview
        const firstLine = text.split('\n')[0];
        const preview = firstLine.length > 50 ? firstLine.substring(0, 47) + '...' : firstLine;
        return preview || 'Note';
      }
      return 'Note';
    }

    return toolName;
  }

  /**
   * Extract a preview from tool result content
   */
  private extractPreview(content: string): string {
    if (!content) return '';

    // Take first meaningful line
    const lines = content.split('\n').filter(l => l.trim());
    const firstLine = lines[0] || '';

    if (firstLine.length > 100) {
      return firstLine.substring(0, 100) + '...';
    }

    if (lines.length > 1) {
      return firstLine + ` (+${lines.length - 1} lines)`;
    }

    return firstLine;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Get active (in-progress) actions
   */
  getActiveActions(): StreamAction[] {
    return Array.from(this.activeActions.values());
  }

  /**
   * Reset parser state
   */
  reset(): void {
    this.buffer = '';
    this.actionCounter = 0;
    this.sessionId = null;
    this.activeActions.clear();
  }
}
