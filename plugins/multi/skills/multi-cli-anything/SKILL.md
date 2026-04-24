---
name: multi-cli-anything
description: Add a new CLI provider to cc-multi-cli-plugin (beyond the built-in Codex/Gemini/Cursor/Copilot). Use when the user asks to integrate another AI CLI like Qwen, OpenCode, Aider, or any CLI that speaks ACP, ASP, or another structured protocol. Trigger phrases include "add Qwen to the plugin", "integrate OpenCode", "hook up my custom CLI", "support another model via ACP".
---

# Add a new CLI to cc-multi-cli-plugin

cc-multi-cli-plugin is a **multi-plugin marketplace**. Adding a new CLI means adding a new plugin to the marketplace plus wiring a new adapter into the shared companion runtime in the `multi` plugin.

## Step 0 — Research the CLI first

Before writing any code, pull everything you need to know about the CLI so you don't have to guess or ask the user later. Extract:

- **Install status and binary name** — is the user's machine set up? What's the exact command (`cursor-agent`? `agent`? `qwen`? `aider`?)
- **Structured transport** — does it support ACP, ASP, or structured stdout? (See prerequisites below.)
- **Exact model identifiers** the CLI accepts (or `auto` if offered). Hardcoding a wrong model string causes 400 errors at runtime.
- **Available slash commands and modes** — e.g., `/research`, `/review`, `/plan`, `/debug`, `/ask`, or whatever the CLI exposes. These determine which roles you'll map to slash-command prefixes in `buildPrompt()`.
- **Runtime flags** — sandbox, read-only, effort, background, resume — what does the CLI's `--help` actually use?
- **Authentication mechanism** — env var, OAuth, device code, API key header, etc.
- **Known quirks** (Windows shell requirements, PATH issues, version-specific behavior).

**Pick sources proportional to the question.** Do NOT run every source for every fact. Start cheap and authoritative; escalate only if unclear.

Preferred order per question:

1. **`<cli> --help`, `<cli> models`, `<cli> about`** — fastest, no network, authoritative for "what does this binary accept right now."
2. **Prompt the CLI itself** (when no listing subcommand exists):
   ```bash
   <cli> -p "List the exact <thing> strings this CLI accepts. One per line."
   ```
3. **Vendor docs via context7** — `resolve-library-id` → `query-docs`. Good for canonical names and deprecation context.
4. **exa web search** — for changelogs, forum posts, obscure flags context7 doesn't have.
5. **CLI source on GitHub** — `config/models.ts` constants. Slowest; use only when 1–4 disagree or come up empty.

For a yes/no question ("does this CLI have ACP?") use source 1 or 3 and stop. For a canonical ID that gets hardcoded into files, use 1 plus 3 or 4 to cross-check — two sources is enough.

**Hard rules:**
- **Never ask one CLI about another CLI's features.** It hallucinates as badly as you would. A CLI is a source only for itself.
- **Preview-suffix trap:** Many CLIs qualify unstable IDs with a suffix (`-preview`, `-beta`, `-exp`). Don't hardcode the unsuffixed variant — it will 404 at runtime. Gemini 3.x IDs all end in `-preview`.
- **Resolving disagreements:** CLI wins for "does it work right now"; docs win for "should I use this."
- **Record the source you used** inline in your response so the user can catch a bad citation.
- **Check existing adapters** in `plugins/multi/scripts/lib/adapters/` as reference templates for the transport pattern you'll reuse.

Proceed without asking the user to confirm facts you can verify yourself.

## Prerequisites — confirm the CLI speaks a structured transport

Check in this order:

### 1. Does it support ACP (Agent Client Protocol)?

ACP is a cross-vendor standard. Check the CLI's `--help` output for:
- `--acp` flag (used by Gemini, Copilot)
- `acp` subcommand (used by Cursor)
- An `--stdio` or `--server` mode that outputs NDJSON/JSON-RPC

If yes, this is the easy path. Skip to "ACP integration" below.

### 2. Does it support ASP (App Server Protocol)?

ASP is OpenAI's flavor — HTTP + SSE, as used by Codex (`codex --app-server`). If the CLI has a similar flag, you can reuse much of the Codex adapter pattern.

### 3. Does it have a structured headless output mode?

Some CLIs have `-p` or `--print` modes with `--output-format=json` or similar. Not as rich as ACP/ASP but workable — wrap subprocess invocation and parse the JSON stream.

### 4. None of the above?

The CLI is probably not a good fit yet. Suggest filing a feature request upstream for ACP support.

## ACP integration (easiest path)

### Step 1 — Pick a short CLI name

Use the CLI's brand name, lowercased. E.g., `qwen`, `opencode`, `aider`. This becomes the `--cli <name>` flag value and the slash-command namespace.

### Step 2 — Create the adapter inside `multi`

Copy the canonical Cursor adapter as a template:

```bash
cp plugins/multi/scripts/lib/adapters/cursor.mjs plugins/multi/scripts/lib/adapters/<new-cli>.mjs
```

Edit the new file:

1. **Rename functions** from `*Cursor` to `*<NewCli>` (e.g., `runAcpPromptCursor` → `runAcpPromptQwen`).
2. **Update `buildPrompt(role, userTask)`** — map role names to slash-command prefixes the CLI understands.
3. **Update the CLI binary name / args.** ACP subcommand: `args: ["acp"]`. ACP flag: `args: ["--acp"]` or `["--acp", "--stdio"]`.
4. **Update the `adapter` export:**
   ```js
   export const adapter = {
     name: "<new-cli>",
     isAvailable: get<NewCli>Availability,
     isAuthenticated: get<NewCli>AuthStatus,
     invoke: runAcpPrompt<NewCli>,
     cancel: interruptAcpPrompt<NewCli>,
     getSession: undefined,
   };
   ```
5. Syntax-check: `node --check plugins/multi/scripts/lib/adapters/<new-cli>.mjs`.

### Step 3 — Register the adapter in the companion

Edit `plugins/multi/scripts/multi-cli-companion.mjs`:

1. Add import near the other adapter imports:
   ```js
   import * as <newCli> from "./lib/adapters/<new-cli>.mjs";
   ```
2. Extend `ADAPTERS`:
   ```js
   const ADAPTERS = { codex, gemini, cursor, copilot, <newCli> };
   ```
3. Extend `executeTaskRun`'s dispatch with an `else if (cli === "<new-cli>")` branch mirroring the cursor branch exactly, substituting `<newCli>.adapter.invoke(...)`.
4. Extend `buildTaskRunMetadata`'s label map so jobs get a CLI-specific title.
5. Syntax-check: `node --check plugins/multi/scripts/multi-cli-companion.mjs`.

### Step 4 — Add subagents for each role

Create one subagent file per role in `plugins/multi/agents/<new-cli>-<role>.md`:

```markdown
---
name: <new-cli>-<role>
description: Use when the user asks for <role-appropriate tasks> via <NewCli>.
model: sonnet
tools: Bash
---

You are a thin forwarding wrapper around the cc-multi-cli-plugin companion runtime for <NewCli>.

Use exactly one `Bash` call:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/multi-cli-companion.mjs" task --cli <new-cli> --role <role> ...`

Preserve task text verbatim. Return stdout exactly. No commentary.
```

Subagent names are `<cli>-<role>` (e.g., `qwen-writer`). Invocation path: `subagent_type: "multi:<cli>-<role>"`.

### Step 5 — Create the new plugin directory

```bash
mkdir -p plugins/<new-cli>/.claude-plugin plugins/<new-cli>/commands
```

Write `plugins/<new-cli>/.claude-plugin/plugin.json`:

```json
{
  "name": "<new-cli>",
  "description": "Delegate <roles> to <NewCli> CLI. Part of cc-multi-cli-plugin. Requires the `multi` plugin.",
  "version": "2.0.0",
  "author": { "name": "greenpolo", "url": "https://github.com/greenpolo" },
  "license": "Apache-2.0",
  "keywords": ["claude-code", "<new-cli>", "<role>", "acp"]
}
```

### Step 6 — Write command files

One markdown per role in `plugins/<new-cli>/commands/<role>.md`:

```markdown
---
description: <what this does>
argument-hint: "[--model <model>] <what to do>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Dispatch to the `multi:<new-cli>-<role>` subagent via the `Agent` tool.

Raw user request:
$ARGUMENTS

Return the subagent's output verbatim.
```

Command filename becomes the part after the colon in the slash: `plugins/qwen/commands/write.md` → `/qwen:write`.

### Step 7 — Register the new plugin in the marketplace

Edit `.claude-plugin/marketplace.json` (at the repo root) and add a new entry to the `plugins` array:

```json
{
  "name": "<new-cli>",
  "description": "Adds /<new-cli>:<roles>. Requires multi.",
  "version": "2.0.0",
  "author": { "name": "greenpolo" },
  "source": "./plugins/<new-cli>"
}
```

Validate: `claude plugin validate <repo-root>` should pass.

### Step 8 — Install and test

```bash
claude plugin marketplace update cc-multi-cli-plugin
claude plugin install <new-cli>@cc-multi-cli-plugin
claude plugin install multi@cc-multi-cli-plugin --force   # pick up new subagent files
```

Restart Claude Code. Try `/<new-cli>:<role> <prompt>`.

## ASP integration (medium difficulty)

ASP requires a different transport (HTTP + SSE vs stdio JSON-RPC). If the new CLI uses ASP-style servers:

1. Study `plugins/multi/scripts/lib/app-server.mjs` and `plugins/multi/scripts/lib/adapters/codex.mjs`.
2. Model the new adapter on `codex.mjs` instead of `cursor.mjs`.
3. Steps 3–8 above still apply — the `ADAPTERS` registration and plugin scaffolding are protocol-agnostic.

This is more code than ACP integration — only take this path if the new CLI genuinely requires it.

## Subprocess + stream-json integration (fallback)

If the CLI lacks ACP/ASP but has a headless JSON-output mode, write an adapter that:
1. Spawns the CLI with `-p --output-format=json` (or equivalent).
2. Parses the JSON stream or final output.
3. Normalizes to the same result shape as other adapters: `{ sessionId, text, fileChanges, error }`.

The `adapter` export interface (`name`, `isAvailable`, `invoke`, etc.) stays identical — only the transport differs.

## Tested examples

OpenCode has been tested successfully via ACP. Qwen and Aider have similar ACP support and should work the same way. Any CLI that speaks a structured protocol is a candidate.

## Things NOT to change when adding a new CLI

- `plugins/multi/scripts/lib/acp-client.mjs`, `job-control.mjs`, `state.mjs`, `render.mjs` — shared infrastructure.
- `plugins/multi/scripts/lib/adapters/codex.mjs`, `gemini.mjs`, `cursor.mjs`, `copilot.mjs` — existing adapters.
- `plugins/multi/hooks/hooks.json` — unless the new CLI specifically needs a hook.

## Closing

After adding a new CLI, consider contributing the adapter back upstream. The plugin welcomes new CLIs that demonstrate working adapters — it's part of why the architecture is modular.
