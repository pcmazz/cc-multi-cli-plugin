# Changelog

## v2.0.0 (unreleased)

### Breaking — renamed from `skill-gemini` to `cc-multi-cli-plugin`

This release replaces the former `skill-gemini` plugin. The plugin has a new name, a new repo URL (github.com/greenpolo/cc-multi-cli-plugin), and a broader scope covering Codex, Gemini, Cursor, and GitHub Copilot CLIs.

**Migration:**

1. In Claude Code: `/plugin uninstall skill-gemini`
2. In Claude Code: `/plugin install cc-multi-cli-plugin` (from github.com/greenpolo/cc-multi-cli-plugin)
3. Run `/multi:setup` to configure MCPs

A fuller changelog entry (commands, subagents, attribution) will be added when v2.0.0 is tagged.

## v1.0.0

Original Gemini-only read-only consultation skill. See the `v1.0.0` git tag for history. Deprecated; replaced by v2.0.0.
