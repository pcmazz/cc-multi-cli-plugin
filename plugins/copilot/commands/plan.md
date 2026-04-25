---
description: Ask Copilot to design an implementation plan (Copilot /plan Plan Mode)
argument-hint: "[--model <model>] <what to plan>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:copilot-planner` subagent. Copilot runs `/plan` (Plan Mode) to analyze the codebase and produce a step-by-step implementation strategy without writing code.

Raw user request:
$ARGUMENTS

- Default foreground. Planning is usually quick.
- Pass `--model` through.
- If the request has no prompt, ask what to plan.

Return the subagent's output verbatim.
