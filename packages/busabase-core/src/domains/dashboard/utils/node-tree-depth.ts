/**
 * How many levels of the workspace node tree are fetched up front, before a
 * folder needs an explicit expand. Matches the server's own default
 * (`DEFAULT_NODE_LIST_DEPTH` in `packages/busabase-core/src/logic/nodes.ts`).
 *
 * Lives in its own file, separate from `hooks/use-node-tree.ts`, because it
 * has to be importable from BOTH sides of the client/server boundary: a
 * host's server-only SSR loader (e.g. `busabase-cloud`'s `runtime.ts`, marked
 * `"server-only"`) needs this exact value to seed the client query at, but
 * cannot import `use-node-tree.ts` itself — that file pulls in React and
 * `@tanstack/react-query` hooks, which a server-only module must never bundle.
 * Pure, no React, no `~/db` — safe on either side.
 */
export const NODE_TREE_PREFETCH_DEPTH = 2;
