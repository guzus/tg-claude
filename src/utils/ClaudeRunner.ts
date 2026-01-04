import { spawn } from 'child_process';
import { AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS, OPENROUTER_MODEL_MAPPINGS, AIProvider, AIProviderConfig } from '../types';

export interface ClaudeRunOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  apiKey?: string;
  timeout?: number;
  dangerMode?: boolean;
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
export function configureProviderEnv(provider: AIProvider = 'anthropic', apiKey?: string, aiProviderConfig?: AIProviderConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };

  if (provider === 'glm') {
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.glm;
    env.ANTHROPIC_AUTH_TOKEN = apiKey || process.env.GLM_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || '';
    env.API_TIMEOUT_MS = '3000000';
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = GLM_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = GLM_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = GLM_MODEL_MAPPINGS.opus;
  } else if (provider === 'openrouter') {
    // OpenRouter uses ANTHROPIC_AUTH_TOKEN and requires ANTHROPIC_API_KEY to be blank
    // Per docs: https://openrouter.ai/docs/guides/guides/claude-code-integration
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.openrouter;
    env.ANTHROPIC_AUTH_TOKEN = apiKey || process.env.OPENROUTER_API_KEY || '';
    env.ANTHROPIC_API_KEY = '';  // Must be blank to prevent conflicts
    // Use custom models if configured, else defaults
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = aiProviderConfig?.haikuModel || OPENROUTER_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = aiProviderConfig?.sonnetModel || OPENROUTER_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = aiProviderConfig?.opusModel || OPENROUTER_MODEL_MAPPINGS.opus;
  } else {
    delete env.ANTHROPIC_BASE_URL;
    env.ANTHROPIC_MODEL = 'sonnet';
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
      '--verbose',
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
