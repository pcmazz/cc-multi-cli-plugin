# Transport Decisions

## Cursor (Phase D, 2026-04-24)

- Checked: `cursor-agent --help` for ACP flag
- Native ACP flag found: no — `cursor-agent` is not a standalone CLI binary on PATH.
  The command `cursor-agent --help` returned "command not found" in both environments
  checked (PATH search and direct invocation). Cursor ships its agent as a VS Code
  extension (`cursor-agent-exec`) embedded in the Cursor install, not as a spawnable
  CLI process. No `--acp`, `--mode`, or `-p` flags are available because there is no
  standalone `cursor-agent` binary. The `cursor` binary at
  `/c/LabSoftware/cursor/resources/app/bin/cursor` is the IDE launcher, not an agent CLI.
- Decision: NEEDS_CONTEXT — cannot invoke `cursor-agent --acp` directly via
  SpawnedAcpClient; no subprocess `-p` flag available either.
- Rationale: Without a standalone `cursor-agent` binary that accepts ACP or prompt flags,
  the plan's assumption of native ACP does not hold on this machine; the correct transport
  (npm shim, REST API, or other mechanism) needs to be determined before implementation.
