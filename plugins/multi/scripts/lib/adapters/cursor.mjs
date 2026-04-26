/**
 * Cursor adapter — availability checks, auth status, and running prompts
 * through Cursor's ACP server (`agent acp`).
 *
 * Cursor's CLI is the `agent` command, installed by Cursor into a per-user
 * location (e.g. C:/Users/<name>/AppData/Local/cursor-agent/agent.cmd on
 * Windows). It speaks the same ACP JSON-RPC protocol as `gemini --acp`.
 *
 * Slash-command roles are implemented by prepending the appropriate slash
 * prefix to the prompt text before sending it via ACP.
 */

import { execSync } from "node:child_process";
import process from "node:process";
import { buildAutoApproveRequestHandler, SpawnedAcpClient } from "../acp-client.mjs";
import { sanitizeDiagnosticMessage } from "../acp-diagnostics.mjs";
import { buildStandardMcpServers } from "../mcp-servers.mjs";

// ─── Binary resolution ────────────────────────────────────────────────────────
//
// Cursor ships its agent CLI as a .cmd wrapper on Windows. We try:
//   1. CURSOR_AGENT_PATH env var (user override)
//   2. `where agent` / `which agent` via the shell
//   3. Well-known Windows fallback path

const CURSOR_AGENT_WINDOWS_FALLBACK =
  "C:/Users/" +
  (process.env.USERNAME ?? process.env.USER ?? "WalshLab") +
  "/AppData/Local/cursor-agent/agent.cmd";

function findCursorBinary() {
  // User override always wins.
  if (process.env.CURSOR_AGENT_PATH) {
    return process.env.CURSOR_AGENT_PATH.replace(/\\/g, "/");
  }

  // Try `where` (Windows) / `which` (Unix) to find the binary on PATH.
  const whereCmd = process.platform === "win32" ? "where agent" : "which agent";
  try {
    const found = execSync(whereCmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      .split(/\r?\n/)
      .filter(Boolean)[0];
    if (found) {
      return found.replace(/\\/g, "/");
    }
  } catch {
    // Not on PATH — fall through to hardcoded Windows path.
  }

  if (process.platform === "win32") {
    return CURSOR_AGENT_WINDOWS_FALLBACK;
  }

  // Non-Windows: return plain name and trust PATH.
  return "agent";
}

// ─── Role-to-prompt-prefix mapping ───────────────────────────────────────────
//
// Cursor interprets slash commands (/plan, /debug, /ask) embedded in the
// prompt text. The `writer` role uses Agent mode (the default — no prefix).

/**
 * Prepend the Cursor slash-command prefix for the given role.
 *
 * @param {string} role  — "writer" | "planner" | "debugger" | "ask" | other
 * @param {string} userTask
 * @returns {string}
 */
function buildPrompt(role, userTask) {
  const prefix = {
    planner: "/plan ",
    debugger: "/debug ",
    ask: "/ask "
  }[role] ?? "";
  return prefix + userTask;
}

// ─── Stream event helpers ─────────────────────────────────────────────────────

function emitStreamEvent(onStream, event) {
  if (!onStream) return;
  try {
    onStream(event);
  } catch {
    // Best-effort.
  }
}

// ─── Notification dispatch ────────────────────────────────────────────────────

function createNotificationSinks() {
  return {
    textChunks: [],
    chunkCount: 0,
    chunkChars: 0,
    toolCalls: [],
    fileChanges: [],
    events: []
  };
}

function dispatchOneNotification(notification, sinks, onStream) {
  const update = notification?.params?.update;
  if (!update) return;

  if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
    const text = String(update.content.text ?? "");
    sinks.textChunks.push(text);
    sinks.chunkCount += 1;
    sinks.chunkChars += text.length;
    const ev = { type: "message_chunk", text };
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  } else if (update.sessionUpdate === "tool_call") {
    sinks.toolCalls.push({
      name: update.toolName ?? update.name ?? "unknown",
      arguments: update.arguments ?? update.input ?? {},
      result: update.result ?? undefined
    });
    const ev = {
      type: "tool_call",
      toolName: sanitizeDiagnosticMessage(update.toolName ?? update.name ?? "unknown") || "unknown"
    };
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  } else if (update.sessionUpdate === "file_change") {
    sinks.fileChanges.push({
      path: update.path ?? "",
      action: update.action ?? "modify"
    });
    const ev = {
      type: "file_change",
      path: sanitizeDiagnosticMessage(update.path ?? ""),
      action: sanitizeDiagnosticMessage(update.action ?? "modify") || "modify"
    };
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  }
}

// ─── Availability & Auth ──────────────────────────────────────────────────────

/**
 * Check whether the Cursor agent CLI binary is available.
 *
 * @returns {{ available: boolean, detail: string, version: string | null }}
 */
export function getCursorAvailability() {
  const cli = findCursorBinary();
  try {
    const version = execSync(`"${cli}" --version`, {
      encoding: "utf8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000
    }).trim();
    return { available: true, detail: `agent ${version}`, version };
  } catch (err) {
    return {
      available: false,
      detail: `Cursor agent CLI not found (tried: ${cli}). Error: ${String(err.message ?? err)}`,
      version: null
    };
  }
}

/**
 * Check Cursor authentication status via `agent status`.
 *
 * @returns {{ authenticated: boolean, loggedIn: boolean, method: string | null, detail: string }}
 */
export function getCursorAuthStatus() {
  const cli = findCursorBinary();
  try {
    const output = execSync(`"${cli}" status`, {
      encoding: "utf8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10000
    });
    const lower = output.toLowerCase();
    // Look for common "not signed in" / "not logged in" indicators.
    const notSignedIn =
      lower.includes("not signed in") ||
      lower.includes("not logged in") ||
      lower.includes("unauthenticated") ||
      lower.includes("please sign in");
    if (notSignedIn) {
      return { authenticated: false, loggedIn: false, method: null, detail: output.trim() };
    }
    return { authenticated: true, loggedIn: true, method: "cursor-account", detail: output.trim() };
  } catch (err) {
    return {
      authenticated: false,
      loggedIn: false,
      method: null,
      detail: String(err.message ?? err)
    };
  }
}

// ─── ACP Operations ───────────────────────────────────────────────────────────

/**
 * Run a prompt through Cursor ACP and capture the result.
 *
 * @param {string} cwd
 * @param {string} prompt  — should already have role prefix applied via buildPrompt()
 * @param {{ model?: string, role?: string, sessionId?: string, env?: NodeJS.ProcessEnv, onNotification?: (n: any) => void, onStream?: (event: any) => void }} [options]
 * @returns {Promise<{ sessionId: string | null, text: string, chunkCount: number, chunkChars: number, toolCalls: Array<any>, fileChanges: Array<any>, error: unknown }>}
 */
export async function runAcpPromptCursor(cwd, prompt, options = {}) {
  const sinks = createNotificationSinks();
  const role = options.role ?? "writer";
  const fullPrompt = buildPrompt(role, prompt);

  const notificationHandler = (notification) => {
    dispatchOneNotification(notification, sinks, options.onStream);
    if (options.onNotification) {
      options.onNotification(notification);
    }
  };

  const diagnosticHandler = (payload) => {
    if (options.onDiagnostic) {
      try {
        options.onDiagnostic(payload);
      } catch {
        // Best-effort.
      }
    }
  };

  const cli = findCursorBinary();
  const client = new SpawnedAcpClient(cwd, {
    command: cli,
    // --yolo (alias for --force): force-allow commands without per-tool prompts.
    // --approve-mcps: auto-approve MCP server tools.
    // Note: as of Cursor 2026.04.17 these flags don't fix the Terminal-tool
    // hang in agent acp mode (Cursor's `execute` tool sticks at in_progress
    // and never sends terminal/* or session/request_permission to us).
    // Keeping them anyway because they match the plugin's max-permission
    // posture and will help once Cursor closes that gap.
    args: ["--yolo", "--approve-mcps", "acp"],
    env: options.env ?? process.env,
    onNotification: notificationHandler,
    onDiagnostic: diagnosticHandler,
    onRequest: buildAutoApproveRequestHandler()
  });

  const mcpServers = buildStandardMcpServers();

  try {
    await client.initialize();

    let sessionId = options.sessionId ?? null;
    if (sessionId) {
      await client.request("session/load", { sessionId, cwd, mcpServers });
    } else {
      const session = await client.request("session/new", { cwd, mcpServers });
      sessionId = session?.sessionId ?? null;
    }

    // Explicitly set the ACP mode based on the role. Map:
    //   writer / debugger → "agent" (full tool access)
    //   planner           → "plan"  (Plan mode, read-only design)
    //   ask               → "ask"   (read-only Q&A)
    {
      const role = options.role ?? "writer";
      const modeId =
        role === "planner" ? "plan" :
        role === "ask" ? "ask" :
        "agent";
      try {
        await client.request("session/set_mode", { sessionId, modeId });
      } catch (error) {
        process.stderr.write(`Warning: could not set Cursor mode to ${modeId}: ${error?.message ?? error}\n`);
      }
    }

    if (options.model) {
      try {
        await client.request("session/set_model", { sessionId, modelId: options.model });
      } catch (error) {
        process.stderr.write(`Warning: could not set model to ${options.model}: ${error?.message ?? error}\n`);
      }
    }

    const result = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: fullPrompt }]
    });

    const text = sinks.textChunks.join("");

    return {
      sessionId,
      text,
      chunkCount: sinks.chunkCount,
      chunkChars: sinks.chunkChars,
      toolCalls: sinks.toolCalls,
      fileChanges: sinks.fileChanges,
      error: null
    };
  } catch (error) {
    return {
      sessionId: null,
      text: sinks.textChunks.join(""),
      chunkCount: sinks.chunkCount,
      chunkChars: sinks.chunkChars,
      toolCalls: sinks.toolCalls,
      fileChanges: sinks.fileChanges,
      error
    };
  } finally {
    await client.close();
  }
}

/**
 * Interrupt an active Cursor ACP session (best-effort; Cursor may not implement cancel).
 *
 * @param {string} jobId
 * @returns {Promise<{ attempted: boolean, interrupted: boolean, transport: string | null, detail: string }>}
 */
export async function interruptAcpPromptCursor(jobId) {
  // Cursor ACP does not currently expose a cancel endpoint; return a no-op result.
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: `Cancel not implemented for Cursor ACP (jobId: ${jobId}).`
  };
}

// ─── Generic adapter interface ────────────────────────────────────────────────

export const adapter = {
  name: "cursor",
  isAvailable: getCursorAvailability,
  isAuthenticated: getCursorAuthStatus,
  invoke: runAcpPromptCursor,
  cancel: interruptAcpPromptCursor,
  getSession: undefined
};
