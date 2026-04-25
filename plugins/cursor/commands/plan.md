---
description: Ask Cursor to design an approach (Plan mode)
argument-hint: "[--model <model>] <what to plan>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:cursor-planner` subagent. Cursor runs in Plan mode (read-only) and returns the proposed approach.

Raw user request:
$ARGUMENTS

- Default foreground. Planning is usually quick.
- Pass `--model` through.
- If the request has no prompt, ask what to plan.

Return the subagent's output verbatim.
