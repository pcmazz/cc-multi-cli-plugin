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

## Step 1.5 — Offer to install the CLI-specific plugins

For each detected CLI, use `AskUserQuestion` to ask whether to install the matching sub-plugin. Run:

- Gemini detected → `claude plugin install gemini@cc-multi-cli-plugin` (adds `/gemini:research`)
- Codex detected → `claude plugin install codex@cc-multi-cli-plugin` (adds `/codex:execute`)
- Cursor detected → `claude plugin install cursor@cc-multi-cli-plugin` (adds `/cursor:write`, `/cursor:plan`, `/cursor:debug`)
- Copilot detected → `claude plugin install copilot@cc-multi-cli-plugin` (adds `/copilot:research`, `/copilot:review`)

Skip CLIs the user declines. Report any install failures via Bash stderr but continue. Users can install later by re-running this command or running `claude plugin install <name>@cc-multi-cli-plugin` manually.

## Step 2 — Verify auth

For each installed CLI, check auth:

- Codex: `codex whoami` or equivalent
- Gemini: `gemini --version` should run without prompting for login
- Cursor: `agent status`
- Copilot: `copilot status` or rely on `GH_TOKEN`/`COPILOT_GITHUB_TOKEN` env vars

If unauthenticated, give the exact login command and use `AskUserQuestion` to ask whether to pause for the user to log in or skip that CLI.

## Step 3 — Ask for API keys (Exa required, Context7 optional)

Check `~/.claude/plugins/cc-multi-cli-plugin/config.json` for stored keys. If the file already has both, skip. Otherwise, ask via `AskUserQuestion` for whichever is missing.

**Exa API key (required for web search):**
- Exa MCP always needs a key to function.
- Direct the user to https://dashboard.exa.ai if they don't have one.

**Context7 API key (optional but recommended):**
- Context7 works without a key for basic doc lookups.
- With a key: higher rate limits + access to `researchMode` (sandboxed agents reading source repos + live web search for deeper synthesis).
- Direct the user to https://context7.com for a free key.
- If the user declines, skip the env block for Context7 (it'll still work at free-tier limits).

**Save to config.json with mode 0600:**
```json
{
  "exaApiKey": "<key>",
  "context7ApiKey": "<key-or-empty-string>"
}
```

Create the directory with `Bash` if it doesn't exist. Never print either key back to the user after capture — just confirm "saved."

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
