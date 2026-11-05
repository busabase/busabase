import "server-only";

import { fetchWithSsrfGuard } from "../../webhook/logic/ssrf-guard";
import type { WorkflowWebhookCall, WorkflowWebhookCallResult } from "./runs";

/** A step's HTTP call never waits longer than this, whatever the workflow timeout says. */
const WEBHOOK_STEP_MAX_TIMEOUT_MS = 30_000;
/**
 * A JSON answer up to this size is kept whole and parsed, so the next
 * condition can read `input.body.<field>`. A JSON document cut in half is not
 * JSON any more, so the cap for JSON is larger than the one for plain text.
 */
const RESPONSE_JSON_MAX_CHARS = 32_000;
/** Any other answer (or JSON past the limit above) is kept as capped text. */
const RESPONSE_TEXT_CAP_CHARS = 4000;

const capText = (text: string): string =>
  text.length > RESPONSE_TEXT_CAP_CHARS
    ? `${text.slice(0, RESPONSE_TEXT_CAP_CHARS)}\n...[truncated]`
    : text;

const readBody = async (response: Response): Promise<unknown> => {
  const text = await response.text().catch(() => "");
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("json") && text && text.length <= RESPONSE_JSON_MAX_CHARS) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return capText(text);
    }
  }
  return capText(text);
};

/**
 * Send a workflow webhook step. One attempt — a step can be a POST that is
 * not safe to repeat — through the same SSRF guard as webhook rules, checked
 * on every redirect hop. The run's data is the JSON body; GET sends none.
 * A non-2xx answer is a failed step, but its status and body are kept so the
 * author can see what the receiver said.
 */
export const sendWorkflowWebhook = async (
  call: WorkflowWebhookCall,
): Promise<WorkflowWebhookCallResult> => {
  const startedAt = Date.now();
  const timeoutMs = Math.min(call.timeoutMs, WEBHOOK_STEP_MAX_TIMEOUT_MS);
  try {
    const fetched = await fetchWithSsrfGuard(call.url, {
      method: call.method,
      headers: {
        "content-type": "application/json",
        "user-agent": "Busabase-Workflow/1",
        "x-busabase-event": "workflow.step",
      },
      body: call.method === "GET" ? undefined : JSON.stringify(call.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (fetched.blocked) {
      return {
        ok: false,
        message: `Blocked: target ${fetched.reason} (SSRF protection)`,
        status: null,
        body: null,
        durationMs: Date.now() - startedAt,
      };
    }
    const { response } = fetched;
    const body = await readBody(response);
    const durationMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        message: `HTTP ${response.status}`,
        status: response.status,
        body,
        durationMs,
      };
    }
    return { ok: true, status: response.status, body, durationMs };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      message: timedOut
        ? `No answer within ${timeoutMs} ms`
        : error instanceof Error
          ? error.message
          : "Request failed",
      status: null,
      body: null,
      durationMs: Date.now() - startedAt,
    };
  }
};
