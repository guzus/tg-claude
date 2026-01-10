import winston from 'winston';
import { config } from '../config';
import path from 'path';
import fs from 'fs';

// Ensure logs directory exists
const logDir = path.dirname(config.logFile);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',

  // Bright foreground
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// Level configurations with icons and colors
const levelConfig: Record<string, { icon: string; color: string; bg?: string; label: string }> = {
  error: { icon: '✖', color: colors.brightRed, bg: colors.bgRed, label: 'ERROR' },
  warn: { icon: '⚠', color: colors.brightYellow, label: 'WARN ' },
  info: { icon: '●', color: colors.brightCyan, label: 'INFO ' },
  http: { icon: '→', color: colors.brightMagenta, label: 'HTTP ' },
  verbose: { icon: '◆', color: colors.brightBlue, label: 'VERB ' },
  debug: { icon: '◌', color: colors.gray, label: 'DEBUG' },
  silly: { icon: '○', color: colors.dim + colors.gray, label: 'SILLY' },
};

// Format timestamp
const formatTimestamp = (date: Date): string => {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const ms = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${ms}`;
};

// Pretty print objects
const formatMeta = (meta: Record<string, unknown>): string => {
  if (Object.keys(meta).length === 0) return '';

  const lines: string[] = [];

  for (const [key, value] of Object.entries(meta)) {
    if (key === 'stack' && typeof value === 'string') {
      // Format stack traces specially
      lines.push(`${colors.dim}${colors.red}${value}${colors.reset}`);
    } else if (typeof value === 'object' && value !== null) {
      const json = JSON.stringify(value, null, 2)
        .split('\n')
        .map((line, i) => i === 0 ? line : `    ${line}`)
        .join('\n');
      lines.push(`  ${colors.gray}${key}:${colors.reset} ${colors.dim}${json}${colors.reset}`);
    } else {
      lines.push(`  ${colors.gray}${key}:${colors.reset} ${colors.brightWhite}${value}${colors.reset}`);
    }
  }

  return '\n' + lines.join('\n');
};

// Custom console format with colors
const prettyConsoleFormat = winston.format.printf((info) => {
  const { level, message, timestamp, ...meta } = info;
  const config = levelConfig[level] || levelConfig.info;
  const time = formatTimestamp(new Date(timestamp as string));

  // Build the log line
  const timeStr = `${colors.dim}${time}${colors.reset}`;
  const iconStr = `${config.color}${config.icon}${colors.reset}`;
  const levelStr = `${config.color}${colors.bold}${config.label}${colors.reset}`;
  const msgStr = `${colors.white}${message}${colors.reset}`;
  const metaStr = formatMeta(meta as Record<string, unknown>);

  return `${timeStr} ${iconStr} ${levelStr} ${msgStr}${metaStr}`;
});

// File format (JSON for parsing)
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Console format
const consoleFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  prettyConsoleFormat
);

// Create the logger
export const logger = winston.createLogger({
  level: config.logLevel,
  format: fileFormat,
  transports: [
    new winston.transports.File({
      filename: config.logFile.replace('.log', '-error.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: config.logFile,
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: consoleFormat
    })
  ]
});

// Helper for logging with context
export const log = {
  // Standard levels
  error: (msg: string, meta?: Record<string, unknown>) => logger.error(msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => logger.info(msg, meta),
  http: (msg: string, meta?: Record<string, unknown>) => logger.http(msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(msg, meta),

  // Styled helpers
  success: (msg: string, meta?: Record<string, unknown>) => {
    const formatted = `${colors.brightGreen}✔${colors.reset} ${msg}`;
    logger.info(formatted, meta);
  },

  task: (msg: string, meta?: Record<string, unknown>) => {
    const formatted = `${colors.brightMagenta}⚡${colors.reset} ${msg}`;
    logger.info(formatted, meta);
  },

  api: (method: string, path: string, status?: number, duration?: number) => {
    const methodColors: Record<string, string> = {
      GET: colors.brightGreen,
      POST: colors.brightYellow,
      PUT: colors.brightBlue,
      DELETE: colors.brightRed,
      PATCH: colors.brightMagenta,
    };
    const methodColor = methodColors[method] || colors.white;
    const statusColor = status && status >= 400 ? colors.brightRed : colors.brightGreen;

    let msg = `${methodColor}${method.padEnd(6)}${colors.reset} ${path}`;
    if (status) msg += ` ${statusColor}${status}${colors.reset}`;
    if (duration) msg += ` ${colors.dim}${duration}ms${colors.reset}`;

    logger.http(msg);
  },

  startup: (msg: string) => {
    const line = '─'.repeat(50);
    console.log(`\n${colors.cyan}${line}${colors.reset}`);
    console.log(`${colors.brightCyan}${colors.bold}  🚀 ${msg}${colors.reset}`);
    console.log(`${colors.cyan}${line}${colors.reset}\n`);
  },

  section: (title: string) => {
    console.log(`\n${colors.dim}───${colors.reset} ${colors.brightWhite}${colors.bold}${title}${colors.reset} ${colors.dim}${'─'.repeat(Math.max(0, 40 - title.length))}${colors.reset}`);
  },
};

export default logger;
