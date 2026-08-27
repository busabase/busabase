// NOTE: intentionally no `server-only` guard. This module is pulled into the
// drizzle schema import graph (via `db/space-column.ts`), and drizzle-kit's
// config loader cannot resolve the `server-only` throw. It is node-only
// (AsyncLocalStorage) and only ever imported by server code + the schema.

import { AsyncLocalStorage } from "node:async_hooks";
import type { ApiKeyPermissionLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseSourceChannel, UserRefVO } from "busabase-contract/types";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { type DemoUseCase, normalizeDemoUseCase } from "./demo/use-case";

/**
 * Request-scoped Busabase execution context.
 *
 * busabase-core is single-tenant by construction (a module-singleton `db`, no
 * `spaceId` on any table, a hard-coded local actor). To let a multi-tenant host
 * (Busabase Cloud) reuse the SAME logic without rewriting ~100 function
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

export type { BusabaseSourceChannel } from "busabase-contract/types";

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

export interface BusabaseEmbedActorState {
  active: boolean;
  isSpaceManager: boolean;
  restrictedVisibility: boolean;
}

export interface BusabasePerformanceMetric {
  name: "change_requests.inbox_snapshot";
  durationMs: number;
  responseBytes: number;
  candidateRows: number;
  visibleRows: number;
  pageRows: number;
  managerPath: boolean;
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
   * Host-owned validation for the creator credential behind a public Embed
   * Link. Cloud checks account, membership, API-key, and workspace ACL state;
   * local mode leaves this unset and keeps its single-user defaults.
   */
  resolveEmbedActorState?: (input: {
    actorId: string;
    spaceId: string;
    apiKeyId: string;
  }) => Promise<BusabaseEmbedActorState>;
  /**
   * Origin the host wants baked into the capability URLs it hands out
   * (`https://<workspace host>` on Cloud, the loopback dev server on Desktop).
   *
   * Injected rather than read from `NEXT_PUBLIC_APP_URL` inside the shared
   * logic: each host already owns a resolved app URL, and the two disagree on
   * what an absent env var should mean. A shared default would silently be one
   * host's — which is exactly how Cloud links could come out pointing at
   * Desktop's loopback port.
   */
  embedOrigin?: string;
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
   * (Busabase Cloud) can persist an inbox notification for whoever should
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
  /** Host-owned, best-effort performance sink. Values contain no tenant ids or payload data. */
  onPerformanceMetric?: (metric: BusabasePerformanceMetric) => void | Promise<void>;
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
   * Optional credential ceiling, independent from the human workspace
   * baseline. A node grant may raise a member above their workspace baseline,
   * but never above this API-key level.
   */
  credentialPermissionCeiling?: ApiKeyPermissionLevel;
  /**
   * When true, `permissionLevel` is a scoped credential ceiling, not merely
   * the actor's workspace-role baseline. Node principal grants may expose a
   * hidden node, but must not elevate this request above the credential.
   */
  permissionLevelIsCeiling?: boolean;
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
  visitorKind?: "member" | "anonymous" | "embed";
  /**
   * Node ids this anonymous request has proven the SHARE PASSWORD for.
   *
   * A password-protected public link is invisible to an anonymous visitor until
   * the node's id shows up here (see `buildNodeVisibilityCondition` and
   * `getPublicScopeOf`). The host is responsible for deciding what counts as
   * proof — busabase-cloud verifies a signed unlock cookie — and hands the
   * resulting ids in per request; the core never trusts a client-supplied list.
   *
   * Meaningless for a member: a space member reaches a node through the node
   * ACL, and a link password has never gated members (they aren't using the
   * link). Only the anonymous branches read it.
   */
  unlockedShareNodeIds?: readonly string[];
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

/**
 * Run `fn` as a MEMBER — a signed-in session, or an API key (whose ceiling
 * rides along as `credentialPermissionCeiling`; see the field's own doc
 * comment for why a read-only key issued to an admin still sees what that
 * admin can see, and is capped only on what it can DO).
 *
 * Unlike `runWithAnonymousContext` / `runWithEmbedContext`, a member's ACL
 * signals are not pinned here — they are host-resolved from the actor's real
 * workspace role and supplied by the caller. What this factory pins is
 * `visitorKind`: it is never set, so a member request can never carry the
 * anonymous downgrade by accident. Its value is a single named, documented
 * construction point for the caller kind that today's twelve call sites hand-
 * assemble independently.
 */
export function runWithMemberContext<T>(
  ctx: Omit<BusabaseContext, "visitorKind">,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Run `fn` as an EMBED visitor — an anonymous holder of an Embed Link (an
 * AirApp embed, or a generic node embed).
 *
 * Distinct from `runWithAnonymousContext` ("guest"): a guest's authority
 * comes from the NODE being explicitly publicly shared; an embed visitor's
 * authority comes from possessing the LINK, and V1 links carry Space-scoped
 * read.
 *
 * `actorId` is supplied by the caller and is deliberately the link's
 * CREATOR, not an anonymous sentinel — kept for attribution and for their
 * own node-principal grants, never for privilege
 * LEVEL, which is why the two pins below cannot be overridden by the caller:
 *
 * - `isSpaceManager: false` — the creator is typically an owner/admin, and a
 *   manager short-circuits every node-ACL check to full access; without this
 *   pin every private node in the Space would be listed and readable through
 *   the link. This was PR #5948's bug (there, for the AirApp bridge only).
 * - `credentialPermissionCeiling: "read"` — the capability is a read-only
 *   credential, so no node-principal grant can raise this request above
 *   `read` even where the creator personally holds `manage`.
 *
 * Both are needed: the ceiling alone still leaves the manager bypass in the
 * visibility SQL, and `isSpaceManager: false` alone still lets an explicit
 * `manage` grant through.
 *
 * - `visitorKind: "embed"` — pinned for the same reason the other two are, and
 *   it is deliberately its OWN kind rather than `"anonymous"`.
 *
 *   `"anonymous"` is the guest kind, and `buildNodeVisibilityCondition` /
 *   `getEffectiveNodeLevel` answer it with "only nodes carrying a live public
 *   share." An Embed Link's target usually carries none — its authority is the
 *   link — so labelling an embed request anonymous silently 404s the very node
 *   the link points at. What an embed DOES need from a public kind is the
 *   default-deny procedure surface (`comments.*`, `dump.*`, `vault.*` and the
 *   other space-scoped-only procedures consult no node ACL at all), which
 *   `publicSurfaceGuard` gives it through `EMBED_READ_ALLOWLIST`.
 *
 *   Leaving the kind to the caller meant an embed request's authority depended
 *   on which transport built the context: the RPC capability route passed
 *   `"anonymous"` (taking the guest visibility branch with it), while the
 *   server-rendered `resolveEmbedLink` path passed nothing at all.
 */
export function runWithEmbedContext<T>(
  ctx: Omit<BusabaseContext, "isSpaceManager" | "credentialPermissionCeiling" | "visitorKind">,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(
    {
      ...ctx,
      isSpaceManager: false,
      credentialPermissionCeiling: "read",
      visitorKind: "embed",
    },
    fn,
  );
}

/**
 * Run `fn` as the OSS single-user host — the LOCAL kind.
 *
 * Unlike every other kind, "sets nothing" is a valid, deliberate configuration
 * here: `apps/busabase` has no auth to resolve, so the permissive
 * absent-value defaults (see `BusabaseContext`'s per-signal docs) ARE the
 * intended behaviour — full local access, no restriction. That is exactly why
 * this kind is worth naming: as long as "sets nothing" stays a valid,
 * meaningful configuration, absence can never be made a compile error (the
 * property every other kind gets once raw construction is unreachable) —
 * naming it is what turns "a transport forgot to pick a kind" into "a
 * transport explicitly chose local," which is the whole point.
 *
 * `aclOverride` exists for exactly one case: the Local ↔ Cloud Tunnel relay,
 * where a Cloud-issued API-key ceiling forwarded into the local host must
 * still apply (`resolveRelayPermissionContext`). A direct local call passes
 * nothing here and keeps the permissive local default.
 */
export function runWithLocalContext<T>(
  ctx: Pick<BusabaseContext, "vaultRuntimeEnv" | "localUserName"> & {
    aclOverride?: Pick<
      BusabaseContext,
      "isSpaceManager" | "permissionLevel" | "permissionLevelIsCeiling"
    >;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const { aclOverride, ...rest } = ctx;
  return storage.run({ ...rest, ...aclOverride }, fn);
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

export function withContextSourceMeta(
  sourceMeta: Record<string, unknown> = {},
): Record<string, unknown> {
  const provenance = getContextSourceProvenance();
  if (!provenance) return sourceMeta;

  const explicitProvenance = isRecord(sourceMeta.provenance) ? sourceMeta.provenance : {};
  const contextProvenance = provenance as Record<string, unknown>;
  const owner = isRecord(contextProvenance.owner)
    ? contextProvenance.owner
    : isRecord(explicitProvenance.owner)
      ? explicitProvenance.owner
      : undefined;
  const apiKey = isRecord(contextProvenance.apiKey)
    ? contextProvenance.apiKey
    : isRecord(explicitProvenance.apiKey)
      ? explicitProvenance.apiKey
      : undefined;
  const mergedProvenance = {
    ...explicitProvenance,
    ...contextProvenance,
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

export async function resolveEmbedActorState(input: {
  actorId: string;
  spaceId: string;
  apiKeyId: string;
}): Promise<BusabaseEmbedActorState> {
  const resolver = storage.getStore()?.resolveEmbedActorState;
  if (resolver) return resolver(input);
  // No host resolver: the single-user local host, where the link is live and
  // there is no other member to hide anything from. `isSpaceManager` is still
  // `false` — a host that forgets to inject the resolver must not be handed the
  // manager bypass by default. That hard-coded `true` is the bug
  // `runWithEmbedContext` exists to prevent (PR #5948), and this is the one
  // place it could come back in through.
  return { active: true, isSpaceManager: false, restrictedVisibility: false };
}

/**
 * Origin for capability URLs, or `undefined` when the host injected none —
 * the caller decides its own fallback rather than inheriting another host's.
 */
export function getContextEmbedOrigin(): string | undefined {
  return storage.getStore()?.embedOrigin;
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

/** Emit a host-owned performance metric without allowing observability failure to break a read. */
export function emitContextPerformanceMetric(createMetric: () => BusabasePerformanceMetric): void {
  const hook = storage.getStore()?.onPerformanceMetric;
  if (!hook) return;
  try {
    void Promise.resolve(hook(createMetric())).catch(() => undefined);
  } catch {
    // Metrics are diagnostic only; never make the Inbox unavailable.
  }
}

/**
 * True for a GUEST — a logged-out visitor arriving through a node's public
 * share. Deliberately false for an embed visitor: the node-ACL branches keyed
 * off this answer "only publicly shared nodes," which is the guest's authority,
 * not the link holder's. Use `isPublicVisitor()` for the checks that should
 * cover both.
 */
export function isAnonymousVisitor(): boolean {
  return storage.getStore()?.visitorKind === "anonymous";
}

/** True for a holder of an Embed Link (see `runWithEmbedContext`). */
export function isEmbedVisitor(): boolean {
  return storage.getStore()?.visitorKind === "embed";
}

/**
 * True for any visitor whose authority comes from a link rather than a seat —
 * guest or embed. The right check for "never a manager", "never sees
 * default-visibility nodes", and "must pass a default-deny procedure surface."
 */
export function isPublicVisitor(): boolean {
  const kind = storage.getStore()?.visitorKind;
  return kind === "anonymous" || kind === "embed";
}

/**
 * Node ids whose share password this ANONYMOUS request has already satisfied.
 *
 * Empty for a member, and empty for an anonymous request that supplied no proof
 * — which is the fail-closed default: a password-protected node stays invisible
 * until the host puts its id in here.
 */
export function getContextUnlockedShareNodeIds(): readonly string[] {
  if (!isAnonymousVisitor()) return [];
  return storage.getStore()?.unlockedShareNodeIds ?? [];
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
  if (isPublicVisitor()) {
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

export function getContextPermissionLevelIsCeiling(): boolean {
  return storage.getStore()?.permissionLevelIsCeiling === true;
}

export function getContextCredentialPermissionCeiling(): ApiKeyPermissionLevel | undefined {
  return storage.getStore()?.credentialPermissionCeiling;
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
  // An embed carries the creator's own visibility, resolved by the host
  // (`resolveEmbedActorState`) — not the guest's blanket restriction, which
  // would hide the link target itself whenever it has default visibility.
  return storage.getStore()?.restrictedVisibility ?? false;
}
