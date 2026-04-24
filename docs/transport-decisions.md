# Transport Decisions

## Cursor (Phase D, 2026-04-24)

- Cursor CLI supports ACP via `agent acp` subcommand (NOT a `--acp` flag — easy to miss in `--help`).
- Confirmed working on Windows with JSON-RPC initialize handshake.
- Transport: shared `scripts/lib/acp-client.mjs` used for both Gemini and Cursor.
- Slash commands (e.g. `/debug`) are passed as the prompt text via the ACP `prompt` method.

## Windows spawn fix (Phase D, 2026-04-24)

- Both Cursor and Gemini CLIs on Windows are `.cmd` files (from npm global install or Cursor's installer).
- `spawn(cliName, [...args])` fails with EINVAL on Windows when `cliName` resolves to a `.cmd`.
- Fix: `spawn('"<absolute-forward-slash-path>" <args>', { shell: true })` — single command string, `shell: true`.
- Path resolution: use `process.env.PATH` + a small helper to find `.cmd` / `.exe` variants, OR hardcode-via-config, OR let the user set an env var for the CLI path.
