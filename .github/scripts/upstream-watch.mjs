#!/usr/bin/env node
/**
 * Polls upstream projects this plugin depends on, diffs against
 * .github/upstream-state.json, and (if anything changed) emits:
 *   - an updated state file
 *   - upstream-issue-body.md   — body for an issue to assign to copilot-swe-agent
 *   - upstream-issue-title.txt — issue title
 *   - has_changes=true on $GITHUB_OUTPUT
 *
 * Cursor's CLI isn't on GitHub and its changelog is JS-rendered — too brittle to
 * diff reliably from a workflow. We list it as a manual-reference source in the
 * issue body and let Copilot do the actual research.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const STATE_PATH = path.join(".github", "upstream-state.json");
const ISSUE_BODY_PATH = "upstream-issue-body.md";
const ISSUE_TITLE_PATH = "upstream-issue-title.txt";

const SOURCES = [
  {
    id: "acp-spec",
    label: "ACP spec",
    repo: "agentclientprotocol/agent-client-protocol",
    relevance: "Defines the JSON-RPC methods the plugin's `acp-client.mjs` implements. Spec changes can introduce new methods we should handle (e.g. `terminal/*`, `session/request_permission`, `cursor/ask_question`)."
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    repo: "google-gemini/gemini-cli",
    relevance: "Drives `plugins/multi/scripts/lib/adapters/gemini.mjs`. Watch for changes to ACP handshake, model alias resolution, MCP support, or new approval modes."
  },
  {
    id: "codex-cli",
    label: "Codex CLI (App Server Protocol)",
    repo: "openai/codex",
    relevance: "Drives `plugins/multi/scripts/lib/adapters/codex.mjs` and `app-server.mjs`. Watch for sandbox mode changes, new approval policies, or app-server protocol updates."
  },
  {
    id: "copilot-cli",
    label: "GitHub Copilot CLI",
    repo: "github/copilot-cli",
    relevance: "Drives `plugins/multi/scripts/lib/adapters/copilot.mjs`. Watch for ACP changes, slash-command additions/removals, or auth flow changes."
  },
  {
    id: "qwen-code",
    label: "Qwen Code",
    repo: "QwenLM/qwen-code",
    relevance: "Drives `plugins/multi/scripts/lib/adapters/qwen.mjs`. Watch for ACP support changes (the `--acp` flag graduated from `--experimental-acp` recently)."
  }
];

// Manual-reference sources the workflow can't reliably auto-diff. Copilot is
// asked to research these inside the issue.
const MANUAL_SOURCES = [
  {
    label: "Cursor agent CLI",
    changelog: "https://cursor.com/changelog",
    forum: "https://forum.cursor.com/c/bug-report/6",
    relevance: "Drives `plugins/multi/scripts/lib/adapters/cursor.mjs`. The plugin currently works around the 2026.04.17-787b533 ACP regression (see `maybeWarnAboutCursorVersion` and `ensureCursorAllowlist`). When Cursor ships a fix, both workarounds can likely be simplified or removed."
  }
];

const PLUGIN_FILES_OF_INTEREST = [
  "plugins/multi/scripts/lib/acp-client.mjs (shared ACP JSON-RPC client; `buildAutoApproveRequestHandler`)",
  "plugins/multi/scripts/lib/acp-terminals.mjs (client-side terminal services)",
  "plugins/multi/scripts/lib/mcp-servers.mjs (MCP wiring for ACP `session/new`)",
  "plugins/multi/scripts/lib/adapters/{codex,gemini,cursor,copilot,qwen}.mjs (per-CLI adapters)",
  "plugins/multi/scripts/multi-cli-companion.mjs (companion runtime + dispatch)"
];

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

async function fetchLatestRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      "User-Agent": "cc-multi-cli-plugin-upstream-watch",
      "Accept": "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {})
    }
  });
  if (res.status === 404) return null; // repo has no releases yet
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
  const data = await res.json();
  return {
    tag: data.tag_name,
    name: data.name,
    publishedAt: data.published_at,
    htmlUrl: data.html_url,
    body: typeof data.body === "string" ? data.body : ""
  };
}

function trimReleaseNotes(body, maxLines = 30) {
  if (!body) return "_(no release notes provided)_";
  const lines = body.replace(/\r/g, "").split("\n").filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return lines.slice(0, maxLines).join("\n") + "\n\n_…(release notes truncated; click the link above for the full text)_";
}

function appendOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}

function renderIssueBody(changes) {
  const today = new Date().toISOString().slice(0, 10);
  const sections = changes.map((c) => `### ${c.source.label} — ${c.previous ?? "(none)"} → \`${c.latest.tag}\`

- **Release**: [${c.latest.name ?? c.latest.tag}](${c.latest.htmlUrl}) (published ${c.latest.publishedAt?.slice(0, 10) ?? "?"})
- **Why this matters for the plugin**: ${c.source.relevance}

<details><summary>Release notes excerpt</summary>

${trimReleaseNotes(c.latest.body)}

</details>`);

  const manualSection = MANUAL_SOURCES.map((s) => `- **${s.label}** — changelog: ${s.changelog} · forum (bug reports): ${s.forum}
  - ${s.relevance}`).join("\n");

  const filesSection = PLUGIN_FILES_OF_INTEREST.map((f) => `- \`${f}\``).join("\n");

  return `_This issue was opened automatically by [\`upstream-watch.yml\`](../actions/workflows/upstream-watch.yml) on ${today} because at least one upstream project this plugin depends on shipped a new release._

## Detected changes

${sections.join("\n\n")}

## Also worth checking (manual — Copilot, please research these too)

${manualSection}

## Plugin files most likely to need updates

${filesSection}

## What I'd like you to do, @copilot

1. **Read the linked release notes** for each detected change above, plus the manual-reference changelogs.
2. **Compare what changed against the relevant adapter / shared code** in this repo. Look specifically for:
   - New ACP methods we should handle in \`acp-client.mjs\`'s \`buildAutoApproveRequestHandler\`
   - Renamed / deprecated CLI flags or model IDs hardcoded in any adapter
   - New CLI capabilities that obsolete a workaround we currently ship (e.g., the Cursor 2026.04.17 regression workaround in \`cursor.mjs\` — check if a newer Cursor release fixes it, and if so, propose removing \`maybeWarnAboutCursorVersion\` and the allowlist-injection or scoping it tighter)
   - Breaking changes that would silently break the plugin
3. **For each change that warrants action**, open a focused PR against \`master\` with the minimal fix. Reference the upstream release / commit / forum thread in the PR description.
4. **If a detected change does NOT need any plugin update**, reply on this issue with a short note saying "no plugin updates needed for X — reason: …" and close it.
5. **If something is ambiguous** (you can't tell from release notes whether the plugin is affected), ask in a comment rather than guessing.

You may use \`ACP_TRACE=1\` and the rest of the diagnostic patterns documented in \`plugins/multi/skills/customize/SKILL.md\` if you want to verify behavior empirically.

---

_State tracked in \`.github/upstream-state.json\` — bumped by this same workflow. If you want to suppress a noisy upstream from this watch, edit \`.github/scripts/upstream-watch.mjs\`._
`;
}

async function main() {
  const state = readState();
  const newState = { ...state };
  const changes = [];

  for (const src of SOURCES) {
    try {
      const latest = await fetchLatestRelease(src.repo);
      if (!latest || !latest.tag) {
        console.error(`[${src.id}] no latest release found`);
        continue;
      }
      const previousTag = state[src.id]?.latest;
      if (previousTag !== latest.tag) {
        console.log(`[${src.id}] CHANGED: ${previousTag ?? "(none)"} -> ${latest.tag}`);
        changes.push({ source: src, previous: previousTag, latest });
        // Only update state when the tag actually changed. Avoids weekly
        // commit noise from pure `checkedAt` bumps. Look at the Actions tab
        // for last-run-time visibility instead.
        newState[src.id] = { latest: latest.tag, checkedAt: new Date().toISOString() };
      } else {
        console.log(`[${src.id}] unchanged at ${latest.tag}`);
        // Preserve existing entry verbatim — don't touch `checkedAt`.
      }
    } catch (err) {
      console.error(`[${src.id}] failed:`, err.message);
      // Preserve previous state for this source; don't drop it.
      if (state[src.id]) newState[src.id] = state[src.id];
    }
  }

  // Preserve the leading _comment field on rewrite.
  if (state._comment) newState._comment = state._comment;

  fs.writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2) + "\n");
  console.log(`State written: ${STATE_PATH}`);

  if (changes.length === 0) {
    console.log("No upstream changes detected.");
    appendOutput("has_changes", "false");
    return;
  }

  const labels = changes.map((c) => c.source.label).join(", ");
  const title = `Upstream changes detected: ${labels}`;
  fs.writeFileSync(ISSUE_TITLE_PATH, title);
  fs.writeFileSync(ISSUE_BODY_PATH, renderIssueBody(changes));
  console.log(`Issue title: ${title}`);
  console.log(`Issue body written to ${ISSUE_BODY_PATH}`);
  appendOutput("has_changes", "true");
  appendOutput("issue_title", title);
}

main().catch((err) => {
  console.error("upstream-watch failed:", err);
  process.exit(1);
});
