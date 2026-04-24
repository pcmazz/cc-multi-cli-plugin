---
description: Investigate a topic using GitHub search + web (Copilot /research)
argument-hint: "[--model <model>] <what to research>"
allowed-tools: Bash(node:*), AskUserQuestion
---

Directly invoke the companion runtime. Output lands inline in the main context.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli copilot --role researcher $ARGUMENTS
```

Return the companion output verbatim. If the user asks no question, prompt for one.
