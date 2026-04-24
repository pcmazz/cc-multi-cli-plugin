---
name: multi-cli-anything
description: Add a new CLI provider to cc-multi-cli-plugin (beyond the built-in Codex/Gemini/Cursor/Copilot). Use when the user asks to integrate another AI CLI like Qwen, OpenCode, Aider, or any CLI that speaks ACP, ASP, or another structured protocol. Trigger phrases: "add Qwen to the plugin", "integrate OpenCode", "hook up my custom CLI", "support another model via ACP".
---

# Add a new CLI to cc-multi-cli-plugin

This skill guides you through adding a brand-new CLI provider. The plugin's adapter architecture is designed for this: one shared transport client (ACP for stdio/JSON-RPC, ASP for HTTP/SSE) + per-CLI adapter shim.

## Prerequisites

The target CLI must speak a structured transport. Check in this order:

### 1. Does it support ACP (Agent Client Protocol)?

ACP is a cross-vendor standard. Check the CLI's `--help` output for:
- `--acp` flag (used by Gemini, Copilot)
- `acp` subcommand (used by Cursor)
- An `--stdio` or `--server` mode that outputs NDJSON/JSON-RPC

If yes, this is the easiest integration. Skip to "ACP integration" below.

### 2. Does it support ASP (App Server Protocol)?

ASP is OpenAI's flavor — HTTP + SSE, as used by Codex (`codex --app-server`). If the CLI has a similar flag, you can reuse much of the Codex adapter pattern.

### 3. Does it have a structured headless output mode?

Some CLIs have `-p` or `--print` modes with `--output-format=json` or similar. Not as rich as ACP/ASP but workable — wrap subprocess invocation and parse the JSON stream.

### 4. None of the above?

The CLI is probably not a good fit yet. Consider:
- Filing a feature request upstream to add ACP support.
- Writing a separate project-specific wrapper and NOT integrating into this plugin.

## ACP integration (the easy path)

Assuming the target CLI supports ACP via a subcommand or flag:

### Step 1 — Pick a short CLI name

Use the CLI's brand name, lowercased: e.g., `qwen`, `opencode`, `aider`. This becomes the `--cli <name>` flag value.

### Step 2 — Create the adapter

Copy the canonical Cursor adapter as a template (it's the cleanest ACP example):

```bash
cp scripts/lib/adapters/cursor.mjs scripts/lib/adapters/<new-cli>.mjs
```

Edit the new file:

1. **Rename functions** from `*Cursor` to `*<NewCli>` (e.g., `runAcpPromptCursor` → `runAcpPromptQwen`). Use find-and-replace.

2. **Update `buildPrompt(role, userTask)`** — the mapping of role names to slash-command prefixes the CLI understands. For example, if the CLI has a `/explain` slash command for read-only mode:
   ```js
   function buildPrompt(role, userTask) {
     const prefix = { explainer: "/explain " }[role] ?? "";
     return prefix + userTask;
   }
   ```

3. **Update the CLI binary path / name.** In `getCliBinary()` (or equivalent), point at the correct binary. On Windows, many CLIs install as `.cmd` files in `AppData/Roaming/npm/` or similar. The adapter's `resolveCliBinary` helper handles PATH lookup.

4. **Update spawn args.** Match what the CLI expects:
   - ACP subcommand: `args: ["acp"]` (like Cursor)
   - ACP flag: `args: ["--acp"]` (like Gemini) or `["--acp", "--stdio"]` (like Copilot)

5. **Update the `adapter` export:**
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

6. **Syntax-check:** `node --check scripts/lib/adapters/<new-cli>.mjs`.

### Step 3 — Register the adapter in the companion

Edit `scripts/multi-cli-companion.mjs`:

1. Add import at the top, near the other adapter imports:
   ```js
   import * as <newCli> from "./lib/adapters/<new-cli>.mjs";
   ```

2. Extend `ADAPTERS`:
   ```js
   const ADAPTERS = { codex, gemini, cursor, copilot, <newCli> };
   ```

3. Extend `executeTaskRun`'s dispatch. Add another `else if` branch mirroring the `cursor` branch exactly, substituting `<newCli>` for `cursor`:
   ```js
   else if (cli === "<new-cli>") {
     const avail = <newCli>.adapter.isAvailable();
     if (!avail.available) {
       throw new Error(`<NewCli> CLI not available: ${avail.detail ?? "binary not found"}. Install: <install hint>`);
     }
     const result = await <newCli>.adapter.invoke(workspaceRoot, prompt, {
       model: request.model ?? undefined,
       role: request.role ?? "default",
       onStream: /* same callback as cursor */,
     });
     /* return same shape as cursor branch */
   }
   ```

4. Extend `buildTaskRunMetadata`'s label map:
   ```js
   const cliLabel = cli === "gemini" ? "Gemini"
                  : cli === "cursor" ? "Cursor"
                  : cli === "copilot" ? "Copilot"
                  : cli === "<new-cli>" ? "<NewCli>"
                  : "Codex";
   ```

5. Syntax-check: `node --check scripts/multi-cli-companion.mjs`.

### Step 4 — Create commands

For each role the new CLI should expose, create `commands/<new-cli>-<action>.md`. Copy from an existing command (e.g., `commands/cursor-write.md` for agent-mode; `commands/cursor-plan.md` for plan-mode which lands inline without a subagent).

Decide per-role whether to create a matching subagent in `agents/<new-cli>-<role>.md`. Guidelines:
- Use a subagent if Claude should auto-dispatch the CLI proactively AND the output would bloat main context.
- Skip the subagent and invoke directly if the user wants to see output inline.

### Step 5 — Update `/multi:setup` (optional but polite)

If you want `/multi:setup` to auto-install MCP servers on the new CLI too, add a case to `commands/multi-setup.md` covering the new CLI's config file location and MCP config syntax. Usually ACP-based CLIs use a JSON `mcpServers` object — check the CLI's docs.

### Step 6 — Update README, CHANGELOG, NOTICE

- `README.md` — add the new CLI to the install prompt and the commands table.
- `CHANGELOG.md` — new entry describing the addition.
- `NOTICE` — if the new CLI's ACP code was ported from an upstream project, credit it.

### Step 7 — Test

Install the plugin locally: `/plugin install --path <plugin dir> --force`
Run the new command: `/<new-cli>:<role> <a test prompt>`
Verify coherent output.

## ASP integration (medium difficulty)

ASP requires a different transport (HTTP + SSE vs stdio JSON-RPC). If the new CLI uses ASP-style servers:

1. Study `scripts/lib/app-server.mjs` and `scripts/lib/adapters/codex.mjs`.
2. Model the new adapter on `codex.mjs` instead of `cursor.mjs`.
3. The `ADAPTERS` registration is identical to ACP.
4. The `executeTaskRun` branch calls a different invoke path (`runAppServerTurn` pattern).

This is significantly more code than ACP integration — only take this path if the new CLI genuinely requires it.

## Subprocess + stream-json integration (fallback)

If the new CLI lacks ACP/ASP but has a headless JSON-output mode, write a new adapter that:
1. Spawns the CLI with `-p --output-format=json` (or equivalent).
2. Parses the JSON stream or final output.
3. Normalizes to the same result shape as other adapters: `{ sessionId, text, fileChanges, error }`.

The adapter interface (`name`, `isAvailable`, `invoke`, etc.) stays identical. Only the transport differs.

## Things NOT to change when adding a new CLI

- `scripts/lib/acp-client.mjs`, `job-control.mjs`, `state.mjs`, `render.mjs` — shared infrastructure.
- `scripts/lib/adapters/codex.mjs`, `gemini.mjs`, `cursor.mjs`, `copilot.mjs` — existing adapters (unless fixing a cross-cutting bug).
- `hooks/hooks.json` — unless the new CLI specifically needs a hook.

## Closing

After adding a new CLI, consider contributing the adapter back upstream. The plugin welcomes new CLIs that demonstrate working adapters — it's part of why the architecture is modular.
