/**
 * The one `/api/v1` error envelope: `{ error, code, data }`.
 *
 * Both servers mount the same contract, so an SDK or agent talking to either
 * one has to see the same error shape. They had drifted — this module exists so
 * there is a single definition to drift from.
 *
 * All three fields carry weight:
 * - `error` — the human-readable message.
 * - `code` — the semantic outcome (`NOT_FOUND`, `FORBIDDEN`, …). Without it
 *   busabase-sdk's `decodeBusabaseError` falls back to `HTTP_<status>`, so
 *   consumers branching on the documented codes silently never match.
 * - `data` — a validation failure's field-level `issues`. Without it a 400 is
 *   just "Input validation failed" with no indication of WHICH field: the SDK
 *   has a whole branch to render those issues that could never fire, and an
 *   agent has nothing to self-correct from.
 *
 * `tests/openapi-error-envelope.test.ts` pins the shape here;
 * `apps/busabase-cloud/tests/openapi-error-envelope.test.ts` pins it again over
 * a real HTTP round-trip.
 */
export const encodeBusabaseOpenApiError = (error: {
  data?: unknown;
  message?: string;
  code?: string;
}) => {
  // A handler that shaped its own `{ error, … }` body keeps that body — but
  // `code` is merged back in. Returning such a body completely verbatim is how
  // errors used to lose their code: a handler would set `data.error` to a copy
  // of its own message, which routed it through this branch and silently
  // stripped the code on the way out. The handler's own fields still win on
  // conflict, so merging can only add information, never overwrite it.
  if (error.data && typeof error.data === "object" && "error" in error.data) {
    return { code: error.code, ...error.data };
  }

  return {
    error: error.message || "Internal server error",
    code: error.code,
    data: error.data,
  };
};
