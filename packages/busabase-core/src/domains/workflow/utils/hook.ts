/**
 * Incoming webhooks: what a workflow sees of the request that started it, and
 * what goes back to the caller. Pure, so the route, the runtime, and the tests
 * share one reading of both.
 */

/** Bodies larger than this are refused before a run starts. */
export const WORKFLOW_HOOK_MAX_BODY_BYTES = 256 * 1024;

/** A workflow with this many runs already queued turns new requests away (429). */
export const WORKFLOW_HOOK_MAX_QUEUED = 200;

/**
 * Credentials are never stored on a run: anyone who can read the workflow can
 * read its runs. Signatures (`x-hub-signature-256`, ...) are kept, so code can
 * check them.
 */
const DROPPED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization"]);
const MAX_HEADERS = 50;

export interface WorkflowHookRequest {
  method: string;
  /** Query string values; a repeated key keeps its last value. */
  query: Record<string, string>;
  /** Lower-case names, without credentials. */
  headers: Record<string, string>;
  /** Parsed JSON when the body is JSON, the text otherwise, `null` when empty. */
  body: unknown;
  receivedAt: string;
}

export const buildWorkflowHookRequest = (input: {
  method: string;
  url: string;
  headers: Iterable<[string, string]>;
  bodyText: string;
  receivedAt: Date;
}): WorkflowHookRequest => {
  const headers: Record<string, string> = {};
  for (const [name, value] of input.headers) {
    const key = name.toLowerCase();
    if (DROPPED_HEADERS.has(key)) continue;
    if (Object.keys(headers).length >= MAX_HEADERS) break;
    headers[key] = value;
  }
  const query: Record<string, string> = {};
  for (const [key, value] of new URL(input.url).searchParams) query[key] = value;
  return {
    method: input.method.toUpperCase(),
    query,
    headers,
    body: parseBody(input.bodyText, headers["content-type"] ?? ""),
    receivedAt: input.receivedAt.toISOString(),
  };
};

const parseBody = (text: string, contentType: string): unknown => {
  if (!text) return null;
  const looksJson = contentType.includes("json") || /^\s*[{[]/.test(text);
  if (looksJson) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
};

export interface WorkflowHookResponse {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Content types a step may answer with. Never HTML: the answer is served from
 * the app's own origin, and HTML there could run script as the app.
 */
const ALLOWED_CONTENT_TYPES = ["application/json", "text/plain", "application/xml", "text/xml"];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The answer a step chose, from the latest step whose output has `response`:
 * either the body itself, or `{ status, contentType, body }`. A string body is
 * sent as text, anything else as JSON. Null when no step chose one.
 */
export const pickWorkflowHookResponse = (
  outputs: Record<string, { sequence?: number; data: Record<string, unknown> }>,
): WorkflowHookResponse | null => {
  const chosen = Object.values(outputs)
    .filter((output) => output.data.response !== undefined)
    .sort((left, right) => (right.sequence ?? 0) - (left.sequence ?? 0))[0];
  if (!chosen) return null;
  const response = chosen.data.response;
  const structured =
    isPlainObject(response) &&
    ("body" in response || "status" in response || "contentType" in response);
  const body = structured ? response.body : response;
  const status =
    structured &&
    typeof response.status === "number" &&
    Number.isInteger(response.status) &&
    response.status >= 200 &&
    response.status <= 599
      ? response.status
      : 200;
  const asked =
    structured && typeof response.contentType === "string"
      ? response.contentType.split(";")[0]?.trim().toLowerCase()
      : undefined;
  if (typeof body === "string") {
    const contentType = asked && ALLOWED_CONTENT_TYPES.includes(asked) ? asked : "text/plain";
    return { status, contentType: `${contentType}; charset=utf-8`, body };
  }
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body ?? null),
  };
};

/** A new random token for a trigger's URL: 32 URL-safe characters. */
export const newWorkflowHookToken = (): string => {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
