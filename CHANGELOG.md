# Changelog

## v2.0.0 — 2026-04-24

### Breaking — renamed from `skill-gemini` to `cc-multi-cli-plugin`

This release fully replaces the former `skill-gemini` plugin. The plugin has a new name, a new repo URL (github.com/greenpolo/cc-multi-cli-plugin), a new scope (4 CLI providers, not just Gemini), and new commands. There is no in-place upgrade path.

**Migration from v1 (`skill-gemini`):**
1. In Claude Code: `/plugin uninstall skill-gemini`
2. In Claude Code: `/plugin install cc-multi-cli-plugin` (from github.com/greenpolo/cc-multi-cli-plugin)
3. Run `/multi:setup` to configure MCPs on each CLI
4. The old `skills/gemini` SKILL is gone. Its functionality is absorbed by `/gemini:research` and the `gemini-researcher` subagent.

### Added

**Four CLI transport adapters, three protocols:**
- Codex via App Server Protocol (ASP) — `codex --app-server`
- Gemini via Agent Client Protocol (ACP) — `gemini --acp`
- Cursor via ACP — `agent acp`
- GitHub Copilot via ACP — `copilot --acp --stdio`

**Eight slash commands:**
- `/multi:setup` — one-shot Claude-driven wizard that detects installed CLIs and configures Exa + Context7 MCPs on each
- `/gemini:research` — deep research / exploration with Gemini's 1M-token context (read-only)
- `/codex:execute` — delegate a specific plan step to Codex for rigorous implementation
- `/cursor:write` — bulk / multi-file code writing in Cursor Agent mode
- `/cursor:plan` — Cursor Plan mode for approach design (read-only)
- `/cursor:debug` — Cursor Debug mode for hypothesis-driven root-cause investigation
- `/copilot:research` — Copilot's /research (GitHub + web investigation)
- `/copilot:review` — Copilot's /review code review agent

**Four auto-dispatch subagents** (Claude proactively delegates via the Agent tool):
- `gemini-researcher`, `codex-execute`, `cursor-writer`, `cursor-debugger`

**Two extension skills:**
- `customize` — guides Claude through rewiring which CLI handles which role (swap, disable, restrict, etc.)
- `multi-cli-anything` — guides Claude through adding brand-new CLI providers (ACP, ASP, or subprocess paths)

**Companion runtime** (ported from OpenAI's `codex-plugin-cc`):
- Shared CLI adapter registry with `--cli <name>` dispatch
- Background job control (`--background` / `--wait`)
- Session state persistence under `~/.claude/plugins/cc-multi-cli-plugin/state/`
- Session lifecycle hooks
- Windows-safe `spawn()` pattern for `.cmd`-wrapped CLIs (Cursor, Gemini, Copilot on npm global installs)

### Changed

- Plugin name: `skill-gemini` → `cc-multi-cli-plugin`
- License: unchanged (Apache 2.0) but `LICENSE` and `NOTICE` files added with full upstream attribution
- Repo layout: flattened from marketplace format (`plugins/skill-gemini/`) to a single-plugin layout at the repo root

### Removed

- The old Gemini-only `skills/gemini/SKILL.md` — functionality absorbed by `gemini-researcher` + `/gemini:research`
- The repo's former `plugins/skill-gemini/` nested directory
- The former `.claude-plugin/marketplace.json` marketplace manifest

### Known limitations

These are explicit v2.0.0 deferrals. Filed for a future release.

- **Background task worker untested for non-Codex CLIs.** The `cli` field is stored in the job request and threaded through `executeTaskRun`, so Gemini/Cursor/Copilot background jobs *should* work — not yet verified end-to-end.
- **`--resume-last` is Codex-only.** Gemini/Cursor/Copilot receive the flag but have no session-resumption logic wired to the adapter. Per-invocation ACP sessions work; cross-invocation resume does not yet.
- **`job-observability` integration** between the shared runtime and non-Codex adapters is partial. `recordObserverEvent` is a no-op in the Gemini/Cursor/Copilot paths. Doesn't affect correctness, does affect introspection.
- **`/codex:review` and `/codex:adversarial-review`** remain in the official `openai-codex` plugin; our plugin has no review path for non-Codex CLIs yet. Gemini/Cursor/Copilot reviews can be invoked through each CLI's native slash command via the companion runtime but not through top-level plugin commands.
- **Setup wizard's MCP probes.** `/multi:setup` configures MCPs on each CLI but doesn't deeply verify Exa / Context7 are reachable after configuration. Users should do a sanity check by running `/gemini:research test` or similar after setup.

### Attribution

Apache 2.0 licensed. Major portions derived from:

- OpenAI's `codex-plugin-cc` (Apache 2.0) — runtime architecture, Codex adapter, hooks
- `sakibsadmanshajib/gemini-plugin-cc` (Apache 2.0) — Gemini ACP transport pattern
- `blowmage/cursor-agent-acp-npm` (MIT) — Cursor ACP adapter reference

See [NOTICE](NOTICE) for the full attribution.

## v1.0.0 — 2026-03 (as `skill-gemini`)

Original Gemini-only read-only consultation skill. See `v1.0.0` git tag for history. Superseded by v2.0.0.
