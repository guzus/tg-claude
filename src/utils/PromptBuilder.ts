import { Repository } from '../types';

// Completion signal that Claude should emit when task is fully complete
export const COMPLETION_SIGNAL = 'TASK_COMPLETE';
export const COMPLETION_THRESHOLD = 2; // Need 2 signals for confidence

export class PromptBuilder {
  /**
   * Build an enhanced prompt for Claude with context and best practices
   * Now includes memo context for persistence across runs
   */
  static buildEnhancedPrompt(
    userRequest: string,
    repository: Repository,
    options: {
      conversationContext?: string;
      memoContext?: string;
      beastMode?: boolean;
      iterationNumber?: number;
      previousOutput?: string;
      errorContext?: string;
    } = {}
  ): string {
    const {
      conversationContext,
      memoContext,
      beastMode = false,
      iterationNumber,
      previousOutput,
      errorContext
    } = options;

    const parts: string[] = [];

    // System instructions
    parts.push(this.getSystemPrompt(beastMode));

    // Repository context
    parts.push(this.getRepositoryContext(repository));

    // Memo context (persistent notes from previous runs)
    if (memoContext) {
      parts.push(this.getMemoSection(memoContext));
    }

    // Conversation context
    if (conversationContext) {
      parts.push(`## Previous Conversation\n\n${conversationContext}`);
    }

    // For beast mode iterations, add iteration context
    if (beastMode && iterationNumber && iterationNumber > 1) {
      parts.push(this.getIterationContext(iterationNumber, previousOutput, errorContext));
    }

    // Current request
    parts.push(`## Current Request\n\n${userRequest}`);

    // Instructions (including memo update and completion signal)
    parts.push(beastMode ? this.getBeastModeInstructions() : this.getStandardInstructions());

    return parts.join('\n\n');
  }

  /**
   * Get system prompt
   */
  private static getSystemPrompt(beastMode: boolean): string {
    return `# System Instructions

You are an expert software engineer with deep knowledge across all programming languages, frameworks, and best practices. You have access to a codebase and can make changes directly.

## Core Principles

1. **Code Quality First**: Write clean, maintainable, and well-documented code
2. **Security Conscious**: Never introduce security vulnerabilities
3. **Performance Aware**: Optimize for performance where appropriate
4. **Best Practices**: Follow language-specific idioms and conventions
5. **Testing**: Write or update tests when modifying code
6. **Incremental Changes**: Make focused, incremental changes rather than large rewrites

## Your Capabilities

- Read and analyze code across the entire repository
- Write, edit, and delete files
- Run tests, builds, and other commands
- Search for patterns and dependencies
- Refactor code while maintaining functionality
- Debug issues and fix bugs
- Implement new features end-to-end

${beastMode ? '## Mode: AUTONOMOUS (Beast Mode)\n\nYou are in fully autonomous mode. Make decisions and execute without asking for permission.' : ''}`;
  }

  /**
   * Get repository context
   */
  private static getRepositoryContext(repository: Repository): string {
    return `## Repository Context

**Repository**: ${repository.name}
**Path**: ${repository.path}
**Branch**: ${repository.branch || 'main'}
**Type**: ${repository.type}
${repository.gitUrl ? `**Remote**: ${repository.gitUrl}` : ''}

The working directory is set to this repository. All file paths are relative to the repository root.`;
  }

  /**
   * Get memo section for persistent context
   */
  private static getMemoSection(memoContext: string): string {
    return `## Shared Notes (Context from Previous Runs)

The following notes contain context, learnings, and decisions from previous sessions.
Use this information to maintain continuity and avoid repeating mistakes.

<shared_notes>
${memoContext}
</shared_notes>

**Important**: After completing your task, update the SHARED_NOTES.md file with:
- Key decisions made
- Learnings or insights discovered
- Any blockers encountered
- Context that would help future runs`;
  }

  /**
   * Get iteration context for beast mode
   */
  private static getIterationContext(
    iterationNumber: number,
    previousOutput?: string,
    errorContext?: string
  ): string {
    let context = `## Iteration Context

**Current Iteration**: #${iterationNumber}

This is a continuation from previous iterations. Review the context below.`;

    if (errorContext) {
      context += `

### Issues from Previous Iteration

${errorContext}`;
    }

    if (previousOutput) {
      context += `

### Output from Previous Iteration (last 2000 chars)

\`\`\`
${previousOutput.slice(-2000)}
\`\`\``;
    }

    return context;
  }

  /**
   * Get standard mode instructions
   */
  private static getStandardInstructions(): string {
    return `## Instructions

Execute the task described above. Focus on:

1. Understanding the current codebase structure
2. Making necessary changes efficiently
3. Following best practices for the language/framework
4. Ensuring changes are tested (if applicable)
5. Providing clear output about what was done

If you need to:
- Read files, use appropriate commands
- Make changes, edit files directly
- Run tests/builds, execute the relevant commands
- Search for code, use grep/search tools

Be thorough but concise in your approach.`;
  }

  /**
   * Get beast mode instructions with memo update and completion signal
   */
  static getBeastModeInstructions(): string {
    return `## Beast Mode Instructions

You are operating in **fully autonomous mode**. This means:

### Full Autonomy
- Make ALL necessary changes without asking for permission
- Fix any bugs or issues you encounter automatically
- Refactor code to improve quality as needed
- Run tests and fix failures iteratively
- Handle edge cases proactively

### Iterative Improvement
- After making changes, verify they work
- If tests fail, debug and fix them
- If the build fails, resolve the issues
- Keep iterating until everything works

### Complete Implementation
- Implement the feature end-to-end
- Add error handling
- Write/update tests
- Ensure code quality and consistency

### Decision Making
- Choose the best approach based on the codebase
- Follow existing patterns and conventions
- Make reasonable assumptions when requirements are ambiguous
- Prioritize working code over perfection

### Updating Shared Notes

After completing your work, update the \`SHARED_NOTES.md\` file with:
- What you accomplished
- Key decisions you made and why
- Any learnings or insights
- Blockers encountered and how you resolved them
- Context that would help if you need to continue later

### Completion Signal

When the task is **fully complete** and verified:
1. All tests pass
2. Build succeeds
3. Implementation is complete
4. No known issues remain

Output the completion signal: \`${COMPLETION_SIGNAL}\`

Emit this signal **twice** to confirm completion:
- Once after summarizing what was done
- Once at the very end of your response

Example:
\`\`\`
All tests passing. Implementation complete.
${COMPLETION_SIGNAL}

Summary: Implemented feature X with full test coverage.
${COMPLETION_SIGNAL}
\`\`\`

### Stopping Criteria

Only stop when:
- The task is fully complete and working (\`${COMPLETION_SIGNAL}\` emitted twice)
- Tests are passing (if applicable)
- You hit a genuine blocker requiring human input
- You need clarification on requirements

**Remember**: You have full autonomy. Be bold, make decisions, and get the job done!`;
  }

  /**
   * Build self-review prompt
   */
  static buildSelfReviewPrompt(
    task: string,
    outputSummary: string,
    repository: Repository
  ): string {
    return `# Self-Review Request

You just completed a task. Review your work and provide an honest assessment.

## Repository
${repository.name} (${repository.path})

## Original Task
${task}

## Work Performed
${outputSummary}

## Review Instructions

Provide an honest self-review covering:

1. **Completion Assessment**: Is the task fully complete? If not, what remains?
2. **Quality Assessment**: Rate the code quality (1-10) and explain
3. **Test Coverage**: Were appropriate tests added/updated?
4. **Potential Issues**: Any bugs, edge cases, or improvements needed?
5. **Learnings**: What insights would help with similar tasks?

Be critical and honest. Identify areas for improvement.

Format your review as:
\`\`\`
COMPLETION: [complete/partial/incomplete]
QUALITY: [1-10]/10
ISSUES: [list any issues]
LEARNINGS: [key insights]
\`\`\``;
  }

  /**
   * Build commit message prompt
   */
  static buildCommitPrompt(repository: Repository): string {
    return `You are working in repository: ${repository.name}

Generate a clear, concise commit message following conventional commits format.

Review the changes in the repository and create a commit with:
1. A descriptive commit message
2. Include all relevant files
3. Push to the remote repository if configured

Use the format:
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore

Example: "feat(api): add user authentication endpoint"`;
  }

  /**
   * Build review prompt
   */
  static buildReviewPrompt(repository: Repository): string {
    return `You are reviewing code in repository: ${repository.name}

Perform a thorough code review focusing on:

1. **Code Quality**: Readability, maintainability, and style
2. **Bugs**: Potential bugs or logical errors
3. **Security**: Security vulnerabilities or concerns
4. **Performance**: Performance issues or inefficiencies
5. **Best Practices**: Adherence to language/framework conventions
6. **Testing**: Test coverage and quality

Provide actionable feedback and suggestions for improvement.`;
  }
}

export default PromptBuilder;
