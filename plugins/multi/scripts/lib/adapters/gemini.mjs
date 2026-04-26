/**
 * Gemini adapter — core functions for availability checks, auth status, and
 * running prompts through the Gemini ACP (Agent Client Protocol).
 *
 * Adapted from gemini-plugin-cc (https://github.com/sakibsadmanshajib/gemini-plugin-cc)
 * for use inside cc-multi-cli-plugin. Moved from scripts/lib/ to
 * scripts/lib/adapters/, so relative imports use "../" instead of "./".
 *
 * Differences from the upstream gemini.mjs:
 * - job-observability is stubbed (recordObserverEvent is a no-op); the
 *   incompatible state.mjs interface makes the full telemetry pipeline
 *   non-trivial to wire — deferred to Phase H polish.
 * - runAcpReview / runAcpAdversarialReview omitted; they depend on a
 *   different collectReviewContext signature (Gemini vs Codex git.mjs).
 *   Deferred to Phase D/H when the git adapter divergence is resolved.
 */

import process from "node:process";
import { BROKER_ENDPOINT_ENV, buildAutoApproveRequestHandler, GeminiAcpClient } from "../acp-client.mjs";
import { sanitizeDiagnosticMessage } from "../acp-diagnostics.mjs";
import { loadBrokerSession } from "../gemini-broker-lifecycle.mjs";
import { buildStandardMcpServers } from "../mcp-servers.mjs";
import { binaryAvailable, runCommand } from "../process.mjs";
import { resolveThinkingConfig } from "../thinking.mjs";

// ─── Diagnostic helpers ───────────────────────────────────────────────────────

// job-observability integration is deferred (state.mjs interface mismatch).
// All calls to recordObserverEvent are best-effort telemetry; this no-op is safe.
function recordObserverEvent(_observer, _event) {
  // no-op — Phase H will wire up job-observability once state.mjs is unified
}

let thinkingWarned = false;

/**
 * Convert an ACP session/update notification into a job-observability event.
 * Returns null when the notification is not a session update.
 */
export function buildJobEventFromAcpNotification(notification) {
  const update = notification?.params?.update;
  if (!update) {
    return null;
  }
  const kind = update.sessionUpdate;
  if (kind === "agent_message_chunk") {
    const text = update.content?.text ?? "";
    return { type: "model_text_chunk", chars: String(text).length };
  }
  if (kind === "agent_thought_chunk") {
    const text = update.content?.text ?? "";
    return { type: "model_thought_chunk", chars: String(text).length };
  }
  if (kind === "tool_call") {
    return {
      type: "tool_call",
      toolName: sanitizeDiagnosticMessage(update.toolName ?? update.name ?? "unknown")
    };
  }
  if (kind === "file_change") {
    return {
      type: "file_change",
      path: sanitizeDiagnosticMessage(update.path ?? ""),
      action: sanitizeDiagnosticMessage(update.action ?? "modify")
    };
  }
  return {
    type: "acp_notification",
    message: sanitizeDiagnosticMessage(kind ?? "")
  };
}

/**
 * Shape a broker diagnostic payload as a classification-ready job event.
 */
export function formatBrokerDiagnostic({ source, message }) {
  return {
    type: "diagnostic",
    source: sanitizeDiagnosticMessage(source ?? "broker"),
    message: sanitizeDiagnosticMessage(message)
  };
}

// ─── Stream event helpers ─────────────────────────────────────────────────────

function emitStreamEvent(onStream, event) {
  if (!onStream) return;
  try {
    onStream(event);
  } catch {
    // Best-effort live output must not interrupt ACP handling.
  }
}

function buildThoughtStreamEvent(text, includeText) {
  const normalized = String(text ?? "");
  const event = { type: "thought_chunk", chars: normalized.length };
  if (includeText) {
    event.text = normalized;
  }
  return event;
}

function buildToolStreamEvent(update) {
  return {
    type: "tool_call",
    toolName: sanitizeDiagnosticMessage(update.toolName ?? update.name ?? "unknown") || "unknown"
  };
}

function buildFileStreamEvent(update) {
  return {
    type: "file_change",
    path: sanitizeDiagnosticMessage(update.path ?? ""),
    action: sanitizeDiagnosticMessage(update.action ?? "modify") || "modify"
  };
}

function emitThinkingWarningIfNew(writer = (s) => process.stderr.write(s)) {
  if (thinkingWarned) {
    return;
  }
  writer(
    "Warning: --thinking is parsed but not delivered to the running Gemini CLI. " +
    "Configure thinkingConfig at the model-alias level in your Gemini settings.json " +
    "for a persistent setting. See " +
    "https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/generation-settings.md\n"
  );
  thinkingWarned = true;
}

function resetThinkingWarning() {
  thinkingWarned = false;
}

// ─── Notification dispatch ────────────────────────────────────────────────────

function createNotificationSinks() {
  return {
    textChunks: [],
    chunkCount: 0,
    chunkChars: 0,
    thoughtCount: 0,
    thoughtChars: 0,
    toolCalls: [],
    fileChanges: [],
    events: []
  };
}

function dispatchOneNotification(notification, sinks, onStream, options = {}) {
  const update = notification?.params?.update;
  if (!update) return;
  const streamThoughtText = options.streamThoughtText === true;

  if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
    const text = String(update.content.text ?? "");
    sinks.textChunks.push(text);
    sinks.chunkCount += 1;
    sinks.chunkChars += text.length;
    const ev = { type: "message_chunk", text };
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  } else if (update.sessionUpdate === "agent_thought_chunk" && update.content?.type === "text") {
    const text = String(update.content.text ?? "");
    sinks.thoughtCount += 1;
    sinks.thoughtChars += text.length;
    const ev = buildThoughtStreamEvent(text, streamThoughtText);
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  } else if (update.sessionUpdate === "tool_call") {
    sinks.toolCalls.push({
      name: update.toolName ?? update.name ?? "unknown",
      arguments: update.arguments ?? update.input ?? {},
      result: update.result ?? undefined
    });
    const ev = buildToolStreamEvent(update);
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  } else if (update.sessionUpdate === "file_change") {
    sinks.fileChanges.push({
      path: update.path ?? "",
      action: update.action ?? "modify"
    });
    const ev = buildFileStreamEvent(update);
    sinks.events?.push(ev);
    emitStreamEvent(onStream, ev);
  }
}

// ─── Availability & Auth ──────────────────────────────────────────────────────

/**
 * Check whether the Gemini CLI binary is available on PATH.
 *
 * @returns {{ available: boolean, detail: string, version: string | null }}
 */
export function getGeminiAvailability() {
  const result = binaryAvailable("gemini", ["--version"]);
  if (!result.available) {
    return { available: false, detail: result.detail ?? "gemini CLI not found on PATH.", version: null };
  }

  const versionResult = runCommand("gemini", ["--version"]);
  const version = versionResult.status === 0 ? versionResult.stdout.trim() : null;
  return {
    available: true,
    detail: version ? `gemini ${version}` : "gemini CLI available",
    version
  };
}

/**
 * Check Gemini authentication status.
 * Tries env-var checks first, then falls back to ACP handshake.
 *
 * @param {string} cwd
 * @returns {Promise<{ authenticated: boolean, loggedIn: boolean, method: string | null, detail: string }>}
 */
export async function getGeminiAuthStatus(cwd) {
  if (process.env.GEMINI_API_KEY) {
    return { authenticated: true, loggedIn: true, method: "api_key", detail: "GEMINI_API_KEY is set." };
  }

  if (process.env.GOOGLE_API_KEY) {
    return { authenticated: true, loggedIn: true, method: "google_api_key", detail: "GOOGLE_API_KEY is set." };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return { authenticated: true, loggedIn: true, method: "service_account", detail: "GOOGLE_APPLICATION_CREDENTIALS is set." };
  }

  try {
    const client = await GeminiAcpClient.connect(cwd, { disableBroker: true });
    try {
      const authMethods = client.capabilities?.authMethods ?? [];
      const methodOrder = ["oauth-personal", "gemini-api-key", "vertex-ai", "cloud-shell", "compute-default-credentials", "gateway"];
      const available = methodOrder.filter((m) => authMethods.some((am) => am.id === m));

      for (const methodId of available) {
        try {
          const result = await client.request("authenticate", { methodId });
          if (result && result.authenticated !== false) {
            return { authenticated: true, loggedIn: true, method: methodId, detail: `Authenticated via ${methodId}.` };
          }
        } catch {
          continue;
        }
      }

      return { authenticated: false, loggedIn: false, method: null, detail: "No Gemini authentication method succeeded." };
    } finally {
      await client.close();
    }
  } catch (error) {
    return {
      authenticated: false,
      loggedIn: false,
      method: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Get the runtime status of the current ACP broker session.
 *
 * @param {NodeJS.ProcessEnv | undefined} env
 * @param {string} cwd
 * @returns {{ brokerRunning: boolean, endpoint: string | null }}
 */
export function getSessionRuntimeStatus(env, cwd) {
  const session = loadBrokerSession(cwd);
  const endpoint = session?.endpoint ?? env?.[BROKER_ENDPOINT_ENV] ?? process.env[BROKER_ENDPOINT_ENV] ?? null;
  return {
    brokerRunning: Boolean(session),
    endpoint
  };
}

// ─── ACP Operations ───────────────────────────────────────────────────────────

/**
 * Run a prompt through Gemini ACP and capture the result.
 *
 * @param {string} cwd
 * @param {string} prompt
 * @param {{ model?: string, thinkingBudget?: number, thinking?: "off"|"low"|"medium"|"high", approvalMode?: string, sessionId?: string, env?: NodeJS.ProcessEnv, onNotification?: (n: any) => void, onStream?: (event: any) => void, streamThoughtText?: boolean, jobObserver?: { workspaceRoot: string, jobId: string } | null }} [options]
 * @returns {Promise<{ sessionId: string | null, text: string, chunkCount: number, chunkChars: number, thoughtText: string, thoughtCount: number, thoughtChars: number, model: string | null, usage: any, toolCalls: Array<any>, fileChanges: Array<any>, error: unknown }>}
 */
export async function runAcpPrompt(cwd, prompt, options = {}) {
  const sinks = createNotificationSinks();
  const observer = options.jobObserver && options.jobObserver.workspaceRoot && options.jobObserver.jobId
    ? options.jobObserver
    : null;

  const notificationHandler = (notification) => {
    dispatchOneNotification(notification, sinks, options.onStream, {
      streamThoughtText: options.streamThoughtText === true
    });

    recordObserverEvent(observer, buildJobEventFromAcpNotification(notification));

    if (options.onNotification) {
      options.onNotification(notification);
    }
  };

  const diagnosticHandler = (payload) => {
    recordObserverEvent(observer, formatBrokerDiagnostic(payload));
    if (options.onDiagnostic) {
      try {
        options.onDiagnostic(payload);
      } catch {
        // Best-effort.
      }
    }
  };

  const client = await GeminiAcpClient.connect(cwd, {
    // disableBroker: Phase H empirical testing found the broker path hangs with
    // "ACP process is not ready" on Windows. Direct-spawn fallback works fine.
    // Re-enable the broker after its startup flow is debugged.
    disableBroker: true,
    env: options.env,
    onNotification: notificationHandler,
    onDiagnostic: diagnosticHandler,
    onRequest: buildAutoApproveRequestHandler()
  });

  const mcpServers = buildStandardMcpServers();

  try {
    let sessionId = options.sessionId ?? null;
    if (sessionId) {
      await client.request("session/load", { sessionId, cwd, mcpServers });
      recordObserverEvent(observer, { type: "phase", message: "session_loaded" });
      emitStreamEvent(options.onStream, { type: "phase", message: "session_loaded" });
    } else {
      const session = await client.request("session/new", {
        cwd,
        mcpServers
      });
      sessionId = session?.sessionId ?? null;
      recordObserverEvent(observer, { type: "phase", message: "session_created" });
      emitStreamEvent(options.onStream, { type: "phase", message: "session_created" });
    }

    {
      const modeMap = { auto_edit: "autoEdit", default: "default", yolo: "yolo", plan: "plan" };
      const modeId = modeMap[options.approvalMode ?? "auto_edit"] ?? options.approvalMode;
      try {
        await client.request("session/set_mode", { sessionId, modeId });
      } catch (error) {
        process.stderr.write(`Warning: could not set mode to ${modeId}: ${error?.message ?? error}\n`);
      }
    }

    if (options.model) {
      try {
        await client.request("session/set_model", { sessionId, modelId: options.model });
      } catch (error) {
        process.stderr.write(`Warning: could not set model to ${options.model}: ${error?.message ?? error}\n`);
      }
    }

    if (options.thinking !== undefined) {
      resolveThinkingConfig(options.thinking, options.model ?? null);
      recordObserverEvent(observer, { type: "phase", message: `thinking:${options.thinking}` });
      emitStreamEvent(options.onStream, { type: "phase", message: sanitizeDiagnosticMessage(`thinking:${options.thinking}`) });
      emitThinkingWarningIfNew();
    }

    const result = await client.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }]
    });

    const text = sinks.textChunks.join("");
    const usage = result?._meta?.quota?.token_count ?? null;

    return {
      sessionId,
      text,
      chunkCount: sinks.chunkCount,
      chunkChars: sinks.chunkChars,
      thoughtText: "",
      thoughtCount: sinks.thoughtCount,
      thoughtChars: sinks.thoughtChars,
      model: result?._meta?.quota?.model_usage?.[0]?.model ?? options.model ?? null,
      usage,
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
      thoughtText: "",
      thoughtCount: sinks.thoughtCount,
      thoughtChars: sinks.thoughtChars,
      model: null,
      usage: null,
      toolCalls: sinks.toolCalls,
      fileChanges: sinks.fileChanges,
      error
    };
  } finally {
    await client.close();
  }
}

/**
 * Interrupt an active ACP prompt.
 *
 * @param {string} cwd
 * @param {{ sessionId?: string, env?: NodeJS.ProcessEnv }} [options]
 * @returns {Promise<{ attempted: boolean, interrupted: boolean, transport: string | null, detail: string }>}
 */
export async function interruptAcpPrompt(cwd, options = {}) {
  try {
    const client = await GeminiAcpClient.connect(cwd, {
      reuseExistingBroker: true,
      env: options.env
    });
    try {
      client.notify("session/cancel", {
        sessionId: options.sessionId
      });
      return { attempted: true, interrupted: true, transport: client.transport, detail: "Session cancel notification sent." };
    } finally {
      await client.close();
    }
  } catch (error) {
    return {
      attempted: true,
      interrupted: false,
      transport: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Find the latest task session that can be resumed.
 *
 * @param {string} cwd
 * @returns {Promise<{ id: string, status: string } | null>}
 */
export async function findLatestTaskThread(cwd) {
  const { listJobs } = await import("../state.mjs");
  const jobs = listJobs(cwd);
  const taskJobs = jobs
    .filter((j) => j.kind === "task" && j.threadId)
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));

  if (taskJobs.length === 0) {
    return null;
  }

  return {
    id: taskJobs[0].threadId,
    status: taskJobs[0].status
  };
}

/**
 * Build a persistent task thread name for tracking.
 *
 * @param {string} taskText
 * @returns {string}
 */
export function buildPersistentTaskThreadName(taskText) {
  const truncated = taskText.slice(0, 80).replace(/\n/g, " ").trim();
  return `gemini-task: ${truncated}`;
}

/**
 * Default prompt for continuing a previous task.
 */
export const DEFAULT_CONTINUE_PROMPT = "Continue where you left off. If the previous task is complete, summarize the outcome.";

export const __testing = {
  emitThinkingWarningIfNew,
  resetThinkingWarning
};

// ─── Generic adapter interface ────────────────────────────────────────────────
//
// Exposes a standard shape so multi-cli-companion.mjs can dispatch
// uniformly through the ADAPTERS registry.
//
// Spec members:
//   name           — string identifier
//   isAvailable    — sync: () => { available, detail }
//   isAuthenticated — async: (cwd) => { authenticated, loggedIn, method, detail }
//   invoke         — async: primary turn function (maps to runAcpPrompt)
//   cancel         — async: interrupt an in-flight turn
//   getSession     — undefined for now (Gemini sessions are implicit per-prompt)

export const adapter = {
  name: "gemini",
  isAvailable: getGeminiAvailability,
  isAuthenticated: getGeminiAuthStatus,
  invoke: runAcpPrompt,
  cancel: interruptAcpPrompt,
  getSession: undefined
};
