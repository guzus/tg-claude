import { spawn } from 'child_process';
import { AI_PROVIDER_ENDPOINTS, GLM_MODEL_MAPPINGS, OPENROUTER_MODEL_MAPPINGS, AIProvider, AIProviderConfig } from '../types';

export interface ClaudeRunOptions {
  prompt: string;
  workingDir?: string;
  provider?: AIProvider;
  aiProvider?: AIProviderConfig;
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
 * Configure git for non-interactive use via GIT_CONFIG_* environment variables.
 * Sets up: credentials (token auth), identity (user.name/email), and URL rewriting.
 */
function configureGitEnv(env: NodeJS.ProcessEnv): void {
  let configIndex = parseInt(env.GIT_CONFIG_COUNT || '0', 10);

  // Helper to add a git config entry
  const addConfig = (key: string, value: string) => {
    env[`GIT_CONFIG_KEY_${configIndex}`] = key;
    env[`GIT_CONFIG_VALUE_${configIndex}`] = value;
    configIndex++;
  };

  // Configure git identity for commits (fallback if not already configured)
  const gitAuthorName = process.env.GIT_AUTHOR_NAME || 'tg-claude';
  const gitAuthorEmail = process.env.GIT_AUTHOR_EMAIL || 'tg-claude@remote';
  addConfig('user.name', gitAuthorName);
  addConfig('user.email', gitAuthorEmail);

  // Configure GitHub token auth if available
  const githubToken = process.env.GITHUB_PAT;
  if (githubToken) {
    // Rewrite HTTPS URLs to include token
    addConfig('url.https://x-access-token:' + githubToken + '@github.com/.insteadOf', 'https://github.com/');
    // Rewrite SSH URLs to HTTPS with token
    addConfig('url.https://x-access-token:' + githubToken + '@github.com/.insteadOf', 'git@github.com:');
  }

  env.GIT_CONFIG_COUNT = String(configIndex);
}

/**
 * Configure environment variables for the specified AI provider
 */
export function configureProviderEnv(provider: AIProvider = 'anthropic', aiProviderConfig?: AIProviderConfig): NodeJS.ProcessEnv {
  const env = { ...process.env };

  // Configure git for non-interactive use (identity + credentials)
  configureGitEnv(env);

  if (provider === 'glm') {
    // GLM (Z.ai) must use an explicit Z.ai API key. Do NOT fall back to ANTHROPIC_AUTH_TOKEN:
    // that token is commonly used for OpenRouter and will cause confusing 401s from Z.ai.
    // Prefer provider-specific key, then env.
    const glmKey = aiProviderConfig?.glmApiKey || process.env.GLM_API_KEY;
    if (!glmKey) {
      throw new Error('GLM provider requires aiProvider.glmApiKey or GLM_API_KEY');
    }
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.glm;
    env.ANTHROPIC_AUTH_TOKEN = glmKey;
    // Ensure Claude Code OAuth does not override the external provider token.
    // If CLAUDE_CODE_OAUTH_TOKEN is present, the CLI may prefer it and you'll get auth errors
    // that look like "token expired" / "please login" even though your GLM key is correct.
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // Keep request timeouts sane by default; allow override via env if GLM is slow in your region.
    // This timeout is used by Claude Code CLI's HTTP layer.
    env.API_TIMEOUT_MS = process.env.GLM_API_TIMEOUT_MS || process.env.AI_API_TIMEOUT_MS || '300000'; // 5 minutes
    // Allow user overrides via config (same shape as OpenRouter), else use defaults.
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = aiProviderConfig?.haikuModel || GLM_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = aiProviderConfig?.sonnetModel || GLM_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = aiProviderConfig?.opusModel || GLM_MODEL_MAPPINGS.opus;
    // Explicitly blank ANTHROPIC_API_KEY to prevent Claude Code OAuth fallback
    // and to avoid conflicts with ANTHROPIC_AUTH_TOKEN.
    env.ANTHROPIC_API_KEY = '';
  } else if (provider === 'openrouter') {
    // OpenRouter uses ANTHROPIC_AUTH_TOKEN
    // Per docs: https://openrouter.ai/docs/guides/guides/claude-code-integration
    // Prefer provider-specific key, then env.
    const orKey = aiProviderConfig?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (!orKey) {
      throw new Error('OpenRouter provider requires aiProvider.openrouterApiKey or OPENROUTER_API_KEY');
    }
    env.ANTHROPIC_BASE_URL = AI_PROVIDER_ENDPOINTS.openrouter;
    env.ANTHROPIC_AUTH_TOKEN = orKey;
    // Ensure Claude Code OAuth does not override the external provider token.
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    // Explicitly blank ANTHROPIC_API_KEY to prevent Claude Code OAuth fallback
    // and to avoid conflicts with ANTHROPIC_AUTH_TOKEN.
    env.ANTHROPIC_API_KEY = '';
    // Use custom models if configured, else defaults
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL = aiProviderConfig?.haikuModel || OPENROUTER_MODEL_MAPPINGS.haiku;
    env.ANTHROPIC_DEFAULT_SONNET_MODEL = aiProviderConfig?.sonnetModel || OPENROUTER_MODEL_MAPPINGS.sonnet;
    env.ANTHROPIC_DEFAULT_OPUS_MODEL = aiProviderConfig?.opusModel || OPENROUTER_MODEL_MAPPINGS.opus;
  } else {
    // Default Anthropic provider (Claude subscription via Claude Code OAuth).
    //
    // Important: We must NOT reuse external provider keys as `ANTHROPIC_API_KEY`.
    delete env.ANTHROPIC_BASE_URL;
    delete env.ANTHROPIC_AUTH_TOKEN;  // Clear any conflicting auth token
    // Always prefer OAuth for Anthropic mode in this project.
    // (If you want to run Claude Code with an Anthropic API key, set it explicitly in the
    // environment and adjust this behavior.)
    delete env.ANTHROPIC_API_KEY;

    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
      env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
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
    aiProvider,
    timeout = 300000,
    dangerMode = true
  } = options;

  return new Promise((resolve, reject) => {
    const env = configureProviderEnv(provider, aiProvider);

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
