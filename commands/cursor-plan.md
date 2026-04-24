---
description: Ask Cursor to design an approach (Plan mode). Output lands in main context.
argument-hint: "[--model <model>] <what to plan>"
allowed-tools: Bash(node:*), AskUserQuestion
---

Directly invoke the companion runtime — no subagent, output lands inline.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli cursor --role planner $ARGUMENTS
```

Return the companion output verbatim.
