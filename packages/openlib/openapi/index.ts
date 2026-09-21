/**
 * Shared OpenAPI generation helpers for every oRPC contract in the monorepo.
 *
 * This lives in `openlib` rather than in one app because the rule it encodes —
 * which procedures belong on a REST surface — is a property of the oRPC
 * contract format, not of any one product. `busabase-core`, `sandock-core` and
 * all seven Next.js apps already depend on `openlib`, so this is the lowest
 * layer all of them can reach without any of them importing each other.
 */

/**
 * A procedure with no `.route({ path })` is RPC-only by convention.
 *
 * These are the long-lived Event Iterators and UI-plumbing calls
 * (`live.subscribe`, `airapps.runLocal`, `spaces.members`, …) that are typed
 * for `/api/rpc` but are not REST-shaped. Without excluding them the generator
 * invents a path from the procedure name, and they surface as REST endpoints
 * (and, in turn, as MCP tools) that no client can meaningfully call.
 *
 * Note that a procedure declared without `.route(...)` still carries
 * `route: {}` — an empty object, which is truthy — so the check has to look at
 * `path` itself, not at the presence of `route`.
 *
 * Pass it straight to the generator:
 *
 * ```ts
 * await generator.generate(contract, { exclude: (c) => isRpcOnly(c), ... });
 * ```
 */
export const isRpcOnly = (contract: unknown): boolean =>
  !(contract as { "~orpc"?: { route?: { path?: string } } })?.["~orpc"]?.route?.path;
