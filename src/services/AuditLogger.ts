import { AuditLogEntry } from '../types';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export class AuditLogger {
  private auditLogPath: string;
  private entries: AuditLogEntry[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(auditLogPath: string = './logs/audit.log') {
    this.auditLogPath = auditLogPath;
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(this.auditLogPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  /**
   * Log a command execution (async, non-blocking)
   */
  logCommand(entry: Omit<AuditLogEntry, 'timestamp'>): void {
    const fullEntry: AuditLogEntry = {
      ...entry,
      timestamp: new Date()
    };

    this.entries.push(fullEntry);

    // Write to file asynchronously using a queue to maintain order
    const logLine = JSON.stringify(fullEntry) + '\n';
    this.writeQueue = this.writeQueue
      .then(() => fs.promises.appendFile(this.auditLogPath, logLine, 'utf-8'))
      .catch(err => { logger.error('Failed to write audit log', { error: err.message }); });

    logger.info('Audit log entry', fullEntry);
  }

  /**
   * Get audit logs for a user
   */
  getUserLogs(userId: number, limit: number = 100): AuditLogEntry[] {
    return this.entries
      .filter(entry => entry.userId === userId)
      .slice(-limit);
  }

  /**
   * Get all audit logs
   */
  getAllLogs(limit: number = 100): AuditLogEntry[] {
    return this.entries.slice(-limit);
  }

  /**
   * Get failed commands
   */
  getFailedCommands(limit: number = 50): AuditLogEntry[] {
    return this.entries
      .filter(entry => !entry.success)
      .slice(-limit);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalCommands: number;
    successfulCommands: number;
    failedCommands: number;
    uniqueUsers: number;
  } {
    const uniqueUsers = new Set(this.entries.map(e => e.userId));

    return {
      totalCommands: this.entries.length,
      successfulCommands: this.entries.filter(e => e.success).length,
      failedCommands: this.entries.filter(e => !e.success).length,
      uniqueUsers: uniqueUsers.size
    };
  }
}

export default AuditLogger;
