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
- Copilot: **DO NOT** run a `copilot -p "hi"` inference probe — that burns ~10-20k premium tokens just to check auth. Cheap path:
  1. Check env vars `GH_TOKEN` / `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN` — if any is set, assume authenticated.
  2. Else check `gh auth status` (the GitHub CLI shares Copilot's auth layer). Exit 0 = authenticated.
  3. Else check for a Copilot auth file at `~/.copilot/` (look for any auth-related JSON/config; Copilot stores tokens there once logged in).
  4. Only as last resort, fall back to a tiny `--help`-class probe that doesn't trigger inference. Never use `copilot -p`.

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

### Step 3c — Validate provided keys via quick API probes (fail fast)

For EACH key the user provided (reused from Step 3a or pasted in Step 3b), verify it works BEFORE writing to config files. Both probes are < 1s.

**Exa:**
```bash
curl -sS -X POST https://api.exa.ai/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <KEY>" \
  -d '{"query":"test","numResults":1}' \
  -w "\n%{http_code}" | tail -1
```
Expected: `200`. 401/403 → key is bad; ask for a correct one or Skip.

**Context7** (only if a key was provided — empty key is a valid "use free tier" signal):
```bash
curl -sS https://context7.com/api/v1/health \
  -H "Authorization: Bearer <KEY>" \
  -w "\n%{http_code}" | tail -1
```
Expected: `200`. 401/403 → key bad; ask for correction or Skip. The "key was valid yesterday but is wrong today" case is real (rotation, expired) — catching it here saves a future debug session.

If a key fails validation, do NOT proceed to write it to any config file.

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

2. **Back up the existing file** with mtime-aware rotation:
   - If `<file>.bak` doesn't exist → create it.
   - If `<file>.bak` exists AND its mtime is older than the live `<file>`'s mtime → the existing `.bak` is stale (predates the current state). Rotate it: rename existing `<file>.bak` to `<file>.bak.<YYYYMMDD-HHMMSS>` (timestamped), then create a fresh `<file>.bak` from the current live file.
   - If `<file>.bak` exists AND its mtime is ≥ live `<file>`'s mtime → already current; skip.

   **Why mtime rotation matters:** the prior "create only if not present" rule produced stale backups after re-runs — Step 6's "restore by copying .bak back" instruction could undo the user's managed entries. Mtime rotation guarantees `.bak` always reflects state immediately before the current run's edits.

3. **AUDIT existing managed entries first, then merge.** This is NOT a one-shot "additive merge" — re-runs of `/multi:setup` need to detect drift from prior versions of this skill (e.g., stale `_cc_multi_managed: true` marker keys that break Gemini's schema validator). Audit pass:

   - Read the current config file.
   - For each existing entry that IS one of our managed servers (`exa`, `context7`, OR matches the purpose patterns from the conflict-handling section below):
     - **If it has stale marker keys** (`_cc_multi_managed`, etc.) → strip them and report `cleaned stale marker on <cli>:<server>`.
     - **If its credentials differ from the canonical config.json values** (e.g., embedded Exa key doesn't match `exaApiKey` in plugin config) → report drift, ask via `AskUserQuestion` whether to update to the canonical value or keep the existing.
     - **If its shape (command/args/env) matches what we'd write fresh** → leave alone, report `unchanged`.
   - For each canonical server we WANT to add but isn't present → proceed with merge per the templates below.

   Treat "audit + reconcile" as the default behavior, not a special case.

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

   **Dual-credential drift** (multiple servers, same purpose, different keys): If the audit detects MULTIPLE Exa-purpose entries (e.g., both `exa` and `exa-websearch` present) AND their credentials differ (different `EXA_API_KEY` values, or one uses a key in args/URL while the other uses env), report the drift explicitly:

   *"Found two Exa servers with different credentials: `exa` (key ending …a3adec) and `exa-websearch` (key ending …b254f3). Only one of these is correct."*

   Ask via `AskUserQuestion`: "Consolidate to canonical (use the key from `~/.claude/plugins/cc-multi-cli-plugin/config.json`, drop the duplicate)" / "Keep both" / "Skip — investigate manually". Don't silently merge alongside; that's how dual-credential drift accumulated invisibly in the first place.

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

**Empty-output gotcha — re-probe with verbose flag before declaring failure.** Some CLIs (notably `gemini mcp list`) exit 0 with empty stdout when servers are correctly configured but the parser used for table rendering is in a weird state. If a probe exits 0 with empty output, retry once with the CLI's verbose/debug flag (`gemini mcp list -d`, etc.) and parse from there. ONLY after both probes return empty should you declare a failure. Exit-0-empty-stdout is not a reliable failure signal.

**Secrets warning when running verbose probes:** verbose / `-d` outputs often print env vars unmasked (Gemini does, Codex masks). If the user is screen-sharing or recording their terminal, this leaks the API key into scrollback. Before running any verbose probe, print:

> *"Running verbose probe for <cli> — output may include API keys. If you're sharing your screen, look away or skip this verification step."*

**If any probe fails** (non-zero exit, schema error, missing servers after both list and verbose):
- Print the exact error.
- Do NOT roll back automatically — let the user see what went wrong.
- For schema errors (e.g., Gemini rejecting unknown keys), tell the user which config file has the issue and quote the error message.

**Time budget:** each probe should complete in < 5 seconds. If one hangs, kill it (`timeout 10 <command>` via Bash) and report as failed — don't wait 2 minutes.

**Don't verify MCP server runtime reachability here.** The CLI listing each server confirms the config is valid and the CLI will spawn the server on first use. The server actually responding to queries is tested on the first real `/gemini:research` / `/copilot:research` / etc. invocation — not in setup.

## Step 6 — Report (with key inventory + drift summary)

Before printing the final summary, run a **key inventory pass** — scan all likely locations for embedded Exa or Context7 keys, including locations this wizard does NOT manage. The user needs to see the full surface area before considering rotation.

Locations to scan (read-only; report findings; don't modify):

- `~/.claude/plugins/cc-multi-cli-plugin/config.json` — plugin's canonical copy (managed)
- `~/.codex/config.toml` (managed)
- `~/.gemini/settings.json` (managed)
- `~/.cursor/mcp.json` (managed)
- `~/.copilot/mcp-config.json` (managed)
- `~/.claude/.mcp.json` — Claude Code's own MCP config (UNMANAGED — user maintains this)
- Any project-local `.mcp.json` files in commonly-used directories (cwd at minimum; report only)

For each file containing an Exa or Context7 key, show: file path, which key (Exa or Context7), key fingerprint (last 6 chars), and whether it's managed by this wizard. If the same key family has different fingerprints across files, flag it as drift.

Then print the concise summary. Include the list of files that now embed the API keys — useful when the user wants to rotate a key later.

```
cc-multi-cli-plugin setup complete.

Per-CLI status:
  ✓ Codex: configured (exa, context7)
  ✓ Gemini: configured (exa, context7)
  ⚠ Cursor: skipped — not authenticated (run `agent status`)
  ✗ Copilot: configuration failed — <error message>

Drift cleaned this run:
  - Stripped stale _cc_multi_managed marker from cursor/exa, cursor/context7
  - <or report 'no drift' if none found>

Key inventory (where Exa/Context7 keys are embedded right now):
  managed by this wizard:
    ~/.claude/plugins/cc-multi-cli-plugin/config.json  exa…a3adec  ctx7…c7e8c8
    ~/.codex/config.toml                                exa…a3adec  ctx7…c7e8c8
    ~/.gemini/settings.json                             exa…a3adec  ctx7…c7e8c8
    ~/.cursor/mcp.json                                  exa…a3adec  ctx7…c7e8c8
    ~/.copilot/mcp-config.json                          exa…a3adec  ctx7…c7e8c8
  not managed (review yourself):
    ~/.claude/.mcp.json                                 exa…a3adec  ctx7…c7e8c8
  drift detected: <none | list of files with mismatched fingerprints>

Backups (restore by copying .bak back — this run rotated stale ones):
  ~/.codex/config.toml.bak             (mtime: 2026-04-24 19:14 — fresh)
  ~/.codex/config.toml.bak.20260424-191100  (older snapshot, kept for reference)
  ~/.gemini/settings.json.bak          (mtime: 2026-04-24 19:14 — fresh)
  ~/.cursor/mcp.json.bak               (mtime: 2026-04-24 19:14 — fresh)
  ~/.copilot/mcp-config.json.bak       (mtime: 2026-04-24 19:14 — fresh)

Tracking file:
  ~/.claude/plugins/cc-multi-cli-plugin/managed-servers.json
  (lists which server names this wizard adds per CLI — used by the customize skill
   and by future /multi:uninstall to know what to remove cleanly.)

Next steps:
  - Try `/gemini:research <topic>` or any other plugin command.
  - Re-run `/multi:setup` anytime to reconfigure (idempotent: audits + reconciles drift, skips no-ops).
```

## Dry-run mode

If `--dry-run` was in `$ARGUMENTS`, skip steps 3–5's writes entirely. Instead, print what WOULD be changed in each file and exit.

## Error handling

- If a config file is malformed JSON/TOML, report the problem and skip that CLI — don't attempt repair.
- If the user declines to provide an Exa API key, skip the Exa server but still install Context7.
- If a config file is read-only or locked, report the problem and skip that CLI.
