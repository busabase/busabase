/**
 * AirApp resource provisioning — how an app claims (or creates) the Folder and
 * Bases it declares, exactly once, without ever taking over someone else's.
 *
 * Every App-in-Skill shipped a byte-identical copy of this module (280 lines ×
 * 65 apps, two spellings). That is the wrong place for it: the rules encoded
 * here are not app preferences, they are the safety boundary that keeps an app
 * from adopting a Folder a human created for something else. A third party
 * re-deriving them from scratch gets the happy path right and the conflict
 * cases wrong, and the failure is silent — the app happily writes into data it
 * does not own.
 *
 * The contract, in one line: **an app owns a node only if it stamped it.**
 * Ownership lives in `node.metadata` as `{ appId, resourceKey, schemaVersion }`.
 * Anything else is either a legacy node this app plausibly created before
 * stamping existed (claimable *only* after a full structural fingerprint match)
 * or someone else's (never touched, always a `SETUP_CONFLICT`).
 *
 * This module is isomorphic — browser and Node both — and holds no I/O beyond
 * the passed-in client.
 *
 * @example
 * ```ts
 * import { createBusabaseClient } from "busabase-sdk";
 * import { inspectProvisionedResources, provisionDeclaredResources } from "busabase-sdk/airapp";
 *
 * const client = createBusabaseClient({ baseUrl: window.location.origin });
 * const config = {
 *   appId: "kelly-crm",
 *   appName: "Kelly CRM",
 *   schemaVersion: 1,
 *   folder: { slug: "kelly-crm", name: "Kelly CRM", description: "CRM workspace" },
 *   bases: [{ key: "contacts", slug: "kelly-crm-contacts-v1", name: "Contacts", fields: [...] }],
 * };
 *
 * let resources = await inspectProvisionedResources(client, config);
 * if (!resources.folder || resources.missing.length) {
 *   resources = await provisionDeclaredResources(client, config); // one idempotent ChangeRequest
 * }
 * ```
 */

import {
  APP_ROOT_RESOURCE_KEY,
  type AppResourceOwnership,
  type AppRootOwnership,
} from "busabase-contract/domains/package/template";
import type { BusabaseClient } from "./client.js";

type NodeChangeRequestInput = Parameters<BusabaseClient["nodes"]["createChangeRequest"]>[0];
type NodeOperationInput = NodeChangeRequestInput["operations"][number];
type CreateNodeOperationInput = Extract<NodeOperationInput, { kind: "create" }>;
type FieldChangeRequestInput = Parameters<BusabaseClient["bases"]["fieldChangeRequest"]>[0];
type CreateFieldChangeRequestInput = Extract<FieldChangeRequestInput, { operation: "create" }>;
type FileTreeCreateInput = Parameters<BusabaseClient["fileTrees"]["create"]>[0];
type FileTreeChangeRequestInput = Parameters<BusabaseClient["fileTrees"]["createChangeRequest"]>[0];
type FileTreeOperationInput = FileTreeChangeRequestInput["operations"][number];
type FileTreeCreateOrUpdateOperation = Extract<
  FileTreeOperationInput,
  { kind: "create" | "update" }
>;

/**
 * A Base field, as an app declares it.
 *
 * `type` is a plain `string`, not the contract's narrow field-type union — an
 * app's declaration is ordinarily a hand-authored object literal (`type:
 * "text"`), and TypeScript infers a plain-JS object literal's string
 * properties as `string`, not as that literal. Deriving this type straight
 * from the contract made every such declaration a type error. The contract's
 * narrow union still applies where it actually matters — the server validates
 * every field type on the wire — this type only relaxes the *declaration*
 * surface to match how declarations are actually written.
 */
export interface AirAppFieldDeclaration {
  slug: string;
  name: string;
  type: string;
  required?: boolean;
  options?: Record<string, unknown>;
}

/** The client surface provisioning needs. Both `BusabaseClient` and `Busabase` satisfy it. */
export type AirAppProvisioningClient = Pick<BusabaseClient, "nodes" | "bases">;

/** One Base the app declares it needs. `key` is the app's stable internal handle. */
export interface AirAppBaseDeclaration {
  /** Stable internal handle, e.g. `"contacts"`. Also the node's `resourceKey`. */
  key: string;
  slug: string;
  name: string;
  description?: string;
  fields: AirAppFieldDeclaration[];
  /** Resolved at provision time; ignore when declaring. */
  nodeId?: string;
  /** Resolved at provision time; ignore when declaring. */
  baseId?: string;
  /** Free-form extras an app keeps alongside its declaration (e.g. `readLimit`). */
  [extra: string]: unknown;
}

export interface AirAppFolderDeclaration {
  slug: string;
  name: string;
  description?: string;
  /** Pin the Folder by id once known; otherwise it is discovered by slug. */
  nodeId?: string;
}

/**
 * The app's own AirApp node, when it ships one inside its Folder.
 *
 * `inspectProvisionedResources`/`provisionDeclaredResources` never create it —
 * an app's Folder and Bases are plain data-schema resources, safe to bring
 * into existence unattended, but an AirApp is a bundle of code the viewer's
 * browser will execute, so bringing it into existence always goes through
 * `publishAirApp`'s separate, always-review-first ChangeRequest instead of
 * riding along on the same `autoMerge: true` request as the data layer.
 * Declaring it here matters for a second reason regardless: without it, an
 * unstamped Folder holding the app's own AirApp would look like it holds an
 * unattributable stranger, and the legacy claim would be refused.
 */
export interface AirAppNodeDeclaration {
  slug: string;
  name: string;
  description?: string;
  /** Ownership key written into the node's metadata, e.g. `"airapp"`. */
  resourceKey: string;
}

/** Everything an app declares about the workspace shape it needs. */
export interface AirAppResourceConfig {
  appId: string;
  appName: string;
  /**
   * Bump when the declared shape changes. A node stamped with an older version
   * is re-stamped (a "repair"), not recreated — the data survives.
   */
  schemaVersion: number;
  folder: AirAppFolderDeclaration;
  bases: AirAppBaseDeclaration[];
  /** The app's own AirApp node inside the Folder, when it ships one. */
  airApp?: AirAppNodeDeclaration;
}

/**
 * The ownership stamp written into `node.metadata`.
 *
 * Structurally identical to (and kept in lockstep with) the contract package's
 * `AppResourceOwnership`, which `busabase-package`'s installer writes for the
 * SAME resources when a user installs the app from the Template Center instead
 * of running its `setup.mjs`. The two writers only recognise each other's work
 * by this shape — drift means a user who installed through the UI and then ran
 * the skill in their shell hits `SETUP_CONFLICT` on their own data. The
 * assertion below is what makes that drift a compile error rather than a
 * support ticket.
 *
 * A type alias rather than an `interface` on purpose: `nodes.updateMetadata`
 * and the create operations take `Record<string, unknown>`, and an interface —
 * being open to declaration merging — is not assignable to an index signature.
 */
export type AirAppResourceOwnership = {
  appId: string;
  resourceKey: string;
  schemaVersion: number;
};

// Compile-time lockstep with the contract definition, in both directions.
type _OwnershipMatchesContract = AirAppResourceOwnership extends AppResourceOwnership
  ? AppResourceOwnership extends AirAppResourceOwnership
    ? true
    : never
  : never;
const _ownershipMatchesContract: _OwnershipMatchesContract = true;
void _ownershipMatchesContract;

/**
 * The Folder stamp is checked by `ownsAppRoot` through the SAME triple as any
 * other resource, so whatever the installer writes onto an app's root Folder
 * must still satisfy this shape. Asserting only the resource stamp missed that
 * once already: an installer-side root stamp of `{appId, version, source}`
 * type-checked fine and would have made every `setup.mjs` run after a UI
 * install fail with SETUP_CONFLICT on the user's own workspace.
 */
type _RootOwnershipSatisfiesResourceStamp = AppRootOwnership extends AirAppResourceOwnership
  ? true
  : never;
const _rootOwnershipSatisfiesResourceStamp: _RootOwnershipSatisfiesResourceStamp = true;
void _rootOwnershipSatisfiesResourceStamp;

/** A node this app owns but whose ownership stamp needs (re)writing. */
export interface AirAppOwnershipRepair {
  nodeId: string;
  baseId?: string;
  resourceKey: string;
  metadata: AirAppResourceOwnership;
}

export interface AirAppProvisionedBase extends AirAppBaseDeclaration {
  nodeId: string;
  baseId: string;
}

export interface AirAppResources {
  /** The app's root Folder, or `null` when it does not exist yet. */
  folder: (AirAppFolderDeclaration & { nodeId: string }) | null;
  /** Declared Bases that exist and are owned, with their resolved ids. */
  bases: AirAppProvisionedBase[];
  /** Declared Bases that do not exist yet. */
  missing: AirAppBaseDeclaration[];
  /** Owned nodes whose ownership stamp is missing or stale. */
  repairs: AirAppOwnershipRepair[];
  /**
   * The app's own AirApp node (see `AirAppNodeDeclaration`), when `config.airApp`
   * is declared and a matching node exists under the Folder — owned or legacy,
   * stamped or not; a pending stamp repair is reported separately via `repairs`.
   * `null` when not declared, or declared but not found — the latter is what
   * `publishAirApp` treats as "create", not a `missing`-array entry, because
   * unlike a Base it is never auto-created just by finding it absent.
   */
  airApp: { nodeId: string } | null;
  /**
   * Set when the server is too old for `nodes.updateMetadata`, so ownership was
   * established by full structural fingerprint instead of a stamp.
   */
  compatibilityMode?: "verified-legacy-fingerprint";
}

/**
 * Why setup cannot proceed. These are the app's five distinguishable states —
 * each one wants a different screen, which is why they are codes and not prose.
 *
 * - `SETUP_REQUIRED` — nothing exists yet; offer to initialize.
 * - `SETUP_PENDING` — the ChangeRequest was submitted and awaits human approval.
 * - `SETUP_CONFLICT` — a node in the way is not this app's; nothing was changed.
 * - `SETUP_PERMISSION` — this account may not create/repair here.
 * - `SCHEMA_INCOMPLETE` — the change merged but read back incomplete.
 */
export type AirAppSetupCode =
  | "SETUP_REQUIRED"
  | "SETUP_PENDING"
  | "SETUP_CONFLICT"
  | "SETUP_PERMISSION"
  | "SCHEMA_INCOMPLETE";

/**
 * A setup failure carrying its state as a `code`.
 *
 * `message` is deliberately kept in the historical `"CODE: detail"` shape: the
 * generated apps parse the prefix off `error.message`, so an app can migrate to
 * this class without touching its rendering code, then move to `error.code`.
 */
export class AirAppSetupError extends Error {
  readonly code: AirAppSetupCode;
  /** The human-readable half, without the `CODE: ` prefix. */
  readonly detail: string;

  constructor(code: AirAppSetupCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "AirAppSetupError";
    this.code = code;
    this.detail = detail;
  }
}

const setupError = (code: AirAppSetupCode, detail: string) => new AirAppSetupError(code, detail);

/** True for a 404 / NOT_FOUND from any of the client's transports. */
export const isNotFound = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "NOT_FOUND") || ("status" in error && error.status === 404));

const isForbidden = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (("code" in error && error.code === "FORBIDDEN") || ("status" in error && error.status === 403));

/** A node as this module reads it — the fields provisioning actually looks at. */
interface ReadNode {
  id: string;
  type: string;
  slug: string;
  name: string;
  description: string;
  baseId: string | null;
  metadata: Record<string, unknown>;
  children?: ReadNode[];
}

interface ReadFolderDetail {
  node: ReadNode;
  children: ReadNode[];
}

const ownsResource = (
  node: ReadNode | undefined,
  appId: string,
  resourceKey: string,
  schemaVersion: number,
) =>
  node?.metadata?.appId === appId &&
  node?.metadata?.resourceKey === resourceKey &&
  node?.metadata?.schemaVersion === schemaVersion;

const hasResourceIdentity = (node: ReadNode | undefined, appId: string, resourceKey: string) =>
  node?.metadata?.appId === appId && node?.metadata?.resourceKey === resourceKey;

const ownsAppRoot = (node: ReadNode | undefined, appId: string, schemaVersion: number) =>
  hasResourceIdentity(node, appId, APP_ROOT_RESOURCE_KEY) &&
  node?.metadata?.schemaVersion === schemaVersion;

const hasEmptyMetadata = (node: ReadNode | undefined) =>
  Object.keys(node?.metadata ?? {}).length === 0;

/**
 * Nobody has stamped ownership on this node — weaker than `hasEmptyMetadata`,
 * and deliberately so: a file-tree node (Skill/Drive/AirApp) always carries a
 * server-written `metadata.version`, even freshly created and never stamped
 * by any app. Requiring literally-empty metadata there would mean a node
 * `publishAirApp` itself just created is never recognized as ours on the very
 * next read — confirmed against a live server, not assumed.
 */
const isUnclaimed = (node: ReadNode | undefined) => node?.metadata?.appId === undefined;

/**
 * The legacy-claim test. An unstamped node is adopted only when its every
 * visible attribute still matches the declaration — a weaker test would let an
 * app claim a same-slug Folder a human repurposed.
 */
const matchesDeclaration = (
  node: ReadNode | undefined,
  declaration: { slug: string; name: string; description?: string },
  type: string,
) =>
  node?.type === type &&
  node?.slug === declaration.slug &&
  node?.name === declaration.name &&
  node?.description === (declaration.description ?? "");

/**
 * The AirApp equivalent of the legacy claim: an unclaimed `airapp` node counts
 * as ours only when its slug and name still match what we declare.
 */
const matchesLegacyAirApp = (node: ReadNode | undefined, config: AirAppResourceConfig) =>
  isUnclaimed(node) &&
  node?.type === "airapp" &&
  node?.slug === config.airApp?.slug &&
  node?.name === config.airApp?.name;

const resourceMetadata = (
  config: AirAppResourceConfig,
  resourceKey: string,
): AirAppResourceOwnership => ({
  appId: config.appId,
  resourceKey,
  schemaVersion: config.schemaVersion,
});

/**
 * Decide, from one already-read Folder, what exists / is missing / needs
 * re-stamping. Pure — no I/O — so the ownership rules are directly testable.
 *
 * @throws {AirAppSetupError} `SETUP_CONFLICT` when a node in the way is not
 * this app's. Nothing is ever mutated on that path.
 */
export function resolveProvisionedFolder(
  folder: ReadFolderDetail | null | undefined,
  config: AirAppResourceConfig,
): AirAppResources {
  if (!folder) {
    return { folder: null, bases: [], missing: [...config.bases], repairs: [], airApp: null };
  }
  if (folder.node?.type !== "folder" || folder.node?.slug !== config.folder.slug) {
    throw setupError(
      "SETUP_CONFLICT",
      `A different Folder already uses the slug ${config.folder.slug}; nothing was changed`,
    );
  }

  const rootOwned = hasResourceIdentity(folder.node, config.appId, APP_ROOT_RESOURCE_KEY);
  const legacyRoot =
    hasEmptyMetadata(folder.node) && matchesDeclaration(folder.node, config.folder, "folder");
  if (!rootOwned && !legacyRoot) {
    throw setupError(
      "SETUP_CONFLICT",
      `The Folder ${config.folder.slug} does not belong to this app; nothing was changed`,
    );
  }

  const bases: AirAppProvisionedBase[] = [];
  const missing: AirAppBaseDeclaration[] = [];
  const repairs: AirAppOwnershipRepair[] = [];
  if (!ownsAppRoot(folder.node, config.appId, config.schemaVersion)) {
    repairs.push({
      nodeId: folder.node.id,
      resourceKey: APP_ROOT_RESOURCE_KEY,
      metadata: resourceMetadata(config, APP_ROOT_RESOURCE_KEY),
    });
  }

  for (const base of config.bases) {
    const matches = (folder.children ?? []).filter((node) => node.slug === base.slug);
    if (!matches.length) {
      // A legacy (unstamped) Folder is claimed as a whole or not at all: if it
      // is missing a declared Base we cannot tell "this app's Folder, partially
      // set up" from "someone else's Folder that happens to share the slug".
      if (legacyRoot) {
        throw setupError(
          "SETUP_CONFLICT",
          `The existing unstamped Folder is missing the resource ${base.slug}, so it cannot be claimed safely`,
        );
      }
      missing.push(base);
      continue;
    }
    const node = matches[0];
    if (matches.length !== 1 || node.type !== "base" || !node.baseId) {
      throw setupError(
        "SETUP_CONFLICT",
        `The resource ${base.slug} does not match this app's declaration; nothing was changed`,
      );
    }

    const owned = hasResourceIdentity(node, config.appId, base.key);
    const legacy = hasEmptyMetadata(node) && matchesDeclaration(node, base, "base");
    if (!owned && !legacy) {
      throw setupError(
        "SETUP_CONFLICT",
        `The resource ${base.slug} does not match this app's declaration; nothing was changed`,
      );
    }
    if (!ownsResource(node, config.appId, base.key, config.schemaVersion)) {
      repairs.push({
        nodeId: node.id,
        baseId: node.baseId,
        resourceKey: base.key,
        metadata: resourceMetadata(config, base.key),
      });
    }
    bases.push({ ...base, nodeId: node.id, baseId: node.baseId });
  }

  // The app's own AirApp node, if it declares one. Never created by
  // resolveProvisionedFolder — an AirApp is published via `publishAirApp`'s
  // own always-review-first ChangeRequest, not alongside the data layer's
  // `autoMerge: true` structure request — only recognized and stamped here.
  const airAppNode = config.airApp
    ? (folder.children ?? []).find(
        (node) =>
          hasResourceIdentity(
            node,
            config.appId,
            (config.airApp as AirAppNodeDeclaration).resourceKey,
          ) || matchesLegacyAirApp(node, config),
      )
    : undefined;
  if (
    config.airApp &&
    airAppNode &&
    !ownsResource(airAppNode, config.appId, config.airApp.resourceKey, config.schemaVersion)
  ) {
    repairs.push({
      nodeId: airAppNode.id,
      resourceKey: config.airApp.resourceKey,
      metadata: resourceMetadata(config, config.airApp.resourceKey),
    });
  }

  if (legacyRoot) {
    const declaredSlugs = new Set(config.bases.map((base) => base.slug));
    const ambiguousExtra = (folder.children ?? []).find(
      (node) =>
        !declaredSlugs.has(node.slug) &&
        node.id !== airAppNode?.id &&
        node?.metadata?.appId !== config.appId,
    );
    if (ambiguousExtra) {
      throw setupError(
        "SETUP_CONFLICT",
        `The existing unstamped Folder holds an unattributable resource ${ambiguousExtra.slug}; nothing was changed`,
      );
    }
  }

  return {
    folder: { ...config.folder, nodeId: folder.node.id },
    bases,
    missing,
    repairs,
    airApp: airAppNode ? { nodeId: airAppNode.id } : null,
  };
}

/**
 * The create operations for one idempotent ChangeRequest. Pure.
 *
 * When the Folder does not exist yet it is created under the temp `ref`
 * `"app-root"` and the Bases nest under it via `parentNodeRef`, so the whole
 * structure lands in a single reviewable change.
 */
export function buildProvisionOperations(
  config: AirAppResourceConfig,
  folder: { nodeId: string } | null,
  missingBases: AirAppBaseDeclaration[],
): NodeOperationInput[] {
  const operations: NodeOperationInput[] = [];
  if (!folder) {
    operations.push({
      kind: "create",
      ref: "app-root",
      nodeType: "folder",
      slug: config.folder.slug,
      name: config.folder.name,
      description: config.folder.description ?? "",
      metadata: resourceMetadata(config, APP_ROOT_RESOURCE_KEY),
    });
  }
  for (const base of missingBases) {
    operations.push({
      kind: "create",
      ...(folder ? { parentNodeId: folder.nodeId } : { parentNodeRef: "app-root" }),
      nodeType: "base",
      slug: base.slug,
      name: base.name,
      description: base.description ?? "",
      metadata: resourceMetadata(config, base.key),
      // The declaration's `type` is a plain `string` (see AirAppFieldDeclaration);
      // the server validates the real field-type enum on the wire.
      fields: base.fields as CreateNodeOperationInput["fields"],
    });
  }
  return operations;
}

const findTopLevelFolder = async (
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
): Promise<ReadNode | null> => {
  const roots = (await client.nodes.list({ parentId: null, depth: 2 })) as unknown as ReadNode[];
  const candidates = (roots ?? [])
    .flatMap((node) => [node, ...(node.children ?? [])])
    .filter((node) => node.type === "folder" && node.slug === config.folder.slug);
  if (candidates.length > 1) {
    throw setupError(
      "SETUP_CONFLICT",
      `Found more than one Folder with the slug ${config.folder.slug}; nothing was changed`,
    );
  }
  return candidates[0] ?? null;
};

const readFolder = async (
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
): Promise<ReadFolderDetail | null> => {
  let nodeId = config.folder.nodeId;
  if (!nodeId) nodeId = (await findTopLevelFolder(client, config))?.id;
  if (!nodeId) return null;
  try {
    return (await client.nodes.get({ nodeId, type: "folder" })) as unknown as ReadFolderDetail;
  } catch (error) {
    // A pinned id that 404s means the Folder was moved or recreated — fall back
    // to slug discovery rather than reporting the app as uninitialized.
    if (isNotFound(error) && config.folder.nodeId) {
      const discovered = await findTopLevelFolder(client, config);
      return discovered
        ? ((await client.nodes.get({
            nodeId: discovered.id,
            type: "folder",
          })) as unknown as ReadFolderDetail)
        : null;
    }
    if (isNotFound(error)) return null;
    throw error;
  }
};

/** Read the current state of this app's declared resources. Never mutates. */
export async function inspectProvisionedResources(
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
): Promise<AirAppResources> {
  return resolveProvisionedFolder(await readFolder(client, config), config);
}

/**
 * Per-(client, appId) provisioning state.
 *
 * Deliberately NOT module-level globals, which is what the copied version used:
 * a page holding two clients (or one app talking to two servers) would otherwise
 * share an in-flight promise and a server-capability flag across both.
 */
interface ProvisionState {
  inFlight: Promise<AirAppResources> | null;
  metadataUpdatesSupported: boolean | undefined;
}

const provisionStates = new WeakMap<object, Map<string, ProvisionState>>();

const stateFor = (client: AirAppProvisioningClient, appId: string): ProvisionState => {
  let byApp = provisionStates.get(client);
  if (!byApp) {
    byApp = new Map();
    provisionStates.set(client, byApp);
  }
  let state = byApp.get(appId);
  if (!state) {
    state = { inFlight: null, metadataUpdatesSupported: undefined };
    byApp.set(appId, state);
  }
  return state;
};

const sameFieldName = (actual: unknown, expected: unknown) =>
  JSON.stringify(actual) === JSON.stringify(expected);

const fieldMatches = (
  actual: AirAppFieldDeclaration | undefined,
  expected: AirAppFieldDeclaration,
) =>
  actual?.slug === expected.slug &&
  actual?.type === expected.type &&
  actual?.required === expected.required &&
  sameFieldName(actual?.name, expected.name);

/**
 * How an app evolves a Base it already owns: the declared field list may grow,
 * and only at the end.
 *
 * A live Base whose fields are a strict *prefix* of the declaration is an older
 * schema of ours, and the missing suffix is added. Anything else — a field
 * renamed, retyped, reordered, or removed — is not an upgrade this can reason
 * about, so it refuses rather than guessing which of the two shapes is right.
 *
 * @throws {AirAppSetupError} `SETUP_CONFLICT` when the existing fields are not a
 * prefix of the declared ones.
 */
const additiveFieldsFor = (
  actual: { fields?: unknown[] } | undefined,
  expected: AirAppBaseDeclaration,
): AirAppFieldDeclaration[] => {
  const fields = (actual?.fields ?? []) as AirAppFieldDeclaration[];
  if (
    fields.length > expected.fields.length ||
    !fields.every((field, index) => fieldMatches(field, expected.fields[index]))
  ) {
    throw setupError(
      "SETUP_CONFLICT",
      `The structure of ${expected.slug} does not match this app's declaration, so it cannot be upgraded safely`,
    );
  }
  return expected.fields.slice(fields.length);
};

/**
 * Before re-stamping an unstamped Base as ours, prove it is structurally the
 * Base we declared — same slug, name, description, and exact field list in
 * order. Without this, a stamp would launder a name collision into ownership.
 */
const validateRepairBase = (
  actual: {
    nodeId?: string;
    slug?: string;
    name?: string;
    description?: string;
    fields?: unknown[];
  },
  expected: AirAppBaseDeclaration | undefined,
  nodeId: string,
) => {
  if (!expected) {
    throw setupError("SETUP_CONFLICT", "Cannot repair a resource this app does not declare");
  }
  const fields = (actual?.fields ?? []) as AirAppFieldDeclaration[];
  const exactFields =
    fields.length === expected.fields.length &&
    fields.every((field, index) => fieldMatches(field, expected.fields[index]));
  if (
    actual?.nodeId !== nodeId ||
    actual?.slug !== expected.slug ||
    actual?.name !== expected.name ||
    actual?.description !== (expected.description ?? "") ||
    !exactFields
  ) {
    throw setupError(
      "SETUP_CONFLICT",
      `The structure of ${expected.slug} does not match this app's declaration, so it cannot be claimed safely`,
    );
  }
};

async function repairResourceOwnership(
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
  current: AirAppResources,
): Promise<AirAppResources> {
  if (!current.repairs.length) return current;
  const state = stateFor(client, config.appId);

  const baseRepairs = current.repairs.filter((repair) => repair.baseId);
  const baseByKey = new Map(config.bases.map((base) => [base.key, base]));
  const details = await Promise.all(
    baseRepairs.map((repair) => client.bases.get({ baseId: repair.baseId as string })),
  );

  // Identity first (is this the Base we declared?), then shape (is it an older
  // schema of ours that needs fields appended?). Doing shape first would let a
  // same-slug stranger with a compatible field prefix be "upgraded".
  const migrations = details.map((detail, index) => {
    const repair = baseRepairs[index];
    const expected = baseByKey.get(repair.resourceKey);
    if (!expected) {
      throw setupError("SETUP_CONFLICT", "Cannot repair a resource this app does not declare");
    }
    if (
      detail?.nodeId !== repair.nodeId ||
      detail?.slug !== expected.slug ||
      detail?.name !== expected.name ||
      detail?.description !== (expected.description ?? "")
    ) {
      throw setupError(
        "SETUP_CONFLICT",
        `The structure of ${expected.slug} does not match this app's declaration, so it cannot be upgraded safely`,
      );
    }
    return { repair, expected, fields: additiveFieldsFor(detail, expected) };
  });

  // One ChangeRequest per added field, each subject to the same approval-first
  // rule as any other change. A pending one is not a failure — it is the Space
  // admin's turn — so report which requests are waiting instead of retrying.
  const pendingFieldRequests: string[] = [];
  for (const migration of migrations) {
    for (const field of migration.fields) {
      const changeRequest = await client.bases.fieldChangeRequest({
        operation: "create",
        baseId: migration.repair.baseId as string,
        slug: field.slug,
        name: field.name,
        // The declaration's `type` is a plain `string` (see AirAppFieldDeclaration);
        // the server validates the real field-type enum on the wire.
        type: field.type as CreateFieldChangeRequestInput["type"],
        required: field.required,
        message: `Upgrade ${config.appName}: add ${field.slug}`,
        submittedBy: config.appId,
      });
      const merged =
        (changeRequest as { status?: string })?.status === "merged" ||
        (changeRequest as { materialized?: boolean })?.materialized === true;
      if (!merged) pendingFieldRequests.push((changeRequest as { id?: string })?.id ?? field.slug);
    }
  }
  if (pendingFieldRequests.length) {
    throw setupError(
      "SETUP_PENDING",
      `Submitted ${pendingFieldRequests.length} field upgrade request(s) awaiting Space admin approval: ${pendingFieldRequests.join(", ")}`,
    );
  }

  // Re-read only when something was actually added — the pre-upgrade details are
  // still authoritative otherwise, and a second round trip per Base is not free.
  const verified = migrations.some((migration) => migration.fields.length)
    ? await Promise.all(
        baseRepairs.map((repair) => client.bases.get({ baseId: repair.baseId as string })),
      )
    : details;
  verified.forEach((detail, index) => {
    const repair = baseRepairs[index];
    validateRepairBase(detail, baseByKey.get(repair.resourceKey), repair.nodeId);
  });

  if (state.metadataUpdatesSupported === false) {
    return { ...current, repairs: [], compatibilityMode: "verified-legacy-fingerprint" };
  }

  try {
    for (const repair of current.repairs) {
      await client.nodes.updateMetadata({ nodeId: repair.nodeId, metadata: repair.metadata });
      state.metadataUpdatesSupported = true;
    }
  } catch (error) {
    // A server predating `PATCH /nodes/{id}/metadata` answers 404. Ownership was
    // already proven by the structural fingerprint above, so stay usable.
    if (isNotFound(error)) {
      state.metadataUpdatesSupported = false;
      return { ...current, repairs: [], compatibilityMode: "verified-legacy-fingerprint" };
    }
    if (isForbidden(error)) {
      throw setupError(
        "SETUP_PERMISSION",
        "This account may not repair resource ownership metadata for this app",
      );
    }
    throw error;
  }

  const repaired = await inspectProvisionedResources(client, config);
  if (repaired.repairs.length) {
    throw setupError("SCHEMA_INCOMPLETE", "Ownership was repaired but read back incomplete");
  }
  return repaired;
}

/**
 * A merged ChangeRequest is not immediately readable — materialization is
 * asynchronous — so poll briefly rather than reporting a successful setup as
 * incomplete.
 */
const waitForMaterializedResources = async (
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
  attempts = 20,
): Promise<AirAppResources> => {
  let current: AirAppResources | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    current = await inspectProvisionedResources(client, config);
    current = await repairResourceOwnership(client, config, current);
    if (current.folder && current.missing.length === 0) return current;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
    }
  }
  throw setupError(
    "SCHEMA_INCOMPLETE",
    "Initialization merged but the resources read back incomplete",
  );
};

async function provisionOnce(
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
): Promise<AirAppResources> {
  let current = await inspectProvisionedResources(client, config);
  current = await repairResourceOwnership(client, config, current);
  if (current.folder && current.missing.length === 0) return current;

  const operations = buildProvisionOperations(config, current.folder, current.missing);
  let changeRequest: Awaited<ReturnType<BusabaseClient["nodes"]["createChangeRequest"]>>;
  try {
    changeRequest = await client.nodes.createChangeRequest({
      message: `Initialize ${config.appName} workspace`,
      submittedBy: config.appId,
      autoMerge: true,
      operations,
    });
  } catch (error) {
    if (isForbidden(error)) {
      throw setupError(
        "SETUP_PERMISSION",
        "This account may not create this app's resources in this Space",
      );
    }
    // Another tab/process may have won the race and created everything already.
    const concurrent = await inspectProvisionedResources(client, config).catch(() => null);
    if (concurrent?.folder && concurrent.missing.length === 0) return concurrent;
    throw error;
  }

  // `autoMerge: true` still yields a pending ChangeRequest when the actor lacks
  // write access — that is approval-first working as designed, not a failure.
  if (changeRequest?.status !== "merged") {
    throw setupError(
      "SETUP_PENDING",
      `Initialization request ${changeRequest?.id ?? ""} was submitted and awaits Space admin approval`.trim(),
    );
  }

  return waitForMaterializedResources(client, config);
}

/**
 * Ensure the declared Folder and Bases exist, as one idempotent ChangeRequest.
 *
 * Safe to call concurrently: calls for the same client + `appId` share one
 * in-flight promise, so a multi-pane app cannot submit the structure twice.
 *
 * @throws {AirAppSetupError} with a `code` describing which screen to show.
 */
export function provisionDeclaredResources(
  client: AirAppProvisioningClient,
  config: AirAppResourceConfig,
): Promise<AirAppResources> {
  const state = stateFor(client, config.appId);
  if (!state.inFlight) {
    state.inFlight = provisionOnce(client, config).finally(() => {
      state.inFlight = null;
    });
  }
  return state.inFlight;
}

/** The client surface `publishAirApp` needs, on top of provisioning. */
export type AirAppPublishClient = AirAppProvisioningClient &
  Pick<BusabaseClient, "fileTrees" | "changeRequests">;

/** One file of the app's built AirApp bundle, as `publishAirApp` receives it. */
export interface AirAppFileInput {
  path: string;
  content: string;
  mimeType?: string;
}

export type AirAppPublishResult =
  | { status: "created"; changeRequestId: string }
  | { status: "updated"; changeRequestId: string }
  | { status: "pending"; changeRequestId: string };

/**
 * The create-vs-update operation list for one AirApp publish. Pure — no I/O —
 * so the decision is directly testable: a local path already present on the
 * deployed node updates it, anything else is a new file. Never deletes a
 * remote-only path — a file this bundle stopped shipping is left alone rather
 * than assumed stale, the same conservative choice the rest of this module
 * makes for a Base's fields (`additiveFieldsFor` only ever appends).
 */
export function buildAirAppFileOperations(
  localFiles: AirAppFileInput[],
  deployedPaths: Iterable<string>,
): FileTreeCreateOrUpdateOperation[] {
  const deployed = new Set(deployedPaths);
  return localFiles.map(
    (file) =>
      ({
        kind: deployed.has(file.path) ? "update" : "create",
        path: file.path,
        content: file.content,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
      }) as FileTreeCreateOrUpdateOperation,
  );
}

/**
 * Find a still-pending ChangeRequest that already proposes creating this
 * declared AirApp, so a second `publishAirApp` call before the first is
 * reviewed does not propose a second, duplicate create for the same slug.
 *
 * Scoped to the first 500 in-review ChangeRequests (10 pages of 50) — a
 * Space with more open reviews than that has bigger problems than this
 * scan not reaching the one it is looking for, and a missed match only
 * costs an extra (harmless, reviewer-visible) duplicate proposal, never a
 * wrong merge.
 */
async function findPendingAirAppCreate(
  client: AirAppPublishClient,
  slug: string,
): Promise<string | null> {
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await client.changeRequests.list({
      status: ["in_review"],
      ...(cursor ? { cursor } : {}),
    });
    for (const changeRequest of result.changeRequests) {
      const matches = (changeRequest.operations ?? []).some((operation) => {
        const payload = operation.headCommit?.payload as
          | { kind?: string; nodeType?: string; slug?: string }
          | undefined;
        return (
          payload?.kind === "create" && payload?.nodeType === "airapp" && payload?.slug === slug
        );
      });
      if (matches) return changeRequest.id;
    }
    if (!result.nextCursor) return null;
    cursor = result.nextCursor;
  }
  return null;
}

/**
 * Publish the app's own AirApp bundle: create it under the Folder when this
 * Space has never had it, or propose the local files as an update when it
 * already exists. Always a separate, always-review-first ChangeRequest from
 * the data layer's `provisionDeclaredResources` — see the note on
 * `AirAppNodeDeclaration` for why the two must never share a request.
 *
 * Call after `provisionDeclaredResources` has confirmed the Folder exists.
 * Every call proposes the full local file list, even when nothing actually
 * changed — this module has no access to the deployed content hashes
 * (`fileTrees.listFiles` reports paths, not hashes; only a per-file
 * `readFile` does, and fetching one per file to skip a no-op publish is not
 * worth the round trips a normal publish cadence would spend on it). A
 * reviewer sees an empty diff and merges or ignores it; this is a cost in
 * review noise, not correctness.
 *
 * @throws {AirAppSetupError} `SETUP_CONFLICT` when `config` declares no
 * `airApp`; `SETUP_REQUIRED` when the Folder does not exist yet.
 */
export async function publishAirApp(
  client: AirAppPublishClient,
  config: AirAppResourceConfig,
  files: AirAppFileInput[],
): Promise<AirAppPublishResult> {
  const airApp = config.airApp;
  if (!airApp) {
    throw setupError("SETUP_CONFLICT", "This app does not declare an airApp to publish");
  }
  const current = await inspectProvisionedResources(client, config);
  if (!current.folder) {
    throw setupError(
      "SETUP_REQUIRED",
      "Provision the Folder and Bases with provisionDeclaredResources before publishing the AirApp",
    );
  }

  if (!current.airApp) {
    // The node does not exist yet, but a previous call may already have
    // proposed creating it and be awaiting review — `inspectProvisionedResources`
    // only ever sees materialized nodes, so without this check every call
    // before that review lands would propose another identical create.
    const pendingChangeRequestId = await findPendingAirAppCreate(client, airApp.slug);
    if (pendingChangeRequestId) {
      return { status: "pending", changeRequestId: pendingChangeRequestId };
    }

    const changeRequest = await client.fileTrees.create({
      type: "airapp",
      parentNodeId: current.folder.nodeId,
      slug: airApp.slug,
      name: airApp.name,
      description: airApp.description ?? "",
      files: files as FileTreeCreateInput["files"],
      mergeMode: "replace",
      // Explicit even though this app's write-permission credential would
      // otherwise auto-merge it: executable AirApp code always gets human
      // review before it runs in a viewer's browser, no exceptions.
      autoMerge: false,
    });
    // `autoMerge: false` always takes the pending-ChangeRequest branch of the
    // output union at runtime; this narrows the static type to match, rather
    // than widening `changeRequestId` to `string | undefined` for a branch
    // that cannot happen.
    if (changeRequest.materialized) {
      throw setupError(
        "SCHEMA_INCOMPLETE",
        "AirApp create unexpectedly materialized despite autoMerge: false",
      );
    }
    return { status: "created", changeRequestId: changeRequest.id };
  }

  const deployedFiles = await client.fileTrees.listFiles({
    nodeId: current.airApp.nodeId,
    type: "airapp",
  });
  const operations = buildAirAppFileOperations(
    files,
    deployedFiles.map((file) => file.path),
  );
  const changeRequest = await client.fileTrees.createChangeRequest({
    nodeId: current.airApp.nodeId,
    type: "airapp",
    operations,
    message: `Publish ${config.appName} AirApp`,
    submittedBy: config.appId,
    autoMerge: false,
  });
  return { status: "updated", changeRequestId: changeRequest.id };
}
