import { cloudContract } from "busabase-sdk";

/**
 * One walk of the oRPC contract, shared by everything that needs to enumerate
 * endpoints: the generated command tree (`run.ts`) and `busabase-cli schema`.
 *
 * Keeping a single walker matters because the two would otherwise disagree —
 * `schema` would describe an endpoint the CLI does not expose, or miss one it
 * does — and that drift is invisible until someone trusts the wrong answer.
 */

export interface ContractRoute {
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
  successDescription?: string;
}

export type ContractProcedure = {
  "~orpc": {
    route: ContractRoute;
    inputSchema?: unknown;
    outputSchema?: unknown;
  };
};

export interface CatalogEntry {
  /** Dotted contract path, e.g. `nodes.principals.list` — what `schema <id>` takes. */
  id: string;
  /** Contract group path leading to the procedure (`["nodes", "principals"]`). */
  navPath: string[];
  /** The procedure's own key (`list`). */
  key: string;
  proc: ContractProcedure;
}

export const isProcedure = (node: unknown): node is ContractProcedure =>
  typeof node === "object" &&
  node !== null &&
  typeof (node as { "~orpc"?: { route?: { method?: unknown } } })["~orpc"]?.route?.method ===
    "string";

/** `spaceId` → `space-id`. Shared so command names and `schema` agree. */
export const kebab = (value: string): string =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/** Depth-first walk of the contract tree, yielding every procedure it holds. */
export function* contractProcedures(
  node: Record<string, unknown> = cloudContract as unknown as Record<string, unknown>,
  navPath: string[] = [],
): Generator<CatalogEntry> {
  for (const key of Object.keys(node)) {
    if (key === "~orpc") continue;
    const child = node[key];
    if (isProcedure(child)) {
      yield { id: [...navPath, key].join("."), navPath, key, proc: child };
    } else if (child && typeof child === "object") {
      yield* contractProcedures(child as Record<string, unknown>, [...navPath, key]);
    }
  }
}

/**
 * The CLI command a contract procedure is reachable as: the top-level group plus
 * a leaf whose name folds any deeper contract groups into itself, so
 * `nodes.principals.list` is `busabase-cli nodes principals-list` (not a third
 * command level). Mirrors `addLeaf` in `run.ts`.
 *
 * This is the *generated* spelling. A curated task command may supersede it under
 * a friendlier name, which is why `schema` labels the field "generated command".
 */
export function generatedCommandPath(navPath: string[], key: string): string[] {
  if (navPath.length === 0) return [kebab(key)];
  return [kebab(navPath[0]), [...navPath.slice(1), key].map(kebab).join("-")];
}

/**
 * Resolve a live request back to the contract endpoint that serves it, so an
 * error can name the endpoint even when the command that failed was a curated
 * task (which may call several endpoints and therefore declares none).
 *
 * Matches the route's `{param}` segments positionally. When more than one route
 * fits, the one with the most *literal* segments matched wins, so a concrete
 * `/nodes/favorites` is never shadowed by a parameterized `/nodes/{nodeId}`.
 * Ties are impossible: two routes with identical literals at identical positions
 * and the same length are the same route.
 */
export function matchRoute(method: string, pathname: string): CatalogEntry | undefined {
  const wanted = pathname.split("?")[0].split("/").filter(Boolean);
  let best: { entry: CatalogEntry; literals: number } | undefined;
  for (const entry of contractProcedures()) {
    const { route } = entry.proc["~orpc"];
    if (route.method.toUpperCase() !== method.toUpperCase()) continue;
    const segments = route.path.split("/").filter(Boolean);
    if (segments.length !== wanted.length) continue;
    let literals = 0;
    const matches = segments.every((segment, index) => {
      if (segment.startsWith("{") && segment.endsWith("}")) return true;
      if (segment !== wanted[index]) return false;
      literals += 1;
      return true;
    });
    if (matches && (!best || literals > best.literals)) best = { entry, literals };
  }
  return best?.entry;
}
