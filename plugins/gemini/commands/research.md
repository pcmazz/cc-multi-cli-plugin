---
description: Deep external research with Gemini 3.1 Pro (web search + Context7 + synthesis, read-only)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <what to research>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch the user's research request to the `multi:gemini-researcher` subagent via the `Agent` tool. Gemini 3.1 Pro uses web search (Exa), Context7 documentation lookups, and its large-context reasoning to synthesize outside information into informed design choices.

Raw user request:
$ARGUMENTS

- Default foreground. Honor `--background` if the request looks long (>5 min).
- Default model is `gemini-3.1-pro-preview`. Pass `--model` through if the user overrides.
- Pass `--resume`/`--fresh` through.
- This is a read-only research mode. Gemini will NOT modify files.
- If the request has no prompt, ask what to research.

Return Gemini's output verbatim.
