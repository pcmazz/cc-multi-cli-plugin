---
description: Delegate a hard bug to Cursor's Debug mode (hypothesis-driven investigation)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <describe the bug>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `cc-multi-cli-plugin:cursor-debugger` subagent. Cursor enters Debug mode — generates hypotheses, adds log statements, uses runtime information to pinpoint the issue before making a targeted fix.

Raw user request:
$ARGUMENTS

- Default foreground for focused bugs; background for multi-run investigations.
- Pass `--model`, `--resume`, `--fresh` through.
- If no request, ask what to debug.

Return Cursor's output verbatim.
