---
name: customize
description: Rewire which CLI handles which role in cc-multi-cli-plugin. Use when the user asks to swap CLIs, change a subagent's target CLI, add or disable a subagent, restrict a CLI, or modify a role's prompt template. Trigger phrases include "swap Gemini and Cursor", "make Copilot the writer", "disable cursor-debugger", "restrict Codex to read-only", "change which CLI handles debugging", "add /gemini:review", "only install the plugins I need".
---

# Customize cc-multi-cli-plugin

cc-multi-cli-plugin is a **multi-plugin marketplace** with one hub plugin (`multi`) and four CLI-specific thin plugins (`gemini`, `codex`, `cursor`, `copilot`). Customization is explicit file edits across those plugins. No runtime config layer.

## Safety first

Before any edits, suggest the user commit the current state so changes are easy to revert:

```bash
cd <path to marketplace repo> && git status && git add -A && git commit -m "checkpoint before customization"
```

## Marketplace file layout recap

```
<marketplace>/
├── .claude-plugin/marketplace.json       # lists all plugins
└── plugins/
    ├── multi/                            # hub: owns everything shared
    │   ├── agents/<cli>-<role>.md        # subagents (forwarders to the companion)
    │   ├── commands/setup.md             # /multi:setup
    │   ├── scripts/                      # companion runtime + adapters + shared libs
    │   ├── skills/                       # this skill + multi-cli-anything
    │   └── hooks/hooks.json              # session lifecycle, review gate
    ├── gemini/commands/research.md       # /gemini:research → multi:gemini-researcher
    ├── codex/commands/execute.md         # /codex:execute → multi:codex-execute
    ├── cursor/commands/{write,plan,debug}.md
    └── copilot/commands/{research,review}.md
```

**Rules of thumb:**
- Slash commands live in the CLI-specific plugin whose namespace they want (`/gemini:...` → `plugins/gemini/commands/`).
- Subagents live in `plugins/multi/agents/` (so they can share the companion runtime).
- Commands dispatch to subagents via the `Agent` tool with `subagent_type: "multi:<name>"`.

## Change types

### 1. Swap a role between CLIs (e.g., make Gemini the bulk writer instead of Cursor)

- **Add** `plugins/gemini/commands/write.md` (copy from `plugins/cursor/commands/write.md`). Change its body to dispatch to `multi:gemini-writer`.
- **Add** `plugins/multi/agents/gemini-writer.md` (copy from `plugins/multi/agents/cursor-writer.md`). Change the name to `gemini-writer`, description, and the `Bash` invocation to `--cli gemini --role writer`.
- Optionally **remove** `plugins/cursor/commands/write.md` and `plugins/multi/agents/cursor-writer.md` if Cursor should no longer write at all.
- Reinstall: `claude plugin install gemini@cc-multi-cli-plugin --force` (and `cursor@...` / `multi@...` if you touched those).

Result: typing `/gemini:write` delegates to Gemini. `/cursor:write` is gone (or still exists if you left it).

### 2. Add a net-new command for an existing CLI (e.g., `/gemini:review`)

- **Add** `plugins/gemini/commands/review.md` — dispatches to `multi:gemini-reviewer`.
- **Add** `plugins/multi/agents/gemini-reviewer.md` — thin forwarder using `--cli gemini --role reviewer`.
- If the role (`reviewer` here) is a new one Gemini doesn't already have a prompt prefix for, update `plugins/multi/scripts/lib/adapters/gemini.mjs`'s `buildPrompt()` to map `reviewer` to whatever slash command Gemini uses (e.g., empty string if it's default mode).
- Reinstall: `claude plugin install gemini@... --force` and `multi@... --force`.

### 3. Disable a command or subagent

**Command (user-facing slash):**
- Delete `plugins/<cli>/commands/<action>.md` (git history preserves it).
- OR rename to `_disabled-<action>.md` (Claude Code won't load files starting with underscore).

**Subagent (Claude's auto-dispatch target):**
- Same approach — delete or rename with underscore prefix in `plugins/multi/agents/`.

Reinstall the affected plugin(s) after edits.

### 4. "I only have 2 of the 4 CLI subscriptions" — don't install the others

Simplest customization: just don't install the plugins you don't need.

- `claude plugin uninstall cursor@cc-multi-cli-plugin`
- `claude plugin uninstall copilot@cc-multi-cli-plugin`

The `multi` plugin + the CLI plugins you do want stay installed. No file editing. If later you add a subscription, `claude plugin install <cli>@cc-multi-cli-plugin`.

### 5. Restrict a CLI's behavior (e.g., make Gemini strictly read-only)

Edit `plugins/multi/agents/<cli>-<role>.md`:
- Frontmatter `tools:` — narrow to `Bash(echo:*)` or similar to prevent broader tool use.
- Body: ensure the `Bash` invocation includes `--read-only` (or the adapter's equivalent flag).

Many CLIs have their own sandbox/mode flags — consult `plugins/multi/scripts/lib/adapters/<cli>.mjs` for what the adapter understands.

### 6. Change a role's prompt template (slash-command prefix sent to the CLI)

Role-specific prompt prefixes live in each adapter's `buildPrompt()` function. Example in `plugins/multi/scripts/lib/adapters/cursor.mjs`:

```js
function buildPrompt(role, userTask) {
  const prefix = { planner: "/plan ", debugger: "/debug ", ask: "/ask " }[role] ?? "";
  return prefix + userTask;
}
```

Edit the mapping to change how a role's prompt gets prefixed. Only touch this function — other edits to adapter code risk breaking the transport layer.

## What NOT to touch (unless adding a new transport)

- `plugins/multi/scripts/lib/job-control.mjs`, `state.mjs`, `render.mjs`, `workspace.mjs`, `tracked-jobs.mjs`
- `plugins/multi/scripts/lib/acp-client.mjs`, `app-server.mjs`, `acp-diagnostics.mjs`
- `plugins/multi/scripts/multi-cli-companion.mjs` (unless adding a new adapter — see the `multi-cli-anything` skill)
- `plugins/multi/hooks/hooks.json` (unless adding a new hook)

## Verify after edits

Reinstall the affected plugin(s):

```bash
claude plugin install <plugin>@cc-multi-cli-plugin --force
```

Then run the affected command (e.g., `/gemini:write foo` if you swapped Gemini into the writer role). If output is coherent, the rewire worked.

Claude Code reads subagent definitions on startup. A simple `/plugin install --force` won't pick up new subagent files without restart. If auto-dispatch doesn't work after edits, restart Claude Code.

## Example walk-through: swap Gemini and Cursor roles

User says: *"Make Gemini the bulk writer and Cursor the researcher."*

1. Create `plugins/multi/agents/gemini-writer.md` (copy from `cursor-writer.md`, update `name`, description, and `--cli gemini --role writer`).
2. Create `plugins/multi/agents/cursor-researcher.md` (copy from `gemini-researcher.md`, update similarly).
3. Create `plugins/gemini/commands/write.md` (copy from `plugins/cursor/commands/write.md`, change dispatch target to `multi:gemini-writer`).
4. Create `plugins/cursor/commands/research.md` (copy from `plugins/gemini/commands/research.md`, change dispatch target to `multi:cursor-researcher`).
5. (Optional) Delete or `_disabled-`-rename the old `plugins/cursor/commands/write.md`, `plugins/gemini/commands/research.md`, and the matching subagents.
6. Commit, then `claude plugin install gemini@... --force && claude plugin install cursor@... --force && claude plugin install multi@... --force`.
7. Restart Claude Code.
8. Verify `/gemini:write create /tmp/hello.py ...` and `/cursor:research latest React patterns ...` both work.
