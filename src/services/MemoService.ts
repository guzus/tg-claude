import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

const MEMO_FILENAME = 'SHARED_NOTES.md';
const MAX_MEMO_SIZE = 50000; // 50KB max

export interface MemoEntry {
  timestamp: Date;
  type: 'task' | 'iteration' | 'review' | 'learning' | 'blocker';
  content: string;
}

export interface MemoContext {
  exists: boolean;
  content: string;
  lastUpdated?: Date;
  entries: MemoEntry[];
}

/**
 * MemoService manages persistent notes that survive across Claude runs.
 * Inspired by continuous-claude's SHARED_TASK_NOTES.md approach.
 *
 * The memo file serves as "institutional memory" - allowing Claude to:
 * - Remember what it learned in previous iterations
 * - Track blockers and decisions made
 * - Leave context for future runs
 * - Self-review and improve over time
 */
export class MemoService {
  /**
   * Get the memo file path for a repository
   */
  getMemoPath(workingDir: string): string {
    return path.join(workingDir, MEMO_FILENAME);
  }

  /**
   * Read the memo file for a repository
   */
  readMemo(workingDir: string): MemoContext {
    const memoPath = this.getMemoPath(workingDir);

    try {
      if (!fs.existsSync(memoPath)) {
        return {
          exists: false,
          content: '',
          entries: []
        };
      }

      const content = fs.readFileSync(memoPath, 'utf-8');
      const stats = fs.statSync(memoPath);

      return {
        exists: true,
        content,
        lastUpdated: stats.mtime,
        entries: this.parseEntries(content)
      };
    } catch (error) {
      logger.warn('Failed to read memo file', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        exists: false,
        content: '',
        entries: []
      };
    }
  }

  /**
   * Write/update the memo file for a repository
   */
  writeMemo(workingDir: string, content: string): boolean {
    const memoPath = this.getMemoPath(workingDir);

    try {
      // Ensure content doesn't exceed max size
      let finalContent = content;
      if (content.length > MAX_MEMO_SIZE) {
        // Keep the header and most recent entries
        finalContent = this.truncateMemo(content);
      }

      fs.writeFileSync(memoPath, finalContent, 'utf-8');

      logger.info('Updated memo file', {
        workingDir,
        size: finalContent.length
      });

      return true;
    } catch (error) {
      logger.error('Failed to write memo file', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Append an entry to the memo file
   */
  appendEntry(workingDir: string, entry: MemoEntry): boolean {
    const memo = this.readMemo(workingDir);
    const timestamp = new Date().toISOString();
    const typeEmoji = this.getTypeEmoji(entry.type);

    const entryText = `
## ${typeEmoji} ${entry.type.toUpperCase()} - ${timestamp}

${entry.content}

---
`;

    const newContent = memo.exists
      ? memo.content + entryText
      : this.createInitialMemo(workingDir) + entryText;

    return this.writeMemo(workingDir, newContent);
  }

  /**
   * Create initial memo file structure
   */
  createInitialMemo(workingDir: string): string {
    const repoName = path.basename(workingDir);
    const now = new Date().toISOString();

    return `# Shared Notes - ${repoName}

> This file contains persistent context shared across Claude Code runs.
> Claude updates this file with learnings, decisions, and context to maintain continuity.

**Created**: ${now}
**Repository**: ${repoName}

---

# Session History

`;
  }

  /**
   * Add a task summary to the memo
   */
  recordTaskSummary(
    workingDir: string,
    task: string,
    outcome: 'completed' | 'partial' | 'failed' | 'blocked',
    summary: string,
    learnings?: string[]
  ): boolean {
    const outcomeEmoji = {
      completed: '✅',
      partial: '⚠️',
      failed: '❌',
      blocked: '🚫'
    }[outcome];

    let content = `**Task**: ${task}\n**Outcome**: ${outcomeEmoji} ${outcome}\n\n${summary}`;

    if (learnings && learnings.length > 0) {
      content += '\n\n**Key Learnings**:\n';
      learnings.forEach(l => {
        content += `- ${l}\n`;
      });
    }

    return this.appendEntry(workingDir, {
      timestamp: new Date(),
      type: 'task',
      content
    });
  }

  /**
   * Add an iteration summary to the memo
   */
  recordIteration(
    workingDir: string,
    iterationNumber: number,
    task: string,
    outcome: string,
    nextSteps?: string
  ): boolean {
    let content = `**Iteration**: #${iterationNumber}\n**Task**: ${task}\n\n${outcome}`;

    if (nextSteps) {
      content += `\n\n**Next Steps**: ${nextSteps}`;
    }

    return this.appendEntry(workingDir, {
      timestamp: new Date(),
      type: 'iteration',
      content
    });
  }

  /**
   * Add a self-review to the memo
   */
  recordSelfReview(
    workingDir: string,
    review: string,
    improvements?: string[]
  ): boolean {
    let content = review;

    if (improvements && improvements.length > 0) {
      content += '\n\n**Areas for Improvement**:\n';
      improvements.forEach(i => {
        content += `- ${i}\n`;
      });
    }

    return this.appendEntry(workingDir, {
      timestamp: new Date(),
      type: 'review',
      content
    });
  }

  /**
   * Record a learning or insight
   */
  recordLearning(workingDir: string, learning: string): boolean {
    return this.appendEntry(workingDir, {
      timestamp: new Date(),
      type: 'learning',
      content: learning
    });
  }

  /**
   * Record a blocker
   */
  recordBlocker(workingDir: string, blocker: string, suggestedResolution?: string): boolean {
    let content = blocker;
    if (suggestedResolution) {
      content += `\n\n**Suggested Resolution**: ${suggestedResolution}`;
    }

    return this.appendEntry(workingDir, {
      timestamp: new Date(),
      type: 'blocker',
      content
    });
  }

  /**
   * Get a summary of the memo for prompt injection
   */
  getMemoSummary(workingDir: string, maxLength: number = 4000): string {
    const memo = this.readMemo(workingDir);

    if (!memo.exists) {
      return '';
    }

    // Return recent entries, trimmed to maxLength
    if (memo.content.length <= maxLength) {
      return memo.content;
    }

    // Get the last portion of the memo
    return '...\n\n' + memo.content.slice(-maxLength);
  }

  /**
   * Check for completion signals in content
   * Returns the number of completion signals found
   */
  detectCompletionSignals(content: string): number {
    const COMPLETION_SIGNAL = 'TASK_COMPLETE';
    const matches = content.match(new RegExp(COMPLETION_SIGNAL, 'g'));
    return matches ? matches.length : 0;
  }

  /**
   * Parse entries from memo content
   */
  private parseEntries(content: string): MemoEntry[] {
    const entries: MemoEntry[] = [];
    const entryPattern = /## ([\w️]+) (\w+) - ([\d\-T:.Z]+)\n\n([\s\S]*?)(?=\n---|\n## |$)/g;

    let match;
    while ((match = entryPattern.exec(content)) !== null) {
      const typeStr = match[2].toLowerCase();
      const type = ['task', 'iteration', 'review', 'learning', 'blocker'].includes(typeStr)
        ? typeStr as MemoEntry['type']
        : 'task';

      entries.push({
        timestamp: new Date(match[3]),
        type,
        content: match[4].trim()
      });
    }

    return entries;
  }

  /**
   * Truncate memo to keep recent entries
   */
  private truncateMemo(content: string): string {
    const lines = content.split('\n');
    const headerEndIndex = lines.findIndex(l => l.includes('# Session History'));

    if (headerEndIndex === -1) {
      // No proper header, just truncate from start
      return '# Shared Notes (truncated)\n\n...\n\n' + content.slice(-MAX_MEMO_SIZE + 100);
    }

    // Keep header and recent entries
    const header = lines.slice(0, headerEndIndex + 3).join('\n');
    const entries = content.slice(header.length);
    const maxEntriesSize = MAX_MEMO_SIZE - header.length - 100;

    return header + '\n\n...(older entries truncated)...\n\n' + entries.slice(-maxEntriesSize);
  }

  /**
   * Get emoji for entry type
   */
  private getTypeEmoji(type: MemoEntry['type']): string {
    const emojis = {
      task: '📋',
      iteration: '🔄',
      review: '🔍',
      learning: '💡',
      blocker: '🚫'
    };
    return emojis[type] || '📝';
  }

  /**
   * Clear the memo file (for testing or reset)
   */
  clearMemo(workingDir: string): boolean {
    const memoPath = this.getMemoPath(workingDir);

    try {
      if (fs.existsSync(memoPath)) {
        fs.unlinkSync(memoPath);
        logger.info('Cleared memo file', { workingDir });
      }
      return true;
    } catch (error) {
      logger.error('Failed to clear memo file', {
        workingDir,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }
}

export default MemoService;
