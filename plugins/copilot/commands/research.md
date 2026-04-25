---
description: Investigate a topic using GitHub search + web (Copilot /research)
argument-hint: "[--model <model>] <what to research>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:copilot-researcher` subagent. Copilot runs `/research` for GitHub + web investigation and returns a summary.

Raw user request:
$ARGUMENTS

- Default foreground.
- Pass `--model` through.
- If the user asks no question, prompt for one.

Return the subagent's output verbatim.
