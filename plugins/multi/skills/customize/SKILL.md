---
name: customize
description: Rewire which CLI handles which role in cc-multi-cli-plugin. Use when the user asks to swap CLIs, change a subagent's target CLI, add or disable a subagent, restrict a CLI, or modify a role's prompt template. Trigger phrases include "swap Gemini and Cursor", "make Copilot the writer", "disable cursor-debugger", "restrict Codex to read-only", "change which CLI handles debugging", "add /gemini:review", "only install the plugins I need".
---

# Customize cc-multi-cli-plugin

cc-multi-cli-plugin is a **multi-plugin marketplace** with one hub plugin (`multi`) and four CLI-specific thin plugins (`gemini`, `codex`, `cursor`, `copilot`). Customization is explicit file edits across those plugins. No runtime config layer.

## Step 0 — Locate the plugin repo (BEFORE any edits)

Before editing anything, determine WHICH files to edit. Three scenarios:

1. **Check `claude plugin marketplace list`** — find the `installLocation` for `cc-multi-cli-plugin`.
2. **Classify the install:**
   - If `installLocation` is a local directory the user controls (e.g., `~/dev/cc-multi-cli-plugin`, `C:\Users\<name>\skill-gemini`, a git clone they own) — **edit those files directly.** Changes are live.
   - If `installLocation` is under `~/.claude/plugins/marketplaces/cc-multi-cli-plugin/` and sourced from a GitHub repo the user does NOT own — **edits there will be overwritten** on the next `claude plugin marketplace update`. STOP and tell the user they need to fork the repo, clone their fork, and re-register that clone as the marketplace source. Then proceed with their clone.
3. **Ask the user** if you can't tell which scenario applies, or if you need a path to their local clone.

Record the path you'll edit as `$REPO`. All subsequent file paths in this skill are relative to `$REPO`.

## Step 0.5 — Verify CLI-specific strings BEFORE hardcoding them

Before hardcoding any CLI-specific string (model IDs, effort levels, sandbox modes, flag names, slash commands) as a default, verify it. Do not ask the user to confirm these — Claude can look them up faster and more reliably than the user can recall them.

**Preview-suffix trap:** Many CLIs accept IDs with a version-qualifier suffix. Gemini's current models are `gemini-3.1-pro-preview` and `gemini-3-flash-preview` — not `gemini-3.1-pro` or `gemini-3-flash`. The unsuffixed IDs 404 at runtime. This is the #1 reason to verify rather than type what "should" work.

**Run these in parallel** — they are independent and cross-check each other:

### 1. Ask the CLI directly (highest signal — ground truth)

The binary on the user's machine is authoritative for "will it work right now." If the CLI has a listing subcommand, use it:

- `codex --help`
- `cursor-agent models` (or `"<path>/agent.cmd" models` on Windows)
- `copilot --help | grep -i model`

Most CLIs (including Gemini) have no `models list` subcommand. Prompt them instead:

```bash
gemini -p "List the exact model ID strings this CLI currently accepts for the -m flag. Reply with just the IDs, one per line."
```

Every AI CLI can answer a natural-language prompt about itself. This generalizes.

### 2. Read the CLI's source constants (canonical, version-pinned)

Most CLIs have a `config/models.ts`, `constants.py`, or similar where valid identifiers are listed as exported constants. These rarely move and are authoritative. Use exa with a targeted query:

```
"<cli-name> github models.ts model constants"
```

For Gemini specifically, the file is `google-gemini/gemini-cli/packages/core/src/config/models.ts`, which exports constants like `PREVIEW_GEMINI_MODEL = 'gemini-3-pro-preview'`.

### 3. Check vendor docs + release notes (for context the CLI won't tell you)

Use context7 (proactively — covers Gemini CLI, Cursor CLI, Copilot CLI, Codex) or exa for:

- Deprecation timelines and aliasing (Google shut down `gemini-3-pro-preview` on 2026-03-09 and aliases it to `gemini-3.1-pro-preview`)
- New modes or flags added recently
- Known breaking changes across versions

The CLI will tell you what it accepts; docs will tell you what you should use.

### Resolving disagreements

If the three sources disagree:
- **CLI wins** for "will it work right now."
- **Docs win** for "should I use this" (e.g., avoid a deprecated ID even if the CLI still accepts it).

### Also check for CLI-specific facts

- **Available slash commands and modes** — vary by CLI and by CLI version, and new ones land regularly. Do NOT guess or rely on memory. Verify via the three-source check above (CLI self-prompt + source constants + vendor docs). Each CLI has its own set — Cursor has a Debug mode that other CLIs don't; Copilot has many slash commands beyond the obvious ones; Gemini's modes differ again. Enumerate what actually exists before referencing one.
- **Runtime flags** (sandbox modes, effort levels, read-only toggles) — check `--help` for exact spelling.
- **Windows quirks** (`.cmd` shims, shell requirements, PATH differences).
- **`plugins/multi/scripts/lib/adapters/<cli>.mjs`** is the source of truth for what flags our companion forwards.

**Record findings inline in your response** (so the user can double-check), then proceed to file edits without asking for confirmation on verifiable facts.

## Safety first

Before any edits, suggest the user commit the current state so changes are easy to revert:

```bash
cd $REPO && git status && git add -A && git commit -m "checkpoint before customization"
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

## Current inventory (what ships with v2.0.0)

**Subagents** (in `plugins/multi/agents/`):
- `gemini-researcher` — read-only research via Gemini ACP
- `codex-execute` — plan execution via Codex ASP
- `cursor-writer` — bulk code writing via Cursor Agent mode
- `cursor-planner` — approach design via Cursor Plan mode
- `cursor-debugger` — hypothesis-driven debug via Cursor Debug mode
- `copilot-researcher` — Copilot `/research` (GitHub + web)
- `copilot-reviewer` — Copilot `/review` code review agent

**Commands** (mapped to subagents via `multi:<name>`):
- `plugins/gemini/commands/research.md` → `multi:gemini-researcher`
- `plugins/codex/commands/execute.md` → `multi:codex-execute`
- `plugins/cursor/commands/{write,plan,debug}.md` → `multi:cursor-{writer,planner,debugger}`
- `plugins/copilot/commands/{research,review}.md` → `multi:copilot-{researcher,reviewer}`
- `plugins/multi/commands/setup.md` → `/multi:setup` (direct, not a subagent)

When creating new subagents or commands, copy from one of these as a template.

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

### 6. Hardcode a default model (or other CLI flag) for a subagent

Subagent Bash invocations pass `--model` through from the user's request. To bake in a *default* model that applies when the user doesn't specify one, edit the subagent's Bash line to include `--model <name>` unconditionally, and update the forwarding rules to note that user overrides win.

**Example — make `/gemini:research` default to `gemini-3.1-pro-preview`:**

(Step 0.5 told you to verify the model ID. For Gemini 3.x models, the IDs carry a `-preview` suffix — `gemini-3.1-pro-preview`, NOT `gemini-3.1-pro`. Forgetting this suffix is the most common way to ship a broken subagent.)

Edit `plugins/multi/agents/gemini-researcher.md`. Change the forwarding rules block from:

```markdown
- Use exactly one `Bash` call to invoke:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli gemini --role researcher --read-only ...`
- Pass `--model`, `--resume`, `--fresh` as runtime controls.
```

to:

```markdown
- Use exactly one `Bash` call to invoke:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli gemini --role researcher --read-only --model gemini-3.1-pro-preview ...`
- If the user's request explicitly specifies a different `--model`, use that value instead of `gemini-3.1-pro-preview`.
- Pass `--resume`, `--fresh` as runtime controls.
```

Key points:
- The hardcoded `--model gemini-3.1-pro-preview` sits alongside the other fixed flags like `--read-only`.
- The "user override" rule in prose form lets the subagent Claude know to swap in a user-supplied model when one is explicitly passed.
- The same pattern works for `--effort`, `--sandbox`, or any other CLI flag — just be explicit about whether the user can override.

**After this edit:** reinstall `multi` and restart Claude Code (subagent change = restart required, per the refresh table above).

### 7. Change a role's prompt template (slash-command prefix sent to the CLI)

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

## Verify after edits — YOU (Claude) run the refresh, not the user

Different edit types require different refresh steps. **You execute the refresh commands yourself via Bash** — do not hand the install commands to the user to type. The only thing you can't do is restart Claude Code itself; flag that explicitly when it's needed.

**Always run first:**

```bash
claude plugin validate $REPO
```

This catches JSON/schema errors before any reinstall. If it fails, fix the errors and re-run before proceeding.

**Then refresh based on what you touched:**

| What you edited | What you run via Bash | User action required? |
|---|---|---|
| Command file (`plugins/<cli>/commands/*.md`) | `claude plugin install <cli>@cc-multi-cli-plugin --force` | None — command changes are live after reinstall |
| Subagent (`plugins/multi/agents/*.md`) | `claude plugin install multi@cc-multi-cli-plugin --force` | **Yes — user must restart Claude Code.** Subagent definitions are cached at session start; reinstall alone doesn't reload them. |
| Adapter / companion script (`plugins/multi/scripts/...`) | Nothing — the companion respawns on each invocation | None |
| New plugin added to `marketplace.json` | `claude plugin marketplace update cc-multi-cli-plugin` then `claude plugin install <new-plugin>@cc-multi-cli-plugin` | None for the new plugin itself; but if the new plugin has subagents, restart IS required |
| `plugins/multi/hooks/hooks.json` | `claude plugin install multi@cc-multi-cli-plugin --force` | **Yes — restart** |

**Workflow Claude follows end-to-end:**

1. Research the CLI strings (Step 0.5), locate `$REPO` (Step 0), offer a safety checkpoint commit.
2. Make file edits.
3. Run `claude plugin validate $REPO` via Bash.
4. Run the relevant `claude plugin install ... --force` commands via Bash (one per affected plugin).
5. Commit the changes via Bash (`cd $REPO && git add -A && git commit -m "customize: <summary>"`).
6. Tell the user what you did. If any subagent files changed or hooks changed, end with a clear restart prompt: *"The changes include subagent edits, so please restart Claude Code to pick them up. After restart, try `/<cli>:<command> <test prompt>` to verify."* Otherwise, give them a test command they can run right now without a restart.

Claude restart itself is the ONE thing you can't do — don't pretend you can. But reinstalling, validating, and committing are all yours.

## Example walk-through: swap Gemini and Cursor roles (Claude runs everything)

User says: *"Make Gemini the bulk writer and Cursor the researcher."*

Claude:

1. **Locate the repo.** Run `claude plugin marketplace list` via Bash → find `cc-multi-cli-plugin` `installLocation`. Confirm it's editable (scenario 1 or 3 from Step 0).
2. **Verify CLI strings (Step 0.5).** If the user mentioned specific models/modes (they didn't in this example), look them up. Skip if no specifics.
3. **Safety checkpoint** via Bash: `cd $REPO && git status && git add -A && git commit -m "checkpoint before customization"` (if working tree had uncommitted changes).
4. **Edit subagents** in `plugins/multi/agents/`:
   - Create `gemini-writer.md` (copy from `cursor-writer.md`, update `name:`, description, and `Bash` invocation to `--cli gemini --role writer`).
   - Create `cursor-researcher.md` (copy from `gemini-researcher.md`, similar changes).
5. **Edit commands:**
   - Create `plugins/gemini/commands/write.md` (copy from `plugins/cursor/commands/write.md`, change `subagent_type` to `multi:gemini-writer`).
   - Create `plugins/cursor/commands/research.md` (copy from `plugins/gemini/commands/research.md`, change `subagent_type` to `multi:cursor-researcher`).
6. **Optional cleanup:** delete or `_disabled-`-rename the originals.
7. **Validate** via Bash: `claude plugin validate $REPO` — must pass.
8. **Reinstall affected plugins** via Bash (one command at a time so errors are attributable):
   - `claude plugin install gemini@cc-multi-cli-plugin --force`
   - `claude plugin install cursor@cc-multi-cli-plugin --force`
   - `claude plugin install multi@cc-multi-cli-plugin --force`  *(subagents live here)*
9. **Commit** via Bash: `cd $REPO && git add -A && git commit -m "customize: swap gemini/cursor writer/researcher roles"`
10. **Report to user.** Because this change touched subagent files (step 4), the user must restart Claude Code. End with exactly this kind of prompt:

    > Done. I've swapped the roles, reinstalled gemini / cursor / multi, and committed the change. **Please restart Claude Code** — subagent definitions are session-cached, and I can't trigger the restart myself. After restart, run `/gemini:write create /tmp/hello.py that prints "hi"` to verify.

If the change had ONLY touched command files (no subagents), skip the restart message entirely and tell the user they can run the test right now.
