1. The codebase should be focused, clean, and easy to understand.

2. DO NOT create a new document. Purge unnecessary code and files.

3. Only use UV to install dependencies and run the python application.

4. Single Source of Truth: DO NOT place many variables in .env file. Place them in the code instead.

5. Run and Debug yourself PROACTIVELY.

6. Bun Lockfile Compatibility:
   - Local Bun version may differ from Docker's `oven/bun:1-alpine`
   - Do NOT use `--frozen-lockfile` in Dockerfile - version mismatches cause CI failures
   - Use `bun install --production --ignore-scripts --no-save` in production stage
   - Only copy `package.json` (not lockfile) to production stage

7. Lint Before Commit:
   - Always run `bun run lint` before committing
   - Remove unused imports/variables when refactoring
   - The pre-commit hook runs lint+build automatically

8. Adding New Bot Commands:
   - Create handler method in appropriate `*Handlers.ts` file
   - Add delegation in `BotHandlers.ts`
   - Register command regex in `src/index.ts` with `bot.onText()`
   - For callbacks: add handler in `CallbackQueryHandler.ts` handlers map

9. Deploy Workflow:
   - `gh workflow run deploy.yml` triggers deployment
   - `gh run watch` monitors the running workflow

10. Claude Review Workflow Triggers:
    - Add label `claude-review` to PR, OR
    - Comment `@claude` on the PR
    - Claude will review and can make changes with write permissions

