# Agent Guidelines

## Core Principles (from CLAUDE.md)
1. DRY (Don't Repeat Yourself) - focused, clean, easy to understand code
2. DO NOT create new documents - purge unnecessary code and files
3. Single Source of Truth - avoid many .env variables, place in code instead
4. Run and Debug yourself PROACTIVELY
5. Always run `bun run lint` before committing

## Debugging Process
1. Think hard
2. Fix the code
3. Commit
4. Push
5. Deploy: `gh workflow run deploy.yml --ref "$(git rev-parse --abbrev-ref HEAD)"`

## What to Record When Debugging
- Problem statement (one sentence)
- Environment snapshot (branch, commit, runtime context)
- Reproduction steps (exact commands or inputs)
- Expected vs actual behavior
- Logs and paths referenced (avoid secrets)
- Root cause analysis
- Fix implemented (files + summary)
- Verification steps

## References
- Claude Agent SDK: https://github.com/anthropics/claude-agent-sdk-demos
- Claude Agent SDK (TypeScript): https://platform.claude.com/docs/en/agent-sdk/typescript
