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
- Cursor: the binary is named `agent` (not `cursor-agent`). Try `agent --version` first. On Windows the installer does NOT add it to PATH — always fall back to `$LOCALAPPDATA/cursor-agent/agent.cmd --version` (a.k.a. `C:/Users/<name>/AppData/Local/cursor-agent/agent.cmd`). Remember whichever path works; use it throughout the rest of setup.
- `copilot --version`

Tabulate which succeed. For each failure, tell the user the install command:

- Codex: `npm install -g @openai/codex`
- Gemini: `npm install -g @google/gemini-cli`
- Cursor: `curl https://cursor.com/install -fsS | bash` (Unix) or `irm 'https://cursor.com/install?win32=true' | iex` (Windows PowerShell). After install, the binary lives at `$LOCALAPPDATA/cursor-agent/agent.cmd` on Windows and is not on PATH.
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

## Step 1.7 — Offer to add CLI binaries to the user's PATH (optional)

**Purpose:** Pure UX. The plugin works regardless — each adapter resolves binaries via absolute path. This step is for users who want to type `agent` / `codex` / `gemini` / `copilot` from any terminal without typing a full path.

**For each installed CLI**, do this check:

1. **Resolve the binary's directory.** The Step 1 detection already determined the working binary — derive its parent directory (e.g., for `C:/Users/<n>/AppData/Local/cursor-agent/agent.cmd`, the directory is `C:/Users/<n>/AppData/Local/cursor-agent`).

2. **Check if that directory is already on the user's PATH.**
   - **Windows:** `[Environment]::GetEnvironmentVariable("Path","User")` via PowerShell, then split on `;` and compare. (Don't use `$env:PATH` — that's the current process PATH, which may include parent process inheritance. The User-scope env is what `setx`/SetEnvironmentVariable actually persists.)
   - **Unix:** `echo "$PATH" | tr ':' '\n' | grep -Fxq "<dir>"` — exit 0 means present.

3. **If the directory IS already on PATH**, skip — report `✓ <cli>: binary already on PATH`.

   **Note for Git Bash users on Windows:** `which <bin>` returns "no <bin>" even when the directory IS on PATH, because Git Bash's `which` doesn't try `.cmd` / `.exe` extensions. Don't use `which` as your authoritative check — split PATH and compare directories instead. The binary works fine from PowerShell, cmd.exe, and Git Bash (using `<bin>.cmd` explicitly).

4. **If NOT on PATH**, ask via `AskUserQuestion` with ONE button option:
   - **Header text:** "The `<cli>` binary lives at `<full-path>` but is not on your PATH. Adding it lets you type `<bin-name>` directly from any terminal. Skip if you don't want your environment modified."
   - **Button option:** "Skip — leave PATH alone"
   - User clicks Skip OR types anything else (treat any non-skip response as consent).

5. **On consent, do the platform-appropriate edit, idempotent:**

   **Windows (per-user, no admin):**
   ```powershell
   $current = [Environment]::GetEnvironmentVariable('Path','User')
   $dirs = $current -split ';' | Where-Object { $_ -ne '' }
   if ($dirs -notcontains '<DIR>') {
     $new = ($dirs + '<DIR>') -join ';'
     [Environment]::SetEnvironmentVariable('Path', $new, 'User')
   }
   ```
   Use `[Environment]::SetEnvironmentVariable`, NOT the legacy `setx` command — `setx` truncates PATH at 1024 chars on some Windows versions.

   **Unix:** detect the user's shell first, then append a guarded line to the matching RC file:
   - Bash: `~/.bashrc` (Linux) or `~/.bash_profile` (macOS-ish)
   - Zsh: `~/.zshrc`
   - Fish: `~/.config/fish/config.fish`
   - Detect via `$SHELL` env var. If unclear, ASK the user which shell they use rather than guessing.
   
   Append (only if not already present — `grep -Fq` first):
   ```bash
   # cc-multi-cli-plugin: added <cli> to PATH
   export PATH="<DIR>:$PATH"
   ```

6. **Report exactly what was changed and how to revert:**

   ```
   ✓ <cli>: added <DIR> to PATH
       Location of change: <Windows registry key | shell RC file>
       To revert: <one-line instruction — registry edit on Windows, remove the lines on Unix>
       Note: open a NEW terminal for the change to take effect; current shell is unaffected.
   ```

7. **Bash session inside Claude Code is also unaffected** by user-PATH changes you just made. Don't try to verify by running `<bin-name>` immediately afterward — it'll fail in the current process even though the persistent change is correct. Trust the registry/RC-file edit and move on.

**Skip this entire step if `--dry-run` was passed.**

## Step 2 — Verify auth

For each installed CLI, check auth:

- Codex: `codex login status` (NOT `codex whoami` — that doesn't exist)
- Gemini: `gemini --version` should run without prompting for login (if it prompts, the CLI isn't authenticated)
- Cursor: `agent status` (the binary from Step 1)
- Copilot: `copilot /session` won't work headless; check env vars `GH_TOKEN` / `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN`. If any is set, assume authenticated. Otherwise try a one-shot `copilot -p "hi" --allow-all-tools` with a 15s timeout — auth failures surface quickly.

If unauthenticated, give the exact login command and use `AskUserQuestion` to ask whether to pause for the user to log in or skip that CLI.

## Step 3 — Collect API keys (Exa required, Context7 optional)

### Step 3a — Look for keys the user ALREADY HAS before prompting

Claude Code and other MCP-using tools often already have these keys on the user's machine. Before bothering the user with a prompt, do this discovery pass via `Read`:

1. **Plugin's own stored keys:** `~/.claude/plugins/cc-multi-cli-plugin/config.json` (if exists, parse; use `exaApiKey` / `context7ApiKey` fields).
2. **Claude Code's project-level MCP config:** `~/.claude/.mcp.json` (parse JSON; look for any `mcpServers.<name>.env.EXA_API_KEY` and `.CONTEXT7_API_KEY`).
3. **Other CLI configs on the system** — since the user might already have these MCPs wired to another CLI:
   - `~/.codex/config.toml` — TOML parse; look for `mcp_servers.<any-name>.env.EXA_API_KEY` (any exa-flavored server) and `.CONTEXT7_API_KEY`.
   - `~/.gemini/settings.json` — same idea.
   - `~/.cursor/mcp.json` — same.
   - `~/.copilot/mcp-config.json` — same.
4. **Common env vars:** `$EXA_API_KEY` in the shell environment. Uncommon but worth a one-line check.

If you find a plausible key, compose a summary and ASK before using it (via `AskUserQuestion`):

> "I found what looks like an Exa key already present in `<file>`. Reuse it, or paste a different key?"
> - Option: "Reuse the key from `<file>`"
> - (implicit free-text: paste a different key)

If you find nothing, proceed to the explicit prompt (Step 3b).

### Step 3b — Prompt for keys not found in Step 3a

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

### Step 3c — Validate the Exa key via a quick API probe (fail fast)

If the user provided an Exa key (either reused from Step 3a or pasted in Step 3b), verify it works BEFORE writing it to 4 config files:

```bash
curl -sS -X POST https://api.exa.ai/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <KEY>" \
  -d '{"query":"test","numResults":1}' \
  -w "\n%{http_code}" | tail -1
```

Expected: `200`. Anything else (401, 403) means the key is bad — report the HTTP code to the user and ask for a correct key via `AskUserQuestion` (or Skip).

Don't validate Context7 — the MCP works without a key; a bad key would just degrade it to free-tier and that's visible on first use.

### Step 3d — Save

Write `~/.claude/plugins/cc-multi-cli-plugin/config.json`:

```json
{
  "exaApiKey": "<key-or-empty-string>",
  "context7ApiKey": "<key-or-empty-string>"
}
```

Create the directory with `Bash` if it doesn't exist. **File permissions:** on Unix, `chmod 600` the file. On Windows, skip the chmod — NTFS default ACLs on user-profile paths already restrict to that user. Note in your summary to the user that this file "has user-profile ACL restrictions" on Windows or "is 0600" on Unix.

Never echo either key back after capture — just confirm "Saved." If the user skipped a key, store an empty string (Step 4 treats empty-string as the "omit env block" signal).

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
   args = ["-y", "exa-mcp-server"]
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
     "args": ["-y", "exa-mcp-server"],
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

   **Conflict handling — purpose-aware, not name-aware:** Before merging, scan the existing `mcpServers` object for any server that looks Exa-related (name matches `/exa/i`, OR args include `exa-mcp-server` or `@exa/`, OR httpUrl mentions `exa.ai`) and any that looks Context7-related (name matches `/context7/i`, OR args include `@upstash/context7-mcp`, OR httpUrl mentions `context7`). If you find such a server under ANY name (e.g., `exa-websearch`, `grep`, `context7-docs`):

   - Stop merging that one server silently.
   - Report the finding: "You already have `<existing-name>` configured for <Exa|Context7>: `<one-line-summary>`."
   - Ask via `AskUserQuestion`: "Keep yours" / "Replace with plugin default".
   - If "Keep yours", skip adding our entry for this CLI+server; continue with the other server. If "Replace", remove the existing entry and add ours.
   - Name-level collision (user has a server literally named `exa` or `context7`) is the same flow — not special.

   **`npx` vs `httpUrl`:** the plugin's default is `npx -y <package>` (stdio transport) for consistency across systems and for cases where the user is offline after first fetch. An existing HTTP transport (e.g., `httpUrl: "https://mcp.context7.com/mcp"`) is legitimate and often faster. Do not present npx as objectively better — when the user has an HTTP version, the "Keep yours" option is reasonable.

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

Print a concise summary. Include the list of files that now embed the API keys — useful when the user wants to rotate a key later.

```
cc-multi-cli-plugin setup complete.

Per-CLI status:
  ✓ Codex: configured (exa, context7)
  ✓ Gemini: configured (exa, context7)
  ⚠ Cursor: skipped — not authenticated (run `agent status`)
  ✗ Copilot: configuration failed — <error message>

Keys embedded in (rotate by editing these if needed):
  ~/.claude/plugins/cc-multi-cli-plugin/config.json  (plugin's canonical copy)
  ~/.codex/config.toml
  ~/.gemini/settings.json
  ~/.cursor/mcp.json
  ~/.copilot/mcp-config.json

Backups (restore by copying .bak back):
  ~/.codex/config.toml.bak
  ~/.gemini/settings.json.bak
  ~/.cursor/mcp.json.bak
  ~/.copilot/mcp-config.json.bak

Next steps:
  - Try `/gemini:research <topic>` or any other plugin command.
  - Re-run `/multi:setup` anytime to reconfigure (it's idempotent and skips already-configured pieces).
```

## Dry-run mode

If `--dry-run` was in `$ARGUMENTS`, skip steps 3–5's writes entirely. Instead, print what WOULD be changed in each file and exit.

## Error handling

- If a config file is malformed JSON/TOML, report the problem and skip that CLI — don't attempt repair.
- If the user declines to provide an Exa API key, skip the Exa server but still install Context7.
- If a config file is read-only or locked, report the problem and skip that CLI.
