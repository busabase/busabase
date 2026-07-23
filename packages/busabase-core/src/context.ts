// NOTE: intentionally no `server-only` guard. This module is pulled into the
// drizzle schema import graph (via `db/space-column.ts`), and drizzle-kit's
// config loader cannot resolve the `server-only` throw. It is node-only
// (AsyncLocalStorage) and only ever imported by server code + the schema.

import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { UserRefVO } from "busabase-contract/types";
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

export type BusabaseSourceChannel =
  | "web_ui"
  | "browser"
  | "openapi"
  | "sdk"
  | "cli"
  | "mcp"
  | "skill"
  | "webhook"
  | "automation"
  | "import";

export interface BusabaseSourceProvenance {
  owner?: {
    id?: string | null;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  apiKey?: {
    id?: string | null;
    name?: string | null;
  };
  channel?: BusabaseSourceChannel | string | null;
}

export interface BusabaseContext {
  db?: BusabaseDatabase;
  actorId?: string;
  spaceId?: string;
  /**
   * Host-provided source attribution for writes in this request. Open source
   * leaves this unset; cloud uses it to stamp ChangeRequests/AuditEvents with
   * the owner user, API key name, and write channel.
   */
  sourceProvenance?: BusabaseSourceProvenance;
  /**
   * User-scoped Vault values exposed to the current request/runtime.
   *
   * This is intentionally context-scoped rather than written to the host
   * process.env: Busabase Cloud is a shared Node process, so per-user secrets
   * must only be exposed to the request / hosted execution they belong to.
   */
  vaultRuntimeEnv?: Record<string, string>;
  resolveUsers?: (userIds: string[]) => Promise<Map<string, UserRefVO>>;
  /**
   * Display name injected by the single-user open-source host. Cloud must not
   * set this; it resolves registered users through `resolveUsers`.
   */
  localUserName?: string | null;
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
  /**
   * Host hook: invoked (best-effort, errors swallowed by the caller) whenever a
   * change request freshly enters human review, so a multi-tenant host
   * (`apps/busabase-cloud`) can persist an inbox notification for whoever should
   * review it. The open-source host leaves this undefined — its reviewers get
   * the ephemeral desktop Notification via the live SSE event instead (see
   * `publishChangeRequestPendingReview` in `logic/live-events.ts`).
   */
  onChangeRequestPendingReview?: (args: {
    spaceId: string;
    baseId: string | null;
    changeRequestId: string;
    submittedBy: string;
  }) => void | Promise<void>;
  /**
   * Host-computed "the current actor is a space owner/admin" signal. Managers
   * short-circuit every node-ACL check to full (`manage`) access. Left unset
   * by the open-source single-user host — an ABSENT value means "treat as
   * manager" (no auth = no restriction, unchanged local behavior); a cloud
   * host must always set it explicitly (true or false). This is the
   * auth-agnostic seam: busabase-core never reads any members/role table,
   * the host resolves the role and injects one boolean.
   */
  isSpaceManager?: boolean;
  /**
   * Host-computed workspace permission baseline. Cloud maps owner/admin to
   * manage, member to changeRequest, and viewer to read. Missing means manage
   * for backward-compatible open-source/local execution.
   */
  permissionLevel?: ApiKeyPermissionLevel;
  /**
   * Host-computed "this space's default content visibility is restricted"
   * signal (`spaces.nodeVisibilityMode === "restricted"` on busabase-cloud).
   * When true, nodes with NO explicit visibility anywhere in their ancestor
   * chain (`effectiveVisibility` NULL) are hidden from non-managers like
   * `private` ones, instead of the open-mode default of member-visible.
   * Unset = open (the open-source and legacy default).
   */
  restrictedVisibility?: boolean;
  /**
   * Who is making this request, as a *kind* rather than a set of booleans.
   *
   * ABSENT means "a member-ish caller" — the historical behaviour every host
   * and test relies on today (open source injects no auth at all).
   *
   * `"anonymous"` is the deliberate opt-in for a request that arrived WITHOUT a
   * signed-in user (a public link). It is not "a member with fewer
   * permissions": it hard-downgrades every ACL signal below, regardless of what
   * else the host put in the context. That inversion is the point — the
   * dangerous default (`isSpaceManager` absent ⇒ manager) can no longer be
   * reached from an anonymous request even if a future transport forgets to
   * pass the other flags.
   *
   * Set it via `runWithAnonymousContext`, never by hand.
   */
  visitorKind?: "member" | "anonymous";
}

/** Tenant id used by the single-tenant open-source app and as a safe default. */
export const LOCAL_SPACE_ID = "local";

const storage = new AsyncLocalStorage<BusabaseContext>();

const LOCAL_OPERATOR_IDS = new Set(["local-admin", "local-user"]);

const LOCAL_USER_LABELS: Record<string, Omit<UserRefVO, "id">> = {
  "local-admin": {
    name: "Local Admin",
    email: null,
    image: null,
    role: "owner",
  },
  "local-editor": {
    name: "Local Editor",
    email: null,
    image: null,
    role: "editor",
  },
  "local-producer": {
    name: "Local Producer",
    email: null,
    image: null,
    role: "producer",
  },
  "local-user": {
    name: "Local User",
    email: null,
    image: null,
    role: "owner",
  },
  "local-viewer": {
    name: "Local Viewer",
    email: null,
    image: null,
    role: "viewer",
  },
  agent: {
    name: "Agent",
    email: null,
    image: null,
    role: "agent",
  },
  producer: {
    name: "Producer",
    email: null,
    image: null,
    role: "producer",
  },
};

const getOpenSourceLocalUserLabel = (id: string, localUserName?: string | null) => {
  const label = LOCAL_USER_LABELS[id];
  if (!label) {
    return null;
  }
  if (!LOCAL_OPERATOR_IDS.has(id)) {
    return label;
  }
  const displayName = localUserName?.trim();
  return {
    ...label,
    name: displayName || label.name,
  };
};

/** Run `fn` with the given Busabase context bound for its entire async subtree. */
export function runWithBusabaseContext<T>(ctx: BusabaseContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** Actor id recorded for requests that arrived without a signed-in user. */
export const ANONYMOUS_ACTOR_ID = "anonymous";

/**
 * Run `fn` as an ANONYMOUS visitor (a public link, no signed-in user).
 *
 * This is the only supported way to serve an unauthenticated request, and it
 * exists so the downgrade cannot be forgotten: the caller supplies only the
 * request-shaped fields, while `visitorKind` — and with it the hard `false` for
 * manager/restricted-visibility (see `getContextIsSpaceManager`) — is pinned
 * here and cannot be overridden by the caller.
 *
 * The resulting context has no member identity: writes attribute to
 * `ANONYMOUS_ACTOR_ID`, and every node-ACL check runs as a non-manager against
 * a restricted-visibility space.
 */
export function runWithAnonymousContext<T>(
  ctx: Omit<BusabaseContext, "visitorKind" | "isSpaceManager" | "restrictedVisibility" | "actorId">,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    {
      ...ctx,
      actorId: ANONYMOUS_ACTOR_ID,
      visitorKind: "anonymous",
      isSpaceManager: false,
      restrictedVisibility: true,
    },
    fn,
  );
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

/**
 * The host-authenticated actor id, or undefined in open-source local mode.
 * Used as a mode detector by node-ACL write paths: creator auto-grants only
 * make sense when a real multi-tenant host resolved a real user.
 */
export function getContextActorId(): string | undefined {
  return storage.getStore()?.actorId;
}

export function getContextSourceProvenance(): BusabaseSourceProvenance | undefined {
  return storage.getStore()?.sourceProvenance;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeRecord = (
  contextValue: Record<string, unknown> | undefined,
  explicitValue: unknown,
): Record<string, unknown> | undefined => {
  if (!isRecord(explicitValue)) return contextValue;
  return { ...(contextValue ?? {}), ...explicitValue };
};

export function withContextSourceMeta(
  sourceMeta: Record<string, unknown> = {},
): Record<string, unknown> {
  const provenance = getContextSourceProvenance();
  if (!provenance) return sourceMeta;

  const explicitProvenance = isRecord(sourceMeta.provenance) ? sourceMeta.provenance : {};
  const contextProvenance = provenance as Record<string, unknown>;
  const owner = mergeRecord(
    isRecord(contextProvenance.owner) ? contextProvenance.owner : undefined,
    explicitProvenance.owner,
  );
  const apiKey = mergeRecord(
    isRecord(contextProvenance.apiKey) ? contextProvenance.apiKey : undefined,
    explicitProvenance.apiKey,
  );
  const mergedProvenance = {
    ...contextProvenance,
    ...explicitProvenance,
  };
  if (owner) mergedProvenance.owner = owner;
  else delete mergedProvenance.owner;
  if (apiKey) mergedProvenance.apiKey = apiKey;
  else delete mergedProvenance.apiKey;

  return {
    ...sourceMeta,
    provenance: mergedProvenance,
  };
}

/** User-scoped Vault runtime values for the current hosted/request execution. */
export function getContextVaultRuntimeEnv(): Record<string, string> {
  const store = storage.getStore();
  return store?.vaultRuntimeEnv ?? {};
}

/** Read one user-scoped Vault runtime value from the current hosted/request execution. */
export function getContextVaultRuntimeValue(key: string): string | undefined {
  return getContextVaultRuntimeEnv()[key];
}

export async function resolveUserRefs(userIds: Iterable<string | null | undefined>) {
  const ids = [
    ...new Set(
      [...userIds]
        .filter((userId): userId is string => typeof userId === "string")
        .map((userId) => userId.trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) {
    return new Map<string, UserRefVO>();
  }

  const customResolver = storage.getStore()?.resolveUsers;
  if (customResolver) {
    const resolved = await customResolver(ids);
    for (const id of ids) {
      if (!resolved.has(id) && LOCAL_USER_LABELS[id]) {
        resolved.set(id, { id, ...LOCAL_USER_LABELS[id] });
      }
    }
    return resolved;
  }

  return new Map(
    ids.map((id) => {
      const label = getOpenSourceLocalUserLabel(id, storage.getStore()?.localUserName);
      return [
        id,
        {
          id,
          ...(label ?? {
            name: null,
            email: null,
            image: null,
            role: null,
          }),
        },
      ];
    }),
  );
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

/** The host's registered "CR entered review" notification hook, if any (cloud-only). */
export function getContextChangeRequestPendingReviewHook() {
  return storage.getStore()?.onChangeRequestPendingReview;
}

/** True when this request arrived without a signed-in user (a public link). */
export function isAnonymousVisitor(): boolean {
  return storage.getStore()?.visitorKind === "anonymous";
}

/**
 * Whether the current actor short-circuits node-ACL checks as a space
 * owner/admin. ABSENT (open-source local mode, or any host that predates this
 * field) deliberately means `true` — no auth = no restriction — so only a
 * host that explicitly injects `false` gets enforcement.
 *
 * An anonymous visitor is NEVER a manager, whatever the rest of the context
 * says. This check comes first on purpose: it makes the permissive default
 * unreachable from a public request instead of relying on every future
 * transport to remember to inject `isSpaceManager: false`.
 */
export function getContextIsSpaceManager(): boolean {
  if (isAnonymousVisitor()) {
    return false;
  }
  return storage.getStore()?.isSpaceManager ?? true;
}

/** Workspace-level baseline before any node-specific grant raises access. */
export function getContextPermissionLevel(): ApiKeyPermissionLevel {
  const context = storage.getStore();
  if (context?.permissionLevel) return context.permissionLevel;
  return context?.isSpaceManager === false ? "read" : "manage";
}

/**
 * Whether this space hides default-visibility (NULL) nodes from non-managers.
 * Anonymous visitors always get the restricted treatment — a public link must
 * never expose nodes that merely lack an explicit visibility.
 */
export function getContextRestrictedVisibility(): boolean {
  if (isAnonymousVisitor()) {
    return true;
  }
  return storage.getStore()?.restrictedVisibility ?? false;
}
