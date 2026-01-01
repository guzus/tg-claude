import { spawn } from 'child_process';
import { AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS, AIProvider } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export interface ClaudeRunOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  apiKey?: string;
  timeout?: number;
  dangerMode?: boolean;
}

export interface ClaudeRunResult {
  output: string;
  errorOutput: string;
  exitCode: number;
}

export interface ToolCall {
  name: string;
  input: string;
  output: string;
}

export interface ClaudeStreamResult {
  output: string;
  errorOutput: string;
  exitCode: number;
  toolCalls: ToolCall[];
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
    apiKey,
    timeout = 300000,
    dangerMode = true
  } = options;

  return new Promise((resolve, reject) => {
    const env = configureProviderEnv(provider, apiKey);
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

/**
 * Run Claude CLI with stream-json output to capture tool calls
 */
export function runClaudeWithTools(options: ClaudeRunOptions): Promise<ClaudeStreamResult> {
  const {
    prompt,
    workingDir = process.cwd(),
    provider = 'anthropic',
    apiKey,
    timeout = 300000,
    dangerMode = true
  } = options;

  return new Promise((resolve, reject) => {
    const env = configureProviderEnv(provider, apiKey);
    const isRoot = process.getuid && process.getuid() === 0;
    
    if (isRoot) {
      env.IS_SANDBOX = '1';
      env.CLAUDE_AUTO_APPROVE = '1';
      env.CI = 'true';
    }
    
    const args = [
      '--print',
      '--output-format', 'stream-json',
      ...(dangerMode ? ['--dangerously-skip-permissions'] : []),
      prompt
    ];

    const claudeProcess = spawn('claude', args, {
      cwd: workingDir,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let rawOutput = '';
    let errorOutput = '';
    const toolCalls: ToolCall[] = [];
    let finalText = '';
    let currentToolName = '';
    let currentToolInput = '';

    claudeProcess.stdout?.on('data', (data: Buffer) => {
      rawOutput += data.toString();
      
      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);
          
          if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
            currentToolName = event.content_block.name || '';
            currentToolInput = '';
          }
          
          if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'input_json_delta') {
              currentToolInput += event.delta.partial_json || '';
            }
            if (event.delta?.type === 'text_delta') {
              finalText += event.delta.text || '';
            }
          }
          
          if (event.type === 'result' && currentToolName) {
            toolCalls.push({
              name: currentToolName,
              input: currentToolInput,
              output: typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
            });
            currentToolName = '';
            currentToolInput = '';
          }
          
          if (event.type === 'message_stop' || event.type === 'content_block_stop') {
            if (currentToolName && currentToolInput) {
              toolCalls.push({
                name: currentToolName,
                input: currentToolInput,
                output: ''
              });
              currentToolName = '';
              currentToolInput = '';
            }
          }
        } catch { /* non-JSON line */ }
      }
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
        output: finalText.trim() || rawOutput.trim(),
        errorOutput: errorOutput.trim(),
        exitCode: code ?? 1,
        toolCalls
      });
    });

    claudeProcess.on('error', (error: Error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
  });
}
