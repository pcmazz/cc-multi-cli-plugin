---
name: customize
description: Rewire which CLI handles which role in cc-multi-cli-plugin. Use when the user asks to swap CLIs, change a subagent's target CLI, add or disable a subagent, restrict a CLI, or modify a role's prompt template. Trigger phrases: "swap Gemini and Cursor", "make Copilot the writer", "disable cursor-debugger", "restrict Codex to read-only", "change which CLI handles debugging".
---

# Customize cc-multi-cli-plugin

This skill guides you through editing the plugin's own markdown files to rewire role assignments. The plugin has no runtime config — customization is explicit file edits.

## Safety first

Before any edits, suggest the user commit the current plugin state so changes are easy to revert:

```bash
cd <path to plugin> && git status && git add -A && git commit -m "checkpoint before customization"
```

## File layout recap

- `commands/<cli>-<action>.md` — slash commands. Each invokes either a subagent (via `Agent` tool) or the companion runtime directly (via `Bash`).
- `agents/<name>.md` — subagent definitions. Thin forwarders to the companion runtime. Frontmatter has `name`, `description`, `model`, `tools`.
- `scripts/lib/adapters/<cli>.mjs` — CLI-specific adapter code. Usually NOT touched for customization — only for adding new CLIs (see the `multi-cli-anything` skill).
- `scripts/multi-cli-companion.mjs` — dispatch routing. The `executeTaskRun` function branches on `cli === "<name>"`. Usually NOT touched for role customization.

## Change types

### 1. Swap a role between CLIs (e.g., make Gemini the bulk writer instead of Cursor)

Edit two files:

- `commands/<old-cli>-<action>.md` — change the subagent reference (the `Agent` dispatch target) to the new CLI's subagent. If no subagent exists for the new CLI/role combo, create one (see #2).
- `agents/<subagent>.md` — update the `description` to reflect the new CLI's strengths, and update the `Bash` command inside the body to use `--cli <new-cli>` instead of the old one.

The `--role <role>` argument stays the same since roles are transport-agnostic prompt prefixes handled by each adapter.

### 2. Add a new subagent for an existing CLI (e.g., add `gemini-writer`)

Copy an existing subagent:

```bash
cp agents/gemini-researcher.md agents/<new-name>.md
```

Edit the copy:
- `name:` → unique name (e.g., `gemini-writer`)
- `description:` → sharp description of when Claude should dispatch this (sharper = better auto-dispatch)
- Body's `Bash` command: adjust `--role <role>` to match the new role

If the new subagent needs its own prompt prefix (e.g., a new role name), update the target adapter's `buildPrompt()` function to include the mapping. That's a minor code edit in `scripts/lib/adapters/<cli>.mjs`.

### 3. Disable a subagent

Two options:
- Delete `agents/<name>.md` entirely (git history preserves it).
- OR rename it to `agents/_disabled-<name>.md` (underscore prefix; file stays in git for reference but Claude Code won't load it).

Reinstall the plugin afterward for changes to take effect: `/plugin install --path <plugin> --force`.

### 4. Restrict a CLI's behavior (e.g., make Gemini strictly read-only)

Edit the relevant subagent's `agents/<name>.md`:
- Frontmatter `tools:` — narrow to `Bash(echo:*)` or similar if you want to prevent broader tool use.
- Body: ensure the `Bash` invocation includes `--read-only` (or equivalent flag for that CLI's adapter).

Many CLIs have their own sandbox/mode flags — consult `scripts/lib/adapters/<cli>.mjs` for what the adapter understands.

### 5. Change a role's prompt template

Role-specific prompt prefixes live in each adapter's `buildPrompt()` function. For example, `scripts/lib/adapters/cursor.mjs` has:

```js
function buildPrompt(role, userTask) {
  const prefix = { planner: "/plan ", debugger: "/debug ", ask: "/ask " }[role] ?? "";
  return prefix + userTask;
}
```

Edit the mapping there to change how a role's prompt gets prefixed. Only touch this function — other edits to adapter code risk breaking the transport layer.

## What NOT to touch

These files are infrastructure — edit them only for adding new CLIs (see the `multi-cli-anything` skill), not for customizing role assignments:

- `scripts/lib/job-control.mjs`, `state.mjs`, `render.mjs`, `workspace.mjs`
- `scripts/lib/app-server.mjs`, `acp-client.mjs`, `acp-diagnostics.mjs`, etc.
- The dispatch switch inside `scripts/multi-cli-companion.mjs`
- `hooks/hooks.json`

## Verify after edits

Reinstall the plugin:

```bash
/plugin install --path <plugin dir> --force
```

Then run the affected command (e.g., `/gemini:write foo` if you swapped Gemini into the writer role). If output is coherent, the rewire worked.

## Example: swap Gemini and Cursor roles

User says: *"Make Gemini the bulk writer and Cursor the researcher."*

1. Create `agents/gemini-writer.md` (copy from `cursor-writer.md`, update name, description, `--cli gemini --role writer`).
2. Create `agents/cursor-researcher.md` (copy from `gemini-researcher.md`, update name, description, `--cli cursor --role researcher`).
3. Edit `commands/cursor-write.md` → change `Agent(subagent_type: "cursor-writer")` to `Agent(subagent_type: "gemini-writer")`.
4. Edit `commands/gemini-research.md` → change to `cursor-researcher`.
5. Optionally delete the old `agents/cursor-writer.md` and `agents/gemini-researcher.md`, OR rename to `_disabled-*.md`.
6. Commit, reinstall, verify.
