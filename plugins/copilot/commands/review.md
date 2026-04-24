---
description: Code review by the Copilot /review agent (GitHub-context-aware)
argument-hint: "[--model <model>] [focus notes]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:copilot-reviewer` subagent. Copilot runs its code review agent with GitHub context.

Raw user request:
$ARGUMENTS

- Default foreground. Reviews typically take 30s–2min.
- Pass `--model` through.

Return the subagent's output verbatim.
