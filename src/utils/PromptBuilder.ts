import { Repository } from '../types';

export class PromptBuilder {
  /**
   * Build an enhanced prompt for Claude with context and best practices
   * Based on Cursor Agent's approach to agentic coding
   */
  static buildEnhancedPrompt(
    userRequest: string,
    repository: Repository,
    conversationContext?: string
  ): string {
    const systemPrompt = this.getSystemPrompt();
    const repoContext = this.getRepositoryContext(repository);
    const conversationSection = conversationContext
      ? `## Previous Conversation\n\n${conversationContext}\n\n`
      : '';

    const prompt = `${systemPrompt}

${repoContext}

${conversationSection}## Current Request

${userRequest}

${this.getStandardInstructions()}`;

    return prompt;
  }

  /**
   * Get system prompt with best practices from Cursor
   */
  private static getSystemPrompt(): string {
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

## How to Approach Tasks

1. **Understand First**: Analyze the existing code structure before making changes
2. **Plan**: Think through the implementation approach
3. **Execute**: Make changes systematically
4. **Verify**: Test your changes when possible
5. **Document**: Add comments for complex logic`;
  }

  /**
   * Get repository context information
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
