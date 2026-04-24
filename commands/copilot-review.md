---
description: Code review by the Copilot /review agent (GitHub-context-aware)
argument-hint: "[--model <model>] [focus notes]"
allowed-tools: Bash(node:*), AskUserQuestion
---

Directly invoke the companion runtime. Review output lands inline in the main context.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli copilot --role reviewer $ARGUMENTS
```

Return the companion output verbatim.
