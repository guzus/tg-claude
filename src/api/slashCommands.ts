/**
 * Slash command parsing and handling for the API
 */

export interface SlashCommandOptions {
  ralphLoop?: { completionPromise: string; maxIterations: number };
  // Add more command-specific options here as needed
}

export interface ParsedSlashCommand {
  command: string;
  prompt: string;
  options: SlashCommandOptions;
}

interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  parse: (args: string) => { prompt: string; options: SlashCommandOptions };
}

// Ralph loop command parser
function parseRalphLoop(args: string): { prompt: string; options: SlashCommandOptions } {
  let maxIterations = 20;
  let completionPromise = 'TASK COMPLETE';
  let taskPrompt = args;

  // Extract --max-iterations flag
  const maxIterMatch = args.match(/--max-iterations?\s+(\d+)/i);
  if (maxIterMatch) {
    maxIterations = Math.min(parseInt(maxIterMatch[1], 10), 100);
    taskPrompt = taskPrompt.replace(maxIterMatch[0], '').trim();
  }

  // Extract --promise flag
  const promiseMatch = args.match(/--(?:completion-)?promise\s+"([^"]+)"/i);
  if (promiseMatch) {
    completionPromise = promiseMatch[1];
    taskPrompt = taskPrompt.replace(promiseMatch[0], '').trim();
  }

  return {
    prompt: taskPrompt || 'Continue working on the current task',
    options: {
      ralphLoop: { completionPromise, maxIterations }
    }
  };
}

// Registry of supported slash commands
const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: 'ralph-loop',
    aliases: ['ralph'],
    description: 'Start an iterative development loop',
    parse: parseRalphLoop
  }
  // Add more commands here as needed
  // { name: 'commit', ... }
  // { name: 'code-review', ... }
];

/**
 * Parse a slash command from user input
 * Returns null if the input is not a slash command or not a recognized command
 */
export function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // Match command and arguments
  const match = trimmed.match(/^\/([a-z0-9_-]+)(?:\s+(.*))?$/i);
  if (!match) return null;

  const commandName = match[1].toLowerCase();
  const args = match[2]?.trim() || '';

  // Find matching command definition
  const commandDef = SLASH_COMMANDS.find(
    cmd => cmd.name === commandName || cmd.aliases?.includes(commandName)
  );

  if (!commandDef) {
    // Not a recognized slash command - return null to pass through to Claude
    return null;
  }

  const { prompt, options } = commandDef.parse(args);

  return {
    command: commandDef.name,
    prompt,
    options
  };
}

/**
 * Get list of available slash commands for API response
 */
export function getAvailableCommands(): Array<{ name: string; aliases?: string[]; description: string }> {
  return SLASH_COMMANDS.map(({ name, aliases, description }) => ({
    name,
    aliases,
    description
  }));
}
