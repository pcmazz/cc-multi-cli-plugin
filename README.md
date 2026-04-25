# cc-multi-cli-plugin

If you have access to multiple AI coding CLIs (Codex, Gemini, Cursor, Copilot, etc.), this plugin lets Claude Code delegate to whichever one is best for the task — without you having to switch tools or run them yourself.

Each CLI is wired up through its native protocol (ACP, ASP, JSON-RPC), not screen-scraped. Sessions, streaming, tool calls, and background jobs all work normally.

## Install

Paste into Claude Code:

```
/plugin marketplace add https://github.com/greenpolo/cc-multi-cli-plugin
/plugin install multi@cc-multi-cli-plugin
/multi:setup
```

`/multi:setup` detects which CLIs you have, installs the matching sub-plugins, and wires Exa + Context7 MCPs into each.

## Commands

| | |
|---|---|
| `/gemini:research` | Deep research with Gemini's 1M-token context |
| `/gemini:explore` | Fast codebase exploration (Gemini 3 Flash) |
| `/codex:execute` | Hand a plan step to Codex |
| `/cursor:write` | Bulk code writing |
| `/cursor:plan` | Design an approach before coding |
| `/cursor:debug` | Hypothesis-driven debugging |
| `/copilot:research` | GitHub + web investigation |
| `/copilot:review` | GitHub-context code review |
| `/copilot:plan` | Copilot's plan mode |

Claude can also auto-dispatch to these without you typing the command.

## Customize

Two skills ship with the plugin:

- **customize** — change which CLI handles what. *"Make Gemini the writer instead of Cursor."* Claude does the file edits, reinstalls, and tells you what restarts are needed.
- **multi-cli-anything** — add a new CLI (Qwen, Aider, OpenCode, anything that speaks ACP). Claude scaffolds the new plugin in the marketplace.

Just ask Claude in plain English. The skills activate automatically.

## License

Apache 2.0. See [NOTICE](NOTICE) for upstream credits.
