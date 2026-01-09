# Agent Debugging Guide

## Purpose
Use this file to capture reproducible debugging steps, observations, and fixes for agent-related issues in this repo.

## What to Record
- Problem statement (one sentence).
- Environment snapshot (branch, commit, runtime context).
- Reproduction steps (exact commands or inputs).
- Expected vs actual behavior.
- Logs and paths referenced (avoid secrets).
- Root cause analysis.
- Fix implemented (files + summary).
- Verification steps.

## Defaults
- Keep entries short and actionable.
- Redact tokens, secrets, and user data.
- Prefer paths over long log dumps.

## Debugging Process
1. Think hard.
2. Fix the code.
3. Commit.
4. Push.
5. Trigger deploy using: `gh workflow run deploy.yml --ref "$(git rev-parse --abbrev-ref HEAD)" && gh run watch`

## Template
```
Title:
Date:
Branch/Commit:
Context:
Repro:
Expected:
Actual:
Logs:
Root Cause:
Fix:
Verification:
```
