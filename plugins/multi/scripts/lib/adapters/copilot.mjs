/**
 * Copilot adapter — availability checks, auth status, and running prompts
 * through GitHub Copilot CLI's ACP server (`copilot --acp --stdio`).
 *
 * The GitHub Copilot CLI is the `copilot` command (or `copilot.cmd` on
 * Windows), installed globally via `npm install -g @github/copilot`. It
 * speaks the same ACP JSON-RPC protocol as `gemini --acp` and Cursor's
 * `agent acp`. No additional SDK dependency is required.
 *
 * Slash-command roles are implemented by prepending the appropriate slash
 * prefix to the prompt text before sending it via ACP.
 */

import { execSync } from "node:child_process";
import process from "node:process";
import { SpawnedAcpClient } from "../acp-client.mjs";
import { sanitizeDiagnosticMessage } from "../acp-diagnostics.mjs";

// ─── Binary resolution ────────────────────────────────────────────────────────
//
// Copilot CLI is installed globally via npm and lives in the npm global bin
// directory. On Windows this is %APPDATA%\npm\copilot.cmd; on Unix it's
// `copilot` on PATH.

const COPILOT_WINDOWS_FALLBACK =
  (process.env.APPDATA ?? "C:/Users/" + (process.env.USERNAME ?? process.env.USER ?? "WalshLab") + "/AppData/Roaming") +
  "/npm/copilot.cmd";

function findCopilotBinary() {
  // User override always wins.
  if (process.env.COPILOT_CLI_PATH) {
    return process.env.COPILOT_CLI_PATH.replace(/\\/g, "/");
  }

  // Try `where` (Windows) / `which` (Unix) to find the binary on PATH.
  const whereCmd = process.platform === "win32" ? "where copilot" : "which copilot";
  try {
    const found = execSync(whereCmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] })
      .split(/\r?\n/)
      .filter(Boolean)[0];
    if (found) {
      return found.replace(/\\/g, "/");
    }
  } catch {
    // Not on PATH — fall through to platform-specific fallback.
  }

  if (process.platform === "win32") {
    return COPILOT_WINDOWS_FALLBACK;
  }

  // Non-Windows: return plain name and trust PATH.
  return "copilot";
}

// ─── Role-to-prompt-prefix mapping ───────────────────────────────────────────
//
// Copilot CLI interprets slash commands (/research, /review) embedded in
// the prompt text. Other roles fall through with no prefix.

/**
 * Prepend the Copilot slash-command prefix for the given role.
 *
 * @param {string} role  — "researcher" | "reviewer" | other
 * @param {string} userTask
 * @returns {string}
 */
function buildPrompt(role, userTask) {
  const prefix = {
    researcher: "/research ",
    reviewer: "/review ",
    planner: "/plan ",
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
 * Check whether the Copilot CLI binary is available.
 *
 * @returns {{ available: boolean, detail: string, version: string | null }}
 */
export function getCopilotAvailability() {
  const cli = findCopilotBinary();
  try {
    const version = execSync(`"${cli}" --version`, {
      encoding: "utf8",
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 8000
    }).trim();
    return { available: true, detail: `copilot ${version}`, version };
  } catch (err) {
    return {
      available: false,
      detail: `GitHub Copilot CLI not found (tried: ${cli}). Install with: npm install -g @github/copilot. Error: ${String(err.message ?? err)}`,
      version: null
    };
  }
}

/**
 * Check Copilot authentication status.
 *
 * Lightweight probe: if any of the known GitHub token env vars are set, we
 * assume the user is authenticated. Auth failures that slip through will
 * surface naturally when the first ACP prompt is sent.
 *
 * @returns {{ authenticated: boolean, loggedIn: boolean, method: string | null, detail: string }}
 */
export function getCopilotAuthStatus() {
  const tokenEnvVars = ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"];
  for (const envVar of tokenEnvVars) {
    if (process.env[envVar]) {
      return {
        authenticated: true,
        loggedIn: true,
        method: envVar,
        detail: `Authenticated via ${envVar} environment variable.`
      };
    }
  }

  // Fall back to checking binary availability — if copilot --version works,
  // the binary is installed and auth failures will surface on first use.
  const avail = getCopilotAvailability();
  if (avail.available) {
    return {
      authenticated: true,
      loggedIn: true,
      method: "copilot-cli",
      detail: `Copilot CLI available (${avail.version}). Auth will be confirmed on first use.`
    };
  }

  return {
    authenticated: false,
    loggedIn: false,
    method: null,
    detail: "Copilot CLI not found. Set COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN, or install the CLI."
  };
}

// ─── ACP Operations ───────────────────────────────────────────────────────────

/**
 * Run a prompt through Copilot ACP and capture the result.
 *
 * @param {string} cwd
 * @param {string} prompt  — should already have role prefix applied via buildPrompt()
 * @param {{ model?: string, role?: string, sessionId?: string, env?: NodeJS.ProcessEnv, onNotification?: (n: any) => void, onStream?: (event: any) => void }} [options]
 * @returns {Promise<{ sessionId: string | null, text: string, chunkCount: number, chunkChars: number, toolCalls: Array<any>, fileChanges: Array<any>, error: unknown }>}
 */
export async function runAcpPromptCopilot(cwd, prompt, options = {}) {
  const sinks = createNotificationSinks();
  const role = options.role ?? "default";
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

  const cli = findCopilotBinary();
  const client = new SpawnedAcpClient(cwd, {
    command: cli,
    args: ["--acp", "--stdio"],
    env: options.env ?? process.env,
    onNotification: notificationHandler,
    onDiagnostic: diagnosticHandler
  });

  try {
    await client.initialize();

    let sessionId = options.sessionId ?? null;
    if (sessionId) {
      await client.request("session/load", { sessionId, cwd, mcpServers: [] });
    } else {
      const session = await client.request("session/new", { cwd, mcpServers: [] });
      sessionId = session?.sessionId ?? null;
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
 * Interrupt an active Copilot ACP session (best-effort; Copilot may not implement cancel).
 *
 * @param {string} jobId
 * @returns {Promise<{ attempted: boolean, interrupted: boolean, transport: string | null, detail: string }>}
 */
export async function interruptAcpPromptCopilot(jobId) {
  // Copilot ACP does not currently expose a cancel endpoint; return a no-op result.
  return {
    attempted: false,
    interrupted: false,
    transport: null,
    detail: `Cancel not implemented for Copilot ACP (jobId: ${jobId}).`
  };
}

// ─── Generic adapter interface ────────────────────────────────────────────────

export const adapter = {
  name: "copilot",
  isAvailable: getCopilotAvailability,
  isAuthenticated: getCopilotAuthStatus,
  invoke: runAcpPromptCopilot,
  cancel: interruptAcpPromptCopilot,
  getSession: undefined
};
