---
description: Fast codebase exploration with Gemini 3 Flash (large-context code ingestion, read-only)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <what to explore>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch the user's exploration request to the `multi:gemini-explorer` subagent via the `Agent` tool. Gemini 3 Flash uses its 1M-token context to quickly ingest large amounts of source code, trace structure, and answer questions about unfamiliar codebases — a fast, read-only orientation pass.

Raw user request:
$ARGUMENTS

- Default foreground. Honor `--background` if the request looks long (>5 min).
- Default model is `gemini-3-flash-preview`. Pass `--model` through if the user overrides.
- Pass `--resume`/`--fresh` through.
- This is a read-only exploration mode. Gemini will NOT modify files.
- If the request has no prompt, ask what to explore.

Return Gemini's output verbatim.
