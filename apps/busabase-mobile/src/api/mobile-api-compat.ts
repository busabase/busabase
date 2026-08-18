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
