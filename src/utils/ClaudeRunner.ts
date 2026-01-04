import { spawn, ChildProcess } from 'child_process';
import { AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS, AIProvider } from '../types';

export interface ClaudeRunOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  apiKey?: string;
  timeout?: number;
  dangerMode?: boolean;
}

export interface SpawnClaudeOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  apiKey?: string;
  dangerMode?: boolean;
  additionalFlags?: string[];
  model?: string;  // Override default model (e.g., 'opus', 'haiku')
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
export function configureProviderEnv(provider: AIProvider = 'anthropic', apiKey?: string, model?: string): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (provider === 'glm') {
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.glm;
    env.ANTHROPIC_AUTH_TOKEN = apiKey || process.env.GLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
    env.API_TIMEOUT_MS = '3000000';
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = GLM_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = GLM_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = GLM_MODEL_MAPPINGS.opus;
  } else {
    delete env.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_MODEL = model || 'sonnet';
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey;
    }
  }

  return env;
}

/**
 * Delay execution for specified milliseconds
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Spawn Claude CLI process with configured environment and args.
 * This is the single source of truth for spawning Claude.
 *
 * --continue resumes the most recent conversation. TODO: Add /flush command to start fresh session
 */
export function spawnClaude(options: SpawnClaudeOptions): ChildProcess {
  const {
    prompt,
    workingDir = process.cwd(),
    provider = 'anthropic',
    apiKey,
    dangerMode = true,
    additionalFlags = [],
    model
  } = options;

  const env = configureProviderEnv(provider, apiKey, model);
  const isRoot = process.getuid && process.getuid() === 0;

  if (isRoot) {
    env.IS_SANDBOX = '1';
    env.CLAUDE_AUTO_APPROVE = '1';
    env.CI = 'true';
  }

  const args = [
    '--continue',
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    ...(dangerMode ? ['--dangerously-skip-permissions'] : []),
    ...additionalFlags,
    '--',
    prompt
  ];

  const claudeProcess = spawn('claude', args, {
    cwd: workingDir,
    env,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Handle root user stdin requirements
  if (isRoot && claudeProcess.stdin) {
    claudeProcess.stdin.write('y\n');
    claudeProcess.stdin.write('yes\n');
    claudeProcess.stdin.write('y\n');
    setTimeout(() => claudeProcess.stdin?.end(), 100);
  } else {
    claudeProcess.stdin?.end();
  }

  return claudeProcess;
}

/**
 * Run Claude CLI with stream-json output to capture tool calls.
 * Returns a Promise that resolves when the process completes.
 */
export function runClaudeWithTools(options: ClaudeRunOptions): Promise<ClaudeStreamResult> {
  const {
    prompt,
    workingDir,
    provider,
    apiKey,
    timeout = 300000,
    dangerMode
  } = options;

  return new Promise((resolve, reject) => {
    const claudeProcess = spawnClaude({
      prompt,
      workingDir,
      provider,
      apiKey,
      dangerMode
    });

    let rawOutput = '';
    let errorOutput = '';
    const toolCalls: ToolCall[] = [];
    let finalText = '';

    claudeProcess.stdout?.on('data', (data: Buffer) => {
      rawOutput += data.toString();

      const lines = data.toString().split('\n').filter(line => line.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);

          if (event.type === 'assistant' && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === 'tool_use') {
                toolCalls.push({
                  name: block.name || '',
                  input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input || {}),
                  output: ''
                });
              }
              if (block.type === 'text') {
                finalText += block.text || '';
              }
            }
          }

          if (event.type === 'result') {
            finalText += typeof event.result === 'string' ? event.result : '';
          }
        } catch { /* non-JSON line */ }
      }
    });

    claudeProcess.stderr?.on('data', (data: Buffer) => {
      errorOutput += data.toString();
    });

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
