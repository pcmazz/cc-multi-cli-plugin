---
description: Delegate coding tasks to Qwen Code (Qwen3-Coder, agent mode)
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <model>] <what to write>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:qwen-writer` subagent. Qwen Code writes and edits code in agent mode using the Qwen3-Coder model family.

Raw user request:
$ARGUMENTS

- Default foreground for small changes; background for multi-file refactors.
- Pass `--model` / `--resume` through.
- If no request, ask what Qwen should write.

Return Qwen's output verbatim.
