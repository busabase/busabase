// NOTE: intentionally no `server-only` guard. This module is pulled into the
// drizzle schema import graph (via `db/space-column.ts`), and drizzle-kit's
// config loader cannot resolve the `server-only` throw. It is node-only
// (AsyncLocalStorage) and only ever imported by server code + the schema.

import { AsyncLocalStorage } from "node:async_hooks";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { type DemoUseCase, normalizeDemoUseCase } from "./demo/use-case";

/**
 * Request-scoped Busabase execution context.
 *
 * busabase-core is single-tenant by construction (a module-singleton `db`, no
 * `spaceId` on any table, a hard-coded local actor). To let a multi-tenant host
 * (`apps/busabase-cloud`) reuse the SAME logic without rewriting ~100 function
 * signatures, we thread `{ db, actorId, spaceId }` through an
 * `AsyncLocalStorage`:
 *
 * - `db`       — the host's own drizzle client, so busabase_* tables live in the
 *                host's Postgres (one DB, one migration story). When absent,
 *                `getDb()` falls back to busabase-core's local singleton.
 * - `actorId`  — the authenticated user id, used to attribute commits / change
 *                requests / comments / audit events. Falls back to the input's
 *                value (which itself defaults to a local sentinel).
 * - `spaceId`  — the active workspace; every row is tagged with it and every
 *                entry-point query is filtered by it. Falls back to
 *                `LOCAL_SPACE_ID` for the open-source single-tenant app.
 *
 * `apps/busabase` (open source) never sets a context, so all getters return their
 * local-mode defaults and behavior is unchanged.
 */

/** Loose drizzle type so each host's differently-typed client is assignable. */
export type BusabaseDatabase = PgDatabase<any, any, any>;

/**
 * Demo use-case selector carried by `?demo=…`. Defined once in `demo/use-case.ts`
 * (the single source of truth for the runtime list + this type); re-exported here
 * for the many `busabase-core/context` importers.
 */
export type { DemoUseCase };

/** Locale of the demo dataset the stateless demo serves. */
export type DemoLocale = "en" | "zh-CN";

export interface BusabaseContext {
  db?: BusabaseDatabase;
  actorId?: string;
  spaceId?: string;
  /** When true, the request is served by the stateless demo router (no DB). */
  isDemo?: boolean;
  /**
   * Raw `?demo` value selecting which slice of the shared seed to serve; only set
   * when `isDemo`. Stored verbatim (the openlib resolver doesn't know busabase's
   * use-cases) and validated into a `DemoUseCase` by `getContextDemoUseCase()`.
   */
  demoUseCase?: string | null;
  /** Which language the demo dataset is served in; only set when `isDemo`. */
  demoLocale?: DemoLocale;
}

/** Tenant id used by the single-tenant open-source app and as a safe default. */
export const LOCAL_SPACE_ID = "local";

const storage = new AsyncLocalStorage<BusabaseContext>();

/** Run `fn` with the given Busabase context bound for its entire async subtree. */
export function runWithBusabaseContext<T>(ctx: BusabaseContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The injected host db for the current request, or undefined in local mode. */
export function getContextDb(): BusabaseDatabase | undefined {
  return storage.getStore()?.db;
}

/** Active space id for the current request (defaults to the local tenant). */
export function getContextSpaceId(): string {
  return storage.getStore()?.spaceId ?? LOCAL_SPACE_ID;
}

/**
 * Resolve the acting user id: the context actor wins (cloud), otherwise the
 * caller-supplied value (open-source inputs carry their own local defaults).
 */
export function resolveActorId(inputActorId: string): string {
  return storage.getStore()?.actorId ?? inputActorId;
}

/** True when the current request is served by the stateless demo router. */
export function getContextIsDemo(): boolean {
  return storage.getStore()?.isDemo ?? false;
}

/**
 * Which slice of the shared seed the demo serves. Validates the raw stored `?demo`
 * value against the known use-cases (unknown / unset → full `"1"`).
 */
export function getContextDemoUseCase(): DemoUseCase {
  return normalizeDemoUseCase(storage.getStore()?.demoUseCase) ?? "1";
}

/** Language of the demo dataset for the current request (defaults to English). */
export function getContextDemoLocale(): DemoLocale {
  return storage.getStore()?.demoLocale ?? "en";
}
