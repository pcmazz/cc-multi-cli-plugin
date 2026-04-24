---
description: Deep research and codebase exploration with Gemini (read-only)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <what to research>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch the user's research request to the `cc-multi-cli-plugin:gemini-researcher` subagent via the `Agent` tool. Gemini uses its 1M-token context and tool access to investigate codebase or external topics and returns a structured summary.

Raw user request:
$ARGUMENTS

- Default foreground. Honor `--background` if the request looks long (>5 min).
- Pass `--model` and `--resume`/`--fresh` through.
- This is a read-only research mode. Gemini will NOT modify files.
- If the request has no prompt, ask what to research.

Return Gemini's output verbatim.
