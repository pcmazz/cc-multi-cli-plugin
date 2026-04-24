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

**Each key prompt should use EXACTLY ONE button option.** `AskUserQuestion` always has an implicit free-text input box alongside the button options — the user either clicks the button OR types their key as a free-text response. Adding a "Paste key" button is redundant with the free-text input.

### Exa API key (required for Exa MCP to function)

Ask via `AskUserQuestion`:
- **Header / question text:** "Exa API key (required for the Exa MCP to work). Get one free at https://dashboard.exa.ai. To provide one, paste the key as your response. Otherwise click Skip — the Exa MCP will be registered without a key and will fail at runtime until you add one."
- **Button option:** "Skip — register Exa without a key (will fail at runtime)"

The user either clicks Skip or pastes the key. Treat the free-text response (if any) as the API key.

### Context7 API key (optional)

Ask via `AskUserQuestion`:
- **Header / question text:** "Context7 API key (optional). Works without a key at free-tier rate limits. With a key (free at https://context7.com): higher rate limits + access to researchMode for deeper synthesis. To provide one, paste the key as your response. Otherwise click Skip."
- **Button option:** "Skip — use Context7 at free-tier limits"

The user either clicks Skip or pastes the key.

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

5. **Gemini / Cursor / Copilot — JSON**: Merge these two servers into `mcpServers`. **Do NOT add any extra marker keys** like `_cc_multi_managed` inside the server entries — Gemini's schema validator rejects unknown keys and this breaks the entire config load. Include Context7's `env` block ONLY if the user provided a key.

   **Exa** (always includes its env block — required):
   ```json
   "exa": {
     "command": "npx",
     "args": ["-y", "@exa/mcp-server-exa"],
     "env": { "EXA_API_KEY": "<EXA_KEY_FROM_CONFIG>" }
   }
   ```

   **Context7 with key:**
   ```json
   "context7": {
     "command": "npx",
     "args": ["-y", "@upstash/context7-mcp"],
     "env": { "CONTEXT7_API_KEY": "<CONTEXT7_KEY_FROM_CONFIG>" }
   }
   ```

   **Context7 without key** (omit the `env` object):
   ```json
   "context7": {
     "command": "npx",
     "args": ["-y", "@upstash/context7-mcp"]
   }
   ```

   **Tracking our managed servers without breaking CLI schemas:** Instead of an inline marker, record which servers we added in a separate file — `~/.claude/plugins/cc-multi-cli-plugin/managed-servers.json`:
   ```json
   {
     "<cli-name>": ["exa", "context7"]
   }
   ```
   Update this file each time you add servers to a CLI's config. The customize skill and any future uninstall logic can read it to know which entries were added by this plugin vs the user.

   **Conflict handling:** If the user already has an `exa` or `context7` server under a different configuration, do NOT overwrite — report the conflict and ask via `AskUserQuestion` whether to replace or keep theirs.

6. Use `Read` to pull the file, `Edit`/`Write` to apply changes. Preserve the user's other keys and structure.

## Step 5 — Verify (FAST, via native MCP-list commands)

Do NOT run slow "ask the CLI to invoke a tool" probes — those take 30s-2min per CLI. Each CLI has a native `mcp` subcommand that lists configured servers instantly. Use those.

| CLI | Probe command | Expected output |
|---|---|---|
| Codex | `codex mcp list` (or `codex mcp` without args for help) | exa + context7 listed |
| Gemini | `gemini mcp list` | exa + context7 listed |
| Cursor | `"<path>/agent.cmd" mcp list` or `agent mcp list` on Unix | exa + context7 listed |
| Copilot | No direct listing command found — read `~/.copilot/mcp-config.json` and parse to confirm `mcpServers.exa` and `mcpServers.context7` exist | servers present in JSON |

**If any of these fail** (non-zero exit, schema error, missing servers in output):
- Print the exact error.
- Do NOT roll back automatically — let the user see what went wrong.
- For schema errors (e.g., Gemini rejecting unknown keys), tell the user which config file has the issue and quote the error message.

**Time budget:** each probe should complete in < 5 seconds. If one hangs, kill it (`timeout 10 <command>` via Bash) and report as failed — don't wait 2 minutes.

**Don't verify MCP server runtime reachability here.** The CLI listing each server confirms the config is valid and the CLI will spawn the server on first use. The server actually responding to queries is tested on the first real `/gemini:research` / `/copilot:research` / etc. invocation — not in setup.

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
