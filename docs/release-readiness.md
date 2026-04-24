# v2.0.0 Release Readiness

## What's in the box

- 4 CLI transport adapters: Codex (ASP), Gemini/Cursor/Copilot (ACP)
- 8 slash commands + 4 subagents + 2 extension skills
- `/multi:setup` Claude-driven MCP configuration wizard
- Full Apache 2.0 LICENSE + upstream-attribution NOTICE
- Comprehensive CHANGELOG

## Verification checklist (USER, before tag/push)

Each of these must pass before publishing:

- [ ] `node --check` passes on every `.mjs` in `scripts/`:
  ```
  find scripts -name "*.mjs" -exec node --check {} \;
  ```
- [ ] `/plugin install --path <local plugin path> --force` succeeds in Claude Code.
- [ ] `/multi:setup --dry-run` runs, lists installed CLIs correctly.
- [ ] One live run of each command with at least one installed CLI:
  - `/gemini:research`, `/codex:execute`, `/cursor:write`, `/cursor:plan`, `/cursor:debug`, `/copilot:research`, `/copilot:review`
- [ ] README's "Install in one paste" prompt makes sense if pasted cold.
- [ ] CHANGELOG.md accurately reflects what changed.
- [ ] NOTICE has correct upstream credits.

## Release commands

Once verification passes, run from the plugin repo root:

```bash
git checkout master                              # or main — use your default branch name
git merge v2-multi-cli --no-ff -m "Release v2.0.0 — cc-multi-cli-plugin"
git tag -a v2.0.0 -m "Release v2.0.0 — cc-multi-cli-plugin"
git push origin master
git push origin v2.0.0
```

## Optional — v1.0.1 deprecation tag on the old plugin path

If you want a final tag on the old `skill-gemini` name that points users to the new plugin:

```bash
# On a separate branch from the v1.0.0 tag:
git checkout -b deprecated-skill-gemini-v1 v1.0.0
# Add a deprecation notice at the top of skills/gemini/SKILL.md
# (something like: "This skill has moved to cc-multi-cli-plugin — install that instead.")
git add skills/gemini/SKILL.md
git commit -m "chore: v1.0.1 deprecation notice — moved to cc-multi-cli-plugin"
git tag -a v1.0.1 -m "Deprecated — replaced by cc-multi-cli-plugin v2.0.0"
git push origin deprecated-skill-gemini-v1
git push origin v1.0.1
```

## Known limitations in v2.0.0

See CHANGELOG.md's "Known limitations" section. Nothing blocks the release, but users should be aware.
