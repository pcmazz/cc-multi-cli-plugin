---
description: Delegate bulk or multi-file code writing to Cursor (Agent mode)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <what to write>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `cc-multi-cli-plugin:cursor-writer` subagent. Cursor writes code in Agent mode with full tool access.

Raw user request:
$ARGUMENTS

- Default foreground for small changes; background for multi-file refactors.
- Pass `--model` / `--resume` through.
- If no request, ask what Cursor should write.

Return Cursor's output verbatim.
