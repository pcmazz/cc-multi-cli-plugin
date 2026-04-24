---
description: One-shot setup wizard — detects CLIs, configures Exa + Context7 MCPs on each
argument-hint: "[--dry-run]"
allowed-tools: Read, Edit, Write, Bash, AskUserQuestion
---

You are running the setup wizard for cc-multi-cli-plugin. Work through these steps in order, using your native tools. Do NOT invoke subagents. Do NOT run the plugin's companion scripts.

If the user passed `--dry-run` anywhere in $ARGUMENTS, enumerate changes but make NO writes.

## Step 1 — Detect installed CLIs

Run each version probe via Bash:

- `codex --version`
- `gemini --version`
- `cursor-agent --version` or `agent --version` (Cursor's CLI binary is `agent` — if not on PATH, check `~/.local/bin/agent` on Unix or `$LOCALAPPDATA/cursor-agent/agent.cmd` on Windows)
- `copilot --version`

Tabulate which succeed. For each failure, tell the user the install command:

- Codex: `npm install -g @openai/codex`
- Gemini: `npm install -g @google/gemini-cli`
- Cursor: `curl https://cursor.com/install -fsS | bash` (Unix) or `irm 'https://cursor.com/install?win32=true' | iex` (Windows PowerShell)
- Copilot: `npm install -g @github/copilot`

Continue only with the CLIs that are installed. Do not block on missing ones.

## Step 1.5 — Ensure the CLI-specific plugins are installed (idempotent)

For each detected CLI, check the current install state FIRST, then act:

1. **Check what's already installed** via Bash:
   ```bash
   claude plugin list 2>&1 | grep "@cc-multi-cli-plugin"
   ```
   This lists all plugins in the marketplace that are currently installed. Compare against the CLIs you detected in Step 1.

2. **For each detected CLI whose plugin is NOT yet installed**, and ONLY for those, use `AskUserQuestion` to ask whether to install it. Skip the prompt entirely if the plugin is already installed — don't ask the user about plugins they already have.

3. **Install only the plugins the user accepted:**
   - Gemini → `claude plugin install gemini@cc-multi-cli-plugin` (adds `/gemini:research`)
   - Codex → `claude plugin install codex@cc-multi-cli-plugin` (adds `/codex:execute`)
   - Cursor → `claude plugin install cursor@cc-multi-cli-plugin` (adds `/cursor:write`, `/cursor:plan`, `/cursor:debug`)
   - Copilot → `claude plugin install copilot@cc-multi-cli-plugin` (adds `/copilot:research`, `/copilot:review`)

4. **Report** at the end of Step 1.5:
   - `✓ <cli>: already installed` for plugins that were already there (no action taken)
   - `✓ <cli>: installed` for plugins the user accepted and just installed
   - `⚠ <cli>: skipped` for plugins the user declined
   - `✗ <cli>: install failed — <error>` for any failures (continue regardless)

**Why this matters:** `claude plugin install` is destructive — it re-fetches and overwrites the cache even for already-installed plugins. Running installs on things already present wastes time and can disrupt active development setups. Guarding with the initial check makes `/multi:setup` safely re-runnable.

## Step 2 — Verify auth

For each installed CLI, check auth:

- Codex: `codex whoami` or equivalent
- Gemini: `gemini --version` should run without prompting for login
- Cursor: `agent status`
- Copilot: `copilot status` or rely on `GH_TOKEN`/`COPILOT_GITHUB_TOKEN` env vars

If unauthenticated, give the exact login command and use `AskUserQuestion` to ask whether to pause for the user to log in or skip that CLI.

## Step 3 — Ask for API keys (Exa required, Context7 optional)

Check `~/.claude/plugins/cc-multi-cli-plugin/config.json` for stored keys. If both are already present, skip Step 3 entirely. Otherwise, ask only for what's missing.

**Each key prompt should use EXACTLY two options** — keep it simple, no confusing multi-choice trees:

- Option 1: **"Skip"**
- Option 2: **"Paste key below"** — user types/pastes the key as their response

### Exa API key (required for Exa MCP to function)

Ask via `AskUserQuestion`:
- **Header text:** "Exa API key (required). Get one free at https://dashboard.exa.ai. If you skip, the Exa MCP will be configured without a key and will fail at runtime."
- **Option 1:** "Skip — configure Exa without a key (server will fail until key is added)"
- **Option 2:** "Paste key below" (free-text input for the key)

### Context7 API key (optional)

Ask via `AskUserQuestion`:
- **Header text:** "Context7 API key (optional). Works without a key at free-tier rate limits. With a key (free at https://context7.com): higher rate limits + access to researchMode for deeper synthesis."
- **Option 1:** "Skip — use Context7 at free-tier limits"
- **Option 2:** "Paste key below" (free-text input for the key)

### Save

After collecting both answers, write `~/.claude/plugins/cc-multi-cli-plugin/config.json` with mode 0600:

```json
{
  "exaApiKey": "<key-or-empty-string>",
  "context7ApiKey": "<key-or-empty-string>"
}
```

Create the directory with `Bash` if it doesn't exist. Never echo either key back to the user after capture — just confirm "Saved." If the user skipped a key, store an empty string (Step 4's config-writing logic uses empty-string as the "skip env block" signal).

## Step 4 — Configure MCPs per CLI

For each installed, authenticated CLI, do the following:

1. **Locate the config file.**
   - Codex: `~/.codex/config.toml` (create if missing with `[mcp_servers]` section)
   - Gemini: `~/.gemini/settings.json` (create if missing as `{ "mcpServers": {} }`)
   - Cursor: `~/.cursor/mcp.json` (create if missing as `{ "mcpServers": {} }`)
   - Copilot: `~/.copilot/mcp-config.json` (create if missing as `{ "mcpServers": {} }`)

2. **Back up the existing file** as `<file>.bak` if it exists and no `.bak` already present.

3. **Merge the cc-multi-cli-plugin managed block** (see templates below).

4. **Codex — TOML**: Append the managed block, wrapped in comment markers. Include `CONTEXT7_API_KEY` in Context7's env ONLY if the user provided a Context7 key; otherwise omit the env line entirely (server still works at free-tier rate limits).

   **With Context7 key:**
   ```toml
   # BEGIN cc-multi-cli-plugin managed block — do not edit by hand
   [mcp_servers.exa]
   command = "npx"
   args = ["-y", "@exa/mcp-server-exa"]
   env = { EXA_API_KEY = "<EXA_KEY_FROM_CONFIG>" }

   [mcp_servers.context7]
   command = "npx"
   args = ["-y", "@upstash/context7-mcp"]
   env = { CONTEXT7_API_KEY = "<CONTEXT7_KEY_FROM_CONFIG>" }
   # END cc-multi-cli-plugin managed block
   ```

   **Without Context7 key:** drop the `env = { ... }` line from the Context7 block.

5. **Gemini / Cursor / Copilot — JSON**: Merge these two servers into `mcpServers`. Include a `_cc_multi_managed: true` marker key in each. Include Context7's `env` block ONLY if the user provided a key.

   **Exa** (always includes its env block — required):
   ```json
   "exa": {
     "command": "npx",
     "args": ["-y", "@exa/mcp-server-exa"],
     "env": { "EXA_API_KEY": "<EXA_KEY_FROM_CONFIG>" },
     "_cc_multi_managed": true
   }
   ```

   **Context7 with key:**
   ```json
   "context7": {
     "command": "npx",
     "args": ["-y", "@upstash/context7-mcp"],
     "env": { "CONTEXT7_API_KEY": "<CONTEXT7_KEY_FROM_CONFIG>" },
     "_cc_multi_managed": true
   }
   ```

   **Context7 without key** (omit the `env` object):
   ```json
   "context7": {
     "command": "npx",
     "args": ["-y", "@upstash/context7-mcp"],
     "_cc_multi_managed": true
   }
   ```

   If the user already has an `exa` or `context7` server under a different configuration, do NOT overwrite — instead, report the conflict and ask via `AskUserQuestion` whether to replace or keep theirs.

6. Use `Read` to pull the file, `Edit`/`Write` to apply changes. Preserve the user's other keys and structure.

## Step 5 — Verify

For each configured CLI, run a trivial MCP-reachability probe. The exact probe depends on the CLI:

- Gemini/Cursor/Copilot: run a short prompt that asks the CLI to invoke an Exa search (e.g., `copilot -p "Use the exa_search tool to search for 'test' and report what you found"` with a 60s timeout).
- Codex: `codex` has an MCP-list command — use it if available, else skip verification for Codex.

If verification fails, print the error but don't roll back. The user can inspect and fix.

## Step 6 — Report

Print a concise summary:

```
cc-multi-cli-plugin setup complete.
  ✓ Codex: configured (exa, context7)
  ✓ Gemini: configured (exa, context7)
  ⚠ Cursor: skipped — not authenticated (run `agent login`)
  ✗ Copilot: configuration failed — <error message>

Backed-up configs (restore by copying <file>.bak back):
  ~/.codex/config.toml.bak
  ~/.gemini/settings.json.bak
  ~/.cursor/mcp.json.bak
  ~/.copilot/mcp-config.json.bak

Next steps:
  - Try `/gemini:research <topic>` or any other plugin command.
  - Re-run `/multi:setup` anytime to reconfigure.
```

## Dry-run mode

If `--dry-run` was in `$ARGUMENTS`, skip steps 3–5's writes entirely. Instead, print what WOULD be changed in each file and exit.

## Error handling

- If a config file is malformed JSON/TOML, report the problem and skip that CLI — don't attempt repair.
- If the user declines to provide an Exa API key, skip the Exa server but still install Context7.
- If a config file is read-only or locked, report the problem and skip that CLI.
