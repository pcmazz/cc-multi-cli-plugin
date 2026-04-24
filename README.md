# cc-multi-cli-plugin

A Claude Code plugin that lets Claude delegate work to **four external AI CLIs** — Codex, Gemini, Cursor, and GitHub Copilot — as first-class subagents and slash commands. Each CLI is reached via its native structured protocol (ASP, ACP, or JSON-RPC SDK), so sessions, streaming, tool calls, and background jobs all work.

> **v2.0.0** — This plugin replaces the former `skill-gemini`. See [CHANGELOG.md](CHANGELOG.md) for migration notes.

## Install in one paste

Paste this into Claude Code:

> Install `cc-multi-cli-plugin` from github.com/greenpolo/cc-multi-cli-plugin, then run `/multi:setup` to configure all four CLIs with Exa + Context7 MCPs.

Claude runs `/plugin marketplace add`, `/plugin install cc-multi-cli-plugin`, and `/multi:setup` for you.

## Manual install

```bash
/plugin marketplace add https://github.com/greenpolo/cc-multi-cli-plugin
/plugin install cc-multi-cli-plugin
/multi:setup
```

## Commands

| Command | What it does |
|---|---|
| `/multi:setup` | Setup wizard — detects CLIs, configures MCPs |
| `/gemini:research` | Deep research with Gemini's 1M context |
| `/codex:execute` | Delegate a plan step to Codex |
| `/cursor:write` | Bulk code writing (Cursor Agent mode) |
| `/cursor:plan` | Design an approach (Cursor Plan mode) |
| `/cursor:debug` | Root-cause debugging (Cursor Debug mode) |
| `/copilot:research` | GitHub + web investigation (Copilot `/research`) |
| `/copilot:review` | Copilot code review agent |

Claude also auto-dispatches to four subagents when appropriate: `gemini-researcher`, `codex-execute`, `cursor-writer`, `cursor-debugger`.

## Customize

Ask Claude to customize which CLI handles which role. The plugin ships a `customize` skill that walks Claude through the file edits.

Example:
> Swap Gemini and Cursor roles — make Gemini the bulk writer and Cursor the researcher.

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for upstream attributions.
