import {
  HelpCircle,
  GitBranch,
  FileCode,
  MessageSquare,
  Repeat,
} from "lucide-react";

export interface SlashCommand {
  command: string;
  description: string;
  icon: React.ReactNode;
  category?: string;
  /** Whether this command is handled by the backend (true) or passed to Claude (false) */
  backendHandled?: boolean;
}

/**
 * Available slash commands in the chat interface
 * Commands with backendHandled=true are parsed by the backend
 * Commands with backendHandled=false are passed to Claude as prompts
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  // Help
  {
    command: "/help",
    description: "Show available commands and help",
    icon: <HelpCircle className="w-4 h-4" />,
  },

  // Git commands (passed to Claude)
  {
    command: "/commit",
    description: "Create a git commit with staged changes",
    icon: <GitBranch className="w-4 h-4" />,
    category: "Git",
  },
  {
    command: "/commit-push-pr",
    description: "Commit, push, and open a PR",
    icon: <GitBranch className="w-4 h-4" />,
    category: "Git",
  },
  {
    command: "/code-review",
    description: "Review a pull request",
    icon: <FileCode className="w-4 h-4" />,
    category: "Git",
  },
  {
    command: "/clean_gone",
    description: "Clean up deleted remote branches",
    icon: <GitBranch className="w-4 h-4" />,
    category: "Git",
  },

  // Tools - Backend handled
  {
    command: "/ralph-loop",
    description: "Start iterative development loop",
    icon: <Repeat className="w-4 h-4" />,
    category: "Tools",
    backendHandled: true,
  },
  {
    command: "/cancel-ralph",
    description: "Cancel active Ralph loop",
    icon: <Repeat className="w-4 h-4" />,
    category: "Tools",
  },

  // Tools - Claude handled
  {
    command: "/interview",
    description: "Interview to flesh out a plan/spec",
    icon: <MessageSquare className="w-4 h-4" />,
    category: "Tools",
  },
  {
    command: "/frontend-design",
    description: "Create production-grade frontend UI",
    icon: <FileCode className="w-4 h-4" />,
    category: "Tools",
  },
  {
    command: "/reduce-file-size",
    description: "Reduce file size of code",
    icon: <FileCode className="w-4 h-4" />,
    category: "Tools",
  },
];

/**
 * Filter commands based on user input
 */
export function filterCommands(input: string): SlashCommand[] {
  if (!input.startsWith("/")) return SLASH_COMMANDS;

  const prefix = input.split(" ")[0].toLowerCase();
  return SLASH_COMMANDS.filter((cmd) =>
    cmd.command.toLowerCase().startsWith(prefix)
  );
}

/**
 * Check if input is currently typing a slash command (no space yet)
 */
export function isTypingSlashCommand(input: string): boolean {
  return input.startsWith("/") && !input.includes(" ");
}
