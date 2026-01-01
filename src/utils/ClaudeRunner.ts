import { spawn } from 'child_process';
import { AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS, AIProvider } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export interface ClaudeRunOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  timeout?: number;
  dangerMode?: boolean;
}

export interface ClaudeRunResult {
  output: string;
  errorOutput: string;
  exitCode: number;
}

/**
 * Configure environment variables for the specified AI provider
 */
export function configureProviderEnv(provider: AIProvider = 'anthropic', apiKey?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (provider === 'glm') {
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.glm;
    env.ANTHROPIC_AUTH_TOKEN = apiKey || process.env.GLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
    env.API_TIMEOUT_MS = '3000000';
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = GLM_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = GLM_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = GLM_MODEL_MAPPINGS.opus;
  } else {
    // Anthropic uses default endpoint
    delete env.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_MODEL = 'sonnet';
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
    }
  }

  return env;
}

/**
 * Run Claude CLI with the specified options
 */
export function runClaude(options: ClaudeRunOptions): Promise<ClaudeRunResult> {
  const {
    prompt,
    workingDir = process.cwd(),
    provider = 'anthropic',
    timeout = 300000,
    dangerMode = true
  } = options;

  return new Promise((resolve, reject) => {
    const env = configureProviderEnv(provider);
    const isRoot = process.getuid && process.getuid() === 0;
    
    // Set sandbox env vars when running as root to allow --dangerously-skip-permissions
    if (isRoot) {
      env.IS_SANDBOX = '1';
      env.CLAUDE_AUTO_APPROVE = '1';
      env.CI = 'true';
    }
    
    const args = [prompt, ...(dangerMode ? ['--dangerously-skip-permissions'] : [])];

    const claudeProcess = spawn('claude', args, {
      cwd: workingDir,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    let errorOutput = '';

    claudeProcess.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
    });

    claudeProcess.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

    claudeProcess.stdin?.end();

    const timeoutHandle = setTimeout(() => {
      claudeProcess.kill('SIGTERM');
      reject(new Error('Execution timeout'));
    }, timeout);

    claudeProcess.on('close', (code: number | null) => {
      clearTimeout(timeoutHandle);
      resolve({
        output: output.trim(),
        errorOutput: errorOutput.trim(),
        exitCode: code ?? 1
      });
    });

    claudeProcess.on('error', (error: Error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
  });
}

/**
 * Ensure a logs directory exists
 */
export function ensureLogsDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Create a timestamped log file
 */
export function createLogFile(logsDir: string, prefix: string): fs.WriteStream {
  ensureLogsDir(logsDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `${prefix}_${timestamp}.log`;
  const logFilePath = path.join(logsDir, logFileName);
  return fs.createWriteStream(logFilePath, { flags: 'a' });
}

/**
 * Delay execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
