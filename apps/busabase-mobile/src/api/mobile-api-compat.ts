import type { BusabaseClientOptions } from "busabase-contract/api-client/react-query";

type RpcFetch = NonNullable<BusabaseClientOptions["fetch"]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isLegacyCommit = (value: Record<string, unknown>): boolean =>
  !("payload" in value) &&
  isRecord(value.fields) &&
  typeof value.id === "string" &&
  typeof value.operation === "string" &&
  typeof value.message === "string" &&
  typeof value.author === "string" &&
  "parentCommitId" in value;

/** Keep a newer Mobile client readable while self-hosted/demo servers roll forward. */
export function normalizeLegacyCommitPayloads(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeLegacyCommitPayloads);
  }
  if (!isRecord(value)) {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, normalizeLegacyCommitPayloads(item)]),
  );
  if (isLegacyCommit(normalized)) {
    normalized.payload = normalized.fields;
  }
  return normalized;
}

export const createMobileCompatibilityFetch =
  (fetchImpl: typeof globalThis.fetch): RpcFetch =>
  async (request, init) => {
    const response = await fetchImpl(request, init);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return response;
    }

    const text = await response.text();
    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    try {
      const normalized = normalizeLegacyCommitPayloads(JSON.parse(text));
      return new Response(JSON.stringify(normalized), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch {
      return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }
  };

/**
 * True when the server answered "there is no such procedure", i.e. it predates
 * the route this build calls.
 *
 * Mobile ships through the App Store on its own schedule, so a current build is
 * routinely pointed at a self-hosted server that is months behind it. A caller
 * that cannot tell "this route does not exist here" apart from "this call
 * failed" has to choose between never adopting a new endpoint and breaking
 * every older server — so each new-endpoint call site pairs this with the older
 * path it replaced.
 *
 * Decided on the oRPC error CODE and HTTP status ONLY, never on the message.
 * Message matching looks more forgiving and is actively wrong here: a real
 * install failure reads "GitHub repo or ref not found: acme/thing (HTTP 404)"
 * and would be read as a missing route, sending the caller to replay the
 * request on a legacy route that is about to fail the same way. Against a
 * running server the two are cleanly separable — an absent route is
 * `NOT_FOUND` / 404, while that install failure is `BAD_REQUEST` / 400 — so the
 * narrower test is also the accurate one.
 */
export const isMissingRouteError = (error: unknown): boolean => {
  if (!isRecord(error)) return false;
  return error.code === "NOT_FOUND" || error.status === 404;
};
