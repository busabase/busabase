import { describe, expect, it, vi } from "vitest";
import {
  type AirAppProvisioningClient,
  type AirAppResourceConfig,
  AirAppSetupError,
  buildProvisionOperations,
  inspectProvisionedResources,
  provisionDeclaredResources,
  resolveProvisionedFolder,
} from "./airapp.js";

const FIELDS = [
  { slug: "contact-id", name: "Contact ID", type: "text" as const, required: true, options: {} },
  { slug: "name", name: "Name", type: "text" as const, required: false, options: {} },
];

const config = (overrides: Partial<AirAppResourceConfig> = {}): AirAppResourceConfig => ({
  appId: "kelly-crm",
  appName: "Kelly CRM",
  schemaVersion: 1,
  folder: { slug: "kelly-crm", name: "Kelly CRM", description: "CRM workspace" },
  bases: [
    {
      key: "contacts",
      slug: "kelly-crm-contacts-v1",
      name: "Contacts",
      description: "People",
      fields: FIELDS,
    },
  ],
  ...overrides,
});

const node = (overrides: Record<string, unknown> = {}) => ({
  id: "node-1",
  type: "folder",
  slug: "kelly-crm",
  name: "Kelly CRM",
  description: "CRM workspace",
  baseId: null,
  metadata: {},
  ...overrides,
});

const baseChild = (overrides: Record<string, unknown> = {}) =>
  node({
    id: "node-base",
    type: "base",
    slug: "kelly-crm-contacts-v1",
    name: "Contacts",
    description: "People",
    baseId: "base-1",
    ...overrides,
  });

const owned = (resourceKey: string, schemaVersion = 1) => ({
  appId: "kelly-crm",
  resourceKey,
  schemaVersion,
});

// Test doubles carry only the fields provisioning actually reads, so they are
// deliberately looser than the real NodeVO/folder detail shapes.
type TestNode = ReturnType<typeof node>;
const asFolder = (folderNode: TestNode, children: TestNode[]) =>
  ({ node: folderNode, children }) as unknown as Parameters<typeof resolveProvisionedFolder>[0];

describe("resolveProvisionedFolder — ownership rules", () => {
  it("reports everything missing when the Folder does not exist", () => {
    const result = resolveProvisionedFolder(null, config());
    expect(result.folder).toBeNull();
    expect(result.missing).toHaveLength(1);
    expect(result.bases).toHaveLength(0);
  });

  it("resolves a fully-stamped Folder with no repairs", () => {
    const result = resolveProvisionedFolder(
      asFolder(node({ metadata: owned("app-root") }), [baseChild({ metadata: owned("contacts") })]),
      config(),
    );
    expect(result.folder?.nodeId).toBe("node-1");
    expect(result.bases[0]).toMatchObject({ nodeId: "node-base", baseId: "base-1" });
    expect(result.missing).toHaveLength(0);
    expect(result.repairs).toHaveLength(0);
  });

  it("queues a repair — not a recreate — when the stamp is a stale schemaVersion", () => {
    const result = resolveProvisionedFolder(
      asFolder(node({ metadata: owned("app-root", 0) }), [
        baseChild({ metadata: owned("contacts", 0) }),
      ]),
      config(),
    );
    expect(result.repairs.map((repair) => repair.resourceKey)).toEqual(["app-root", "contacts"]);
    // The data still resolves — a version bump must never orphan live Bases.
    expect(result.bases[0]?.baseId).toBe("base-1");
    expect(result.missing).toHaveLength(0);
  });

  it("refuses a Folder stamped by a different app", () => {
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node({ metadata: { appId: "someone-else", resourceKey: "app-root" } }), []),
        config(),
      ),
    ).toThrow(/SETUP_CONFLICT/);
  });

  it("refuses a node that is not a Folder, or whose slug differs", () => {
    expect(() => resolveProvisionedFolder(asFolder(node({ type: "base" }), []), config())).toThrow(
      /SETUP_CONFLICT/,
    );
    expect(() =>
      resolveProvisionedFolder(asFolder(node({ slug: "something-else" }), []), config()),
    ).toThrow(/SETUP_CONFLICT/);
  });

  it("claims an unstamped Folder only on an exact declaration match", () => {
    const claimed = resolveProvisionedFolder(asFolder(node(), [baseChild()]), config());
    expect(claimed.folder?.nodeId).toBe("node-1");
    expect(claimed.repairs).toHaveLength(2);
  });

  it.each([
    ["name", { name: "Quarterly planning" }],
    ["description", { description: "Someone else's notes" }],
  ])(
    "refuses an unstamped Folder whose %s diverges from the declaration",
    (_attribute, divergence) => {
      // Children are present on purpose: without them this would also trip the
      // "unstamped Folder is missing a declared resource" branch, and a loose
      // /SETUP_CONFLICT/ assertion would pass even if the ownership fingerprint
      // were removed entirely. Assert the ownership message specifically.
      expect(() =>
        resolveProvisionedFolder(asFolder(node(divergence), [baseChild()]), config()),
      ).toThrow(/SETUP_CONFLICT: The Folder kelly-crm does not belong to this app/);
    },
  );

  it("refuses an unstamped Base whose structure diverges from the declaration", () => {
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node({ metadata: owned("app-root") }), [baseChild({ name: "Leads" })]),
        config(),
      ),
    ).toThrow(/SETUP_CONFLICT: The resource kelly-crm-contacts-v1 does not match/);
  });

  it("refuses to claim an unstamped Folder that is missing a declared Base", () => {
    expect(() => resolveProvisionedFolder(asFolder(node(), []), config())).toThrow(
      /SETUP_CONFLICT.*kelly-crm-contacts-v1/,
    );
  });

  it("refuses to claim an unstamped Folder holding an unattributable extra node", () => {
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node(), [baseChild(), node({ id: "x", slug: "someone-elses-notes" })]),
        config(),
      ),
    ).toThrow(/SETUP_CONFLICT.*someone-elses-notes/);
  });

  it("refuses when two children share the declared slug", () => {
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node({ metadata: owned("app-root") }), [
          baseChild({ id: "a", metadata: owned("contacts") }),
          baseChild({ id: "b", metadata: owned("contacts") }),
        ]),
        config(),
      ),
    ).toThrow(/SETUP_CONFLICT/);
  });

  it("refuses when the declared slug is taken by a non-Base node", () => {
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node({ metadata: owned("app-root") }), [
          baseChild({ type: "doc", baseId: null, metadata: owned("contacts") }),
        ]),
        config(),
      ),
    ).toThrow(/SETUP_CONFLICT/);
  });

  it("carries a machine-readable code, not just a prefixed message", () => {
    try {
      resolveProvisionedFolder(asFolder(node({ slug: "other" }), []), config());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AirAppSetupError);
      expect((error as AirAppSetupError).code).toBe("SETUP_CONFLICT");
      // The historical `"CODE: detail"` message shape is preserved so apps that
      // parse the prefix keep working while they migrate to `.code`.
      expect((error as AirAppSetupError).message).toMatch(/^SETUP_CONFLICT: /);
    }
  });
});

describe("buildProvisionOperations", () => {
  it("nests new Bases under the new Folder via a temp ref in one change request", () => {
    const operations = buildProvisionOperations(config(), null, config().bases);
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({ kind: "create", nodeType: "folder", ref: "app-root" });
    expect(operations[1]).toMatchObject({ kind: "create", parentNodeRef: "app-root" });
    expect(operations[1]).not.toHaveProperty("parentNodeId");
  });

  it("parents new Bases by id when the Folder already exists", () => {
    const operations = buildProvisionOperations(config(), { nodeId: "node-1" }, config().bases);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ parentNodeId: "node-1", nodeType: "base" });
  });

  it("stamps ownership on everything it creates", () => {
    const operations = buildProvisionOperations(config(), null, config().bases);
    expect(operations[0]).toMatchObject({ metadata: owned("app-root") });
    expect(operations[1]).toMatchObject({ metadata: owned("contacts") });
  });
});

interface FakeClientOptions {
  roots?: unknown[];
  folder?: unknown;
  changeRequest?: unknown;
  createError?: unknown;
}

const fakeClient = (options: FakeClientOptions = {}) => {
  const calls = { list: 0, get: 0, create: 0, updateMetadata: 0 };
  const client = {
    nodes: {
      list: vi.fn(async () => {
        calls.list += 1;
        return options.roots ?? [];
      }),
      get: vi.fn(async () => {
        calls.get += 1;
        if (!options.folder) throw Object.assign(new Error("nope"), { code: "NOT_FOUND" });
        return options.folder;
      }),
      createChangeRequest: vi.fn(async () => {
        calls.create += 1;
        if (options.createError) throw options.createError;
        return options.changeRequest ?? { id: "cr-1", status: "merged" };
      }),
      updateMetadata: vi.fn(async () => {
        calls.updateMetadata += 1;
        return {};
      }),
    },
    bases: { get: vi.fn(async () => ({})) },
  };
  return { client: client as unknown as AirAppProvisioningClient, calls, spies: client };
};

describe("inspectProvisionedResources", () => {
  it("discovers the Folder by slug when no id is pinned", async () => {
    const folderNode = node({ metadata: owned("app-root") });
    const { client } = fakeClient({
      roots: [{ ...node({ id: "root", slug: "root" }), children: [folderNode] }],
      folder: { node: folderNode, children: [baseChild({ metadata: owned("contacts") })] },
    });
    const result = await inspectProvisionedResources(client, config());
    expect(result.folder?.nodeId).toBe("node-1");
    expect(result.bases).toHaveLength(1);
  });

  it("treats a missing Folder as 'not provisioned yet', not an error", async () => {
    const { client } = fakeClient({ roots: [] });
    const result = await inspectProvisionedResources(client, config());
    expect(result.folder).toBeNull();
    expect(result.missing).toHaveLength(1);
  });

  it("refuses when the slug matches more than one Folder", async () => {
    const dup = node({ metadata: owned("app-root") });
    const { client } = fakeClient({ roots: [dup, { ...dup, id: "node-2" }] });
    await expect(inspectProvisionedResources(client, config())).rejects.toThrow(/SETUP_CONFLICT/);
  });
});

describe("provisionDeclaredResources", () => {
  it("submits one change request and returns the materialized resources", async () => {
    const folderNode = node({ metadata: owned("app-root") });
    const state = fakeClient({ roots: [], changeRequest: { id: "cr-1", status: "merged" } });
    // First inspect finds nothing; after the merge the Folder reads back.
    let created = false;
    state.spies.nodes.list.mockImplementation(async () =>
      created ? [{ ...folderNode, children: [] }] : [],
    );
    state.spies.nodes.get.mockImplementation(async () => ({
      node: folderNode,
      children: [baseChild({ metadata: owned("contacts") })],
    }));
    state.spies.nodes.createChangeRequest.mockImplementation(async () => {
      created = true;
      return { id: "cr-1", status: "merged" };
    });

    const result = await provisionDeclaredResources(state.client, config());
    expect(state.spies.nodes.createChangeRequest).toHaveBeenCalledTimes(1);
    expect(result.folder?.nodeId).toBe("node-1");
    expect(result.missing).toHaveLength(0);
  });

  it("reports a pending change request as SETUP_PENDING, not a failure", async () => {
    const state = fakeClient({ roots: [], changeRequest: { id: "cr-9", status: "pending" } });
    await expect(provisionDeclaredResources(state.client, config())).rejects.toThrow(
      /SETUP_PENDING.*cr-9/,
    );
  });

  it("maps a FORBIDDEN create onto SETUP_PERMISSION", async () => {
    const state = fakeClient({ roots: [], createError: { code: "FORBIDDEN" } });
    await expect(provisionDeclaredResources(state.client, config())).rejects.toThrow(
      /SETUP_PERMISSION/,
    );
  });

  it("shares one in-flight submission across concurrent callers", async () => {
    const state = fakeClient({ roots: [], changeRequest: { id: "cr-1", status: "pending" } });
    const results = await Promise.allSettled([
      provisionDeclaredResources(state.client, config()),
      provisionDeclaredResources(state.client, config()),
      provisionDeclaredResources(state.client, config()),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    // Without the shared promise this would submit the structure three times.
    expect(state.spies.nodes.createChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("keeps in-flight state per client, so two clients do not block each other", async () => {
    // The copied module kept this in a module-level global: a page holding two
    // clients (or one app talking to two servers) shared a single in-flight
    // promise, and the second client silently received the first one's result.
    const a = fakeClient({ roots: [], changeRequest: { id: "cr-a", status: "pending" } });
    const b = fakeClient({ roots: [], changeRequest: { id: "cr-b", status: "pending" } });
    const [resultA, resultB] = await Promise.allSettled([
      provisionDeclaredResources(a.client, config()),
      provisionDeclaredResources(b.client, config()),
    ]);
    expect(resultA.status === "rejected" && String(resultA.reason)).toMatch(/cr-a/);
    expect(resultB.status === "rejected" && String(resultB.reason)).toMatch(/cr-b/);
    expect(a.spies.nodes.createChangeRequest).toHaveBeenCalledTimes(1);
    expect(b.spies.nodes.createChangeRequest).toHaveBeenCalledTimes(1);
  });

  it("does not resubmit when a concurrent process already created everything", async () => {
    const folderNode = node({ metadata: owned("app-root") });
    const state = fakeClient({ roots: [] });
    let inspectCount = 0;
    state.spies.nodes.list.mockImplementation(async () => {
      inspectCount += 1;
      return inspectCount === 1 ? [] : [{ ...folderNode, children: [] }];
    });
    state.spies.nodes.get.mockImplementation(async () => ({
      node: folderNode,
      children: [baseChild({ metadata: owned("contacts") })],
    }));
    state.spies.nodes.createChangeRequest.mockImplementation(async () => {
      throw new Error("slug already taken");
    });

    const result = await provisionDeclaredResources(state.client, config());
    expect(result.folder?.nodeId).toBe("node-1");
  });
});

// The four App-in-Skills on the richer provisioning variant declare an AirApp
// node alongside their Bases, and evolve those Bases by appending fields. Both
// behaviours are ported from `kelly-jobhunt`'s own provisioning test suite,
// which is the de-facto spec for them.
const airAppConfig = (overrides: Partial<AirAppResourceConfig> = {}) =>
  config({
    airApp: { slug: "kelly-crm-app", name: "Kelly CRM", resourceKey: "airapp" },
    ...overrides,
  });

const airAppChild = (overrides: Record<string, unknown> = {}) =>
  node({
    id: "node-airapp",
    type: "airapp",
    slug: "kelly-crm-app",
    name: "Kelly CRM",
    description: "",
    ...overrides,
  });

describe("declared AirApp node", () => {
  it("stamps an unstamped AirApp inside an otherwise-legacy Folder", () => {
    const result = resolveProvisionedFolder(
      asFolder(node(), [baseChild(), airAppChild()]),
      airAppConfig(),
    );
    expect(result.repairs.map((repair) => repair.resourceKey)).toContain("airapp");
    expect(result.folder?.nodeId).toBe("node-1");
  });

  it("leaves an already-stamped AirApp alone", () => {
    const result = resolveProvisionedFolder(
      asFolder(node({ metadata: owned("app-root") }), [
        baseChild({ metadata: owned("contacts") }),
        airAppChild({ metadata: owned("airapp") }),
      ]),
      airAppConfig(),
    );
    expect(result.repairs).toHaveLength(0);
  });

  it("still refuses a legacy Folder holding somebody else's AirApp", () => {
    // The AirApp exemption is scoped to the one we declare; without that, any
    // stray AirApp would launder an unclaimable Folder into a claimable one.
    expect(() =>
      resolveProvisionedFolder(
        asFolder(node(), [baseChild(), airAppChild({ slug: "someone-elses-app", name: "Other" })]),
        airAppConfig(),
      ),
    ).toThrow(/SETUP_CONFLICT.*someone-elses-app/);
  });

  it("treats an AirApp as an unattributable stranger when none is declared", () => {
    expect(() =>
      resolveProvisionedFolder(asFolder(node(), [baseChild(), airAppChild()]), config()),
    ).toThrow(/SETUP_CONFLICT.*kelly-crm-app/);
  });
});

describe("additive field migration", () => {
  const olderSchema = { ...FIELDS[0] };
  const detailFor = (fields: unknown[]) => ({
    nodeId: "node-base",
    slug: "kelly-crm-contacts-v1",
    name: "Contacts",
    description: "People",
    fields,
  });

  // The double persists ownership stamps, because the SDK re-reads after
  // repairing and reports SCHEMA_INCOMPLETE if the stamp did not stick — a fake
  // that forgets writes fails a correct implementation.
  const migrationClient = (
    initialFields: unknown[],
    fieldRequest: { id?: string; status?: string; materialized?: boolean },
  ) => {
    const stamps = new Map<string, Record<string, unknown>>();
    let upgraded = false;
    const stamped = (source: TestNode) => ({
      ...source,
      metadata: stamps.get(source.id) ?? source.metadata,
    });
    const children = () => [stamped(baseChild()), stamped(airAppChild())];
    const root = () => stamped(node());
    const client = {
      nodes: {
        list: vi.fn(async () => [{ ...root(), children: children() }]),
        get: vi.fn(async () => ({ node: root(), children: children() })),
        createChangeRequest: vi.fn(async () => ({ id: "cr-1", status: "merged" })),
        updateMetadata: vi.fn(
          async ({ nodeId, metadata }: { nodeId: string; metadata: Record<string, unknown> }) => {
            stamps.set(nodeId, metadata);
            return {};
          },
        ),
      },
      bases: {
        get: vi.fn(async () => detailFor(upgraded ? FIELDS : initialFields)),
        fieldChangeRequest: vi.fn(async (_input: Record<string, unknown>) => {
          upgraded = true;
          return fieldRequest;
        }),
      },
    };
    return { client: client as unknown as AirAppProvisioningClient, spies: client };
  };

  it("adds only the declared suffix fields when upgrading an owned older schema", async () => {
    const { client, spies } = migrationClient([olderSchema], { id: "cr-f1", status: "merged" });
    await inspectProvisionedResources(client, airAppConfig()).then((current) =>
      provisionDeclaredResources(client, airAppConfig()).catch(() => current),
    );
    expect(spies.bases.fieldChangeRequest).toHaveBeenCalledTimes(1);
    expect(spies.bases.fieldChangeRequest.mock.calls[0][0]).toMatchObject({
      operation: "create",
      slug: "name",
      baseId: "base-1",
    });
  });

  it("reports an unapproved field upgrade as SETUP_PENDING, naming the request", async () => {
    const { client } = migrationClient([olderSchema], { id: "cr-f9", status: "pending" });
    await expect(provisionDeclaredResources(client, airAppConfig())).rejects.toThrow(
      /SETUP_PENDING.*cr-f9/,
    );
  });

  it("accepts a change request the server merged and materialized in one step", async () => {
    const { client } = migrationClient([olderSchema], { id: "cr-f1", materialized: true });
    await expect(provisionDeclaredResources(client, airAppConfig())).resolves.toBeTruthy();
  });

  it("refuses when the live fields are not a prefix of the declaration", async () => {
    // Renamed, retyped, reordered, or removed — not an upgrade this can reason
    // about, so it must not guess which shape is correct.
    const { client } = migrationClient([{ ...FIELDS[0], type: "longtext" }], {
      id: "cr-f1",
      status: "merged",
    });
    await expect(provisionDeclaredResources(client, airAppConfig())).rejects.toThrow(
      /SETUP_CONFLICT.*cannot be upgraded safely/,
    );
  });

  it("refuses when the live Base has MORE fields than declared", async () => {
    const { client } = migrationClient([...FIELDS, { ...FIELDS[0], slug: "extra" }], {
      id: "cr-f1",
      status: "merged",
    });
    await expect(provisionDeclaredResources(client, airAppConfig())).rejects.toThrow(
      /SETUP_CONFLICT/,
    );
  });

  it("submits nothing when the schema already matches", async () => {
    const { client, spies } = migrationClient(FIELDS, { id: "cr-f1", status: "merged" });
    await provisionDeclaredResources(client, airAppConfig()).catch(() => null);
    expect(spies.bases.fieldChangeRequest).not.toHaveBeenCalled();
  });
});

describe("AirAppFieldDeclaration accepts a hand-authored plain-JS declaration", () => {
  // Real callers write `appConfig` as a literal object in a plain .js config
  // file — no `as const`, no cast. This helper reproduces that: its return
  // type's `type` property is exactly `string`, the same widened inference
  // TypeScript gives a `.js` file's exported object literal. If
  // AirAppFieldDeclaration ever narrows `type` back to the contract's field-type
  // enum, this file stops compiling — `tsc --noEmit` catches it even though
  // vitest itself does not type-check.
  const declareField = (slug: string, name: string, type: string, required: boolean) => ({
    slug,
    name,
    type,
    required,
  });

  it("type-checks and resolves without a cast", () => {
    const declaredConfig: AirAppResourceConfig = {
      appId: "kelly-plain",
      appName: "Kelly Plain",
      schemaVersion: 1,
      folder: { slug: "kelly-plain", name: "Kelly Plain", description: "" },
      bases: [
        {
          key: "contacts",
          slug: "kelly-plain-contacts-v1",
          name: "Contacts",
          description: "",
          fields: [declareField("name", "Name", "text", true)],
        },
      ],
    };
    const result = resolveProvisionedFolder(null, declaredConfig);
    expect(result.missing).toHaveLength(1);
  });
});
