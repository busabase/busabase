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

import type { BusabaseClient } from "./client.js";

type NodeChangeRequestInput = Parameters<BusabaseClient["nodes"]["createChangeRequest"]>[0];
type NodeOperationInput = NodeChangeRequestInput["operations"][number];
type CreateNodeOperationInput = Extract<NodeOperationInput, { kind: "create" }>;

/**
 * A Base field, typed straight off the contract so a declaration can never drift
 * from what `nodes.createChangeRequest` actually accepts.
 */
export type AirAppFieldDeclaration = NonNullable<CreateNodeOperationInput["fields"]>[number];

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
 * It is provisioned by publishing the AirApp, not by this module — so it is
 * never created here, only recognized and stamped. Declaring it matters for a
 * second reason: without it, an unstamped Folder holding the app's own AirApp
 * would look like it holds an unattributable stranger, and the legacy claim
 * would be refused.
 */
export interface AirAppNodeDeclaration {
  slug: string;
  name: string;
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
 * A type alias rather than an `interface` on purpose: `nodes.updateMetadata`
 * and the create operations take `Record<string, unknown>`, and an interface —
 * being open to declaration merging — is not assignable to an index signature.
 */
export type AirAppResourceOwnership = {
  appId: string;
  resourceKey: string;
  schemaVersion: number;
};

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
  hasResourceIdentity(node, appId, "app-root") && node?.metadata?.schemaVersion === schemaVersion;

const hasEmptyMetadata = (node: ReadNode | undefined) =>
  Object.keys(node?.metadata ?? {}).length === 0;

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
 * The AirApp equivalent of the legacy claim: an unstamped `airapp` node counts
 * as ours only when its slug and name still match what we declare.
 */
const matchesLegacyAirApp = (node: ReadNode | undefined, config: AirAppResourceConfig) =>
  hasEmptyMetadata(node) &&
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
    return { folder: null, bases: [], missing: [...config.bases], repairs: [] };
  }
  if (folder.node?.type !== "folder" || folder.node?.slug !== config.folder.slug) {
    throw setupError(
      "SETUP_CONFLICT",
      `A different Folder already uses the slug ${config.folder.slug}; nothing was changed`,
    );
  }

  const rootOwned = hasResourceIdentity(folder.node, config.appId, "app-root");
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
      resourceKey: "app-root",
      metadata: resourceMetadata(config, "app-root"),
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

  // The app's own AirApp node, if it declares one. Never created here — an
  // AirApp is published, not provisioned — only recognized and stamped.
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
      metadata: resourceMetadata(config, "app-root"),
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
      fields: base.fields,
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
        type: field.type,
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
