import type { NodeRouteStateVO } from "busabase-contract/contract/node-route-state-schemas";

/**
 * How the dashboard reads `nodes.resolveRouteState` while rendering a node URL.
 *
 * Both predicates key on the RESOLVED state and deliberately ignore
 * `isFetching`. The route-state query is invalidated by any node merge (see
 * `live-invalidation.ts`), so treating a background revalidation like a first
 * load would tear down an open page every time an unrelated node changed —
 * losing a Doc's in-progress `draft` and an AirApp's live iframe. A refetch
 * keeps serving the previous answer, the same way `shouldShowInitialLoadingState`
 * holds the Base route steady.
 */

/** Skeleton only until the guard has answered once (`undefined` = no answer yet). */
export const shouldShowRouteGuardSkeleton = (state: NodeRouteStateVO | undefined): boolean =>
  state == null;

/**
 * Whether the resident (keep-alive) AirApp host may mount a slug.
 *
 * Requires a resolved `active`: the host keeps its iframe alive across
 * navigation, so mounting on an unresolved state is exactly what would let an
 * archived URL keep a running view. A newly selected slug has its own query
 * key, so it starts unresolved and stays unmounted until it resolves.
 */
export const shouldMountResidentAirApp = (
  isAirappRoute: boolean,
  state: NodeRouteStateVO | undefined,
): boolean => isAirappRoute && state?.status === "active";
