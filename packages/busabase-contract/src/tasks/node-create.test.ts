import { describe, expect, it, vi } from "vitest";
import { nodeCreateTask } from "./node-create";
import type { BusabaseTaskClient } from "./types";

const prompts = [
  { key: "log-visit", label: "Log a customer visit", body: "{target}\n\nAdd a visit record." },
];

/** A client whose create endpoints return whatever the test hands them. */
const clientFor = (
  overrides: Record<string, unknown>,
): {
  client: BusabaseTaskClient;
  updateAgentPrompts: ReturnType<typeof vi.fn>;
  updateMetadata: ReturnType<typeof vi.fn>;
} => {
  const updateAgentPrompts = vi.fn(async () => ({ nodeId: "nod_1", agentPrompts: prompts }));
  const updateMetadata = vi.fn(async () => ({ id: "nod_1" }));
  const client = {
    nodes: { updateAgentPrompts, updateMetadata, createChangeRequest: vi.fn() },
    ...overrides,
  } as unknown as BusabaseTaskClient;
  return { client, updateAgentPrompts, updateMetadata };
};

describe("nodeCreateTask agentPrompts", () => {
  it("declares agentPrompts as a parameter, so it reaches both the CLI and MCP", () => {
    expect(nodeCreateTask.params.map((param) => param.name)).toContain("agentPrompts");
  });

  it("writes the prompts onto the Base's OWNING node id, not the Base id", async () => {
    const create = vi.fn(async () => ({
      materialized: true,
      id: "bas_1",
      nodeId: "nod_1",
    }));
    const { client, updateAgentPrompts } = clientFor({ bases: { create } });

    const result = await nodeCreateTask.execute(client, {
      type: "base",
      slug: "visits",
      name: "Visits",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      agentPrompts: prompts,
    });

    expect(updateAgentPrompts).toHaveBeenCalledWith({ nodeId: "nod_1", agentPrompts: prompts });
    expect(result).toMatchObject({
      agentPromptsWrite: { written: true, nodeId: "nod_1", count: 1 },
    });
  });

  // Doc / File / Skill / Drive / AirApp all wrap their node under `node`.
  it("reads the node id out of a wrapped node result", async () => {
    const create = vi.fn(async () => ({ materialized: true, node: { id: "nod_doc" }, body: "" }));
    const { client, updateAgentPrompts } = clientFor({ docs: { create } });

    await nodeCreateTask.execute(client, {
      type: "doc",
      slug: "readme",
      name: "README",
      body: "# Hi",
      agentPrompts: prompts,
    });

    expect(updateAgentPrompts).toHaveBeenCalledWith({ nodeId: "nod_doc", agentPrompts: prompts });
  });

  it("takes the merged create operation's node id for a folder", async () => {
    const createChangeRequest = vi.fn(async () => ({
      id: "cr_1",
      status: "merged",
      operations: [{ operation: "create", nodeId: "nod_folder" }],
    }));
    const { client, updateAgentPrompts } = clientFor({
      nodes: {
        createChangeRequest,
        updateAgentPrompts: vi.fn(async () => ({})),
        updateMetadata: vi.fn(),
      },
    });
    // The overridden namespace carries its own spy; read it back off the client.
    const spy = (client.nodes as unknown as { updateAgentPrompts: ReturnType<typeof vi.fn> })
      .updateAgentPrompts;
    void updateAgentPrompts;

    await nodeCreateTask.execute(client, {
      type: "folder",
      slug: "growth",
      name: "Growth",
      agentPrompts: prompts,
    });

    expect(spy).toHaveBeenCalledWith({ nodeId: "nod_folder", agentPrompts: prompts });
  });

  // Review-first: the node does not exist yet, so the prompts genuinely cannot
  // be written. Reporting that is the whole point — a silent drop would leave
  // the caller believing the node has prompts it does not have.
  it("reports the skip instead of dropping prompts when the create is pending review", async () => {
    const create = vi.fn(async () => ({ materialized: false, id: "cr_1", status: "in_review" }));
    const { client, updateAgentPrompts } = clientFor({ bases: { create } });

    const result = await nodeCreateTask.execute(client, {
      type: "base",
      slug: "visits",
      name: "Visits",
      fields: [],
      requireReview: true,
      agentPrompts: prompts,
    });

    expect(updateAgentPrompts).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "cr_1",
      agentPromptsWrite: { written: false },
    });
    expect(
      (result as { agentPromptsWrite: { nextStep: string } }).agentPromptsWrite.nextStep,
    ).toContain("set-agent-prompts");
  });

  // The caller can fix a malformed list; they cannot un-create a node. So the
  // validation has to happen before anything is created.
  it("rejects a malformed prompt list before creating anything", async () => {
    const create = vi.fn();
    const { client, updateAgentPrompts } = clientFor({ bases: { create } });

    await expect(
      nodeCreateTask.execute(client, {
        type: "base",
        slug: "visits",
        name: "Visits",
        fields: [],
        agentPrompts: [{ key: "a", label: "A" }],
      }),
    ).rejects.toThrow(/Invalid agentPrompts/);

    expect(create).not.toHaveBeenCalled();
    expect(updateAgentPrompts).not.toHaveBeenCalled();
  });

  it("names the duplicate key rather than failing vaguely", async () => {
    const { client } = clientFor({ bases: { create: vi.fn() } });

    await expect(
      nodeCreateTask.execute(client, {
        type: "base",
        slug: "visits",
        name: "Visits",
        fields: [],
        agentPrompts: [prompts[0], prompts[0]],
      }),
    ).rejects.toThrow(/duplicate key "log-visit"/);
  });

  // `agent_prompts` is the only place the server reads prompts from, so a 404
  // has to surface. This used to fall back to `metadata.agentPrompts`; that is
  // gone — the migration adding the column backfilled the old key, so a server
  // old enough to 404 recovers on upgrade, while a 404 from any other cause
  // used to park the list under a key nothing reads and still report success.
  it("fails instead of writing to metadata when the server has no agent-prompts endpoint", async () => {
    const create = vi.fn(async () => ({ materialized: true, id: "bas_1", nodeId: "nod_1" }));
    const { client, updateMetadata } = clientFor({ bases: { create } });
    (
      client.nodes as unknown as { updateAgentPrompts: ReturnType<typeof vi.fn> }
    ).updateAgentPrompts.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    await expect(
      nodeCreateTask.execute(client, {
        type: "base",
        slug: "visits",
        name: "Visits",
        fields: [],
        agentPrompts: prompts,
      }),
    ).rejects.toThrow(/Not Found/);

    expect(updateMetadata).not.toHaveBeenCalled();
  });

  it("does not touch the prompts endpoints when no prompts were given", async () => {
    const create = vi.fn(async () => ({ materialized: true, id: "bas_1", nodeId: "nod_1" }));
    const { client, updateAgentPrompts, updateMetadata } = clientFor({ bases: { create } });

    const result = await nodeCreateTask.execute(client, {
      type: "base",
      slug: "visits",
      name: "Visits",
      fields: [],
    });

    expect(updateAgentPrompts).not.toHaveBeenCalled();
    expect(updateMetadata).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("agentPromptsWrite");
  });
});

describe("nodeCreateTask visibility", () => {
  /** A materialized node as every current server returns it. */
  const nodeVO = (id: string, explicitVisibility: string | null) => ({
    id,
    metadata: {},
    explicitVisibility,
  });

  /**
   * One client covering every create endpoint. Each create echoes back the
   * visibility it was sent, the way a current server does; tests that model an
   * older server override the endpoint they care about.
   */
  const fullClient = () => {
    const visibilityOf = (input: unknown) =>
      ((input as { visibility?: string }).visibility ?? null) as string | null;
    // Return types are left open (`unknown`) on purpose: individual tests swap in
    // other server shapes with `mockImplementationOnce` — an old server, a pending
    // proposal — and those must type-check against the same spy.
    const spies = {
      fileTreesCreate: vi.fn(
        async (input: unknown): Promise<unknown> => ({
          materialized: true,
          node: nodeVO("nod_tree", visibilityOf(input)),
          visibility: visibilityOf(input) ?? "workspace",
          files: [],
        }),
      ),
      docsCreate: vi.fn(
        async (input: unknown): Promise<unknown> => ({
          materialized: true,
          node: nodeVO("nod_doc", visibilityOf(input)),
          body: "",
        }),
      ),
      basesCreate: vi.fn(
        async (_input: unknown): Promise<unknown> => ({
          materialized: true,
          id: "bas_1",
          nodeId: "nod_base",
        }),
      ),
      filesCreate: vi.fn(
        async (input: unknown): Promise<unknown> => ({
          materialized: true,
          node: nodeVO("nod_file", visibilityOf(input)),
          asset: {},
        }),
      ),
      createChangeRequest: vi.fn(
        async (_input: unknown): Promise<unknown> => ({
          id: "cr_1",
          status: "merged",
          node: null,
          operations: [{ operation: "node_create", nodeId: "nod_generic" }],
        }),
      ),
      // The read-back for the two endpoints that return no node record.
      nodesGet: vi.fn(async ({ nodeId }: { nodeId: string }) => ({
        type: "base",
        node: nodeVO(nodeId, "private"),
      })),
    };
    const client = {
      nodes: {
        createChangeRequest: spies.createChangeRequest,
        get: spies.nodesGet,
        updateAgentPrompts: vi.fn(),
        updateMetadata: vi.fn(),
      },
      fileTrees: { create: spies.fileTreesCreate },
      docs: { create: spies.docsCreate },
      bases: { create: spies.basesCreate },
      files: { create: spies.filesCreate },
    } as unknown as BusabaseTaskClient;
    return { client, ...spies };
  };

  const inputFor = (type: string) => ({
    type: type as Parameters<typeof nodeCreateTask.execute>[1]["type"],
    slug: "secret",
    name: "Secret",
    visibility: "private",
    ...(type === "file" ? { assetId: "ast_1" } : {}),
    ...(type === "base" ? { fields: [{ slug: "title", name: "Title", type: "text" }] } : {}),
  });

  it("is a parameter of every type, so no per-type CLI variant hides it", () => {
    const param = nodeCreateTask.params.find((p) => p.name === "visibility");
    expect(param?.appliesWhen).toBeUndefined();
    expect(param?.description).not.toMatch(/Skill\/Drive\/AirApp only/);
  });

  it.each([
    ["skill", "fileTreesCreate"],
    ["drive", "fileTreesCreate"],
    ["airapp", "fileTreesCreate"],
    ["doc", "docsCreate"],
    ["base", "basesCreate"],
    ["file", "filesCreate"],
  ] as const)("forwards visibility to the %s create endpoint", async (type, spy) => {
    const mocks = fullClient();

    const result = await nodeCreateTask.execute(mocks.client, inputFor(type));

    expect(mocks[spy]).toHaveBeenCalledWith(expect.objectContaining({ visibility: "private" }));
    expect(result).not.toHaveProperty("visibilityWrite");
  });

  it.each(["folder", "form", "whiteboard", "workflow", "html"])(
    "puts visibility in the create operation's metadata for %s",
    async (type) => {
      const mocks = fullClient();

      const result = await nodeCreateTask.execute(mocks.client, inputFor(type));

      expect(mocks.createChangeRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          operations: [
            expect.objectContaining({ nodeType: type, metadata: { visibility: "private" } }),
          ],
        }),
      );
      // A merged change request names the node but does not return it, so the
      // task reads it back once to confirm.
      expect(mocks.nodesGet).toHaveBeenCalledTimes(1);
      expect(mocks.nodesGet).toHaveBeenCalledWith({ nodeId: "nod_generic" });
      expect(result).not.toHaveProperty("visibilityWrite");
    },
  );

  it("sends nothing and reads nothing back when no visibility was asked for", async () => {
    const mocks = fullClient();

    await nodeCreateTask.execute(mocks.client, { type: "folder", slug: "cms", name: "CMS" });
    await nodeCreateTask.execute(mocks.client, { type: "doc", slug: "readme", name: "README" });

    const operation = (
      mocks.createChangeRequest.mock.calls[0]?.[0] as unknown as {
        operations: Record<string, unknown>[];
      }
    ).operations[0];
    expect(operation).not.toHaveProperty("metadata");
    expect(mocks.docsCreate.mock.calls[0]?.[0]).not.toHaveProperty("visibility");
    expect(mocks.nodesGet).not.toHaveBeenCalled();
  });

  it("confirms a Base from one read-back of its owning node", async () => {
    const mocks = fullClient();

    const result = await nodeCreateTask.execute(mocks.client, inputFor("base"));

    expect(mocks.nodesGet).toHaveBeenCalledTimes(1);
    expect(mocks.nodesGet).toHaveBeenCalledWith({ nodeId: "nod_base" });
    expect(result).not.toHaveProperty("visibilityWrite");
  });

  // Version skew: a new CLI against an old server. The server's schema strips
  // the unknown key, the create succeeds, and the node is NOT private. That
  // must not read as plain success.
  it("reports an old server that silently dropped visibility on a Doc", async () => {
    const mocks = fullClient();
    mocks.docsCreate.mockImplementationOnce(async () => ({
      materialized: true,
      node: nodeVO("nod_doc", null),
      body: "",
    }));

    const result = await nodeCreateTask.execute(mocks.client, inputFor("doc"));

    expect(result).toMatchObject({
      node: { id: "nod_doc" },
      visibilityWrite: { applied: false, requested: "private", nodeId: "nod_doc", actual: null },
    });
    expect((result as { visibilityWrite: { nextStep: string } }).visibilityWrite.nextStep).toBe(
      "busabase-cli nodes update-visibility --node-id nod_doc --visibility private",
    );
    // The node came back in the response, so no extra call was needed.
    expect(mocks.nodesGet).not.toHaveBeenCalled();
  });

  it("reports an old server that dropped visibility on a Base, found by the read-back", async () => {
    const mocks = fullClient();
    mocks.nodesGet.mockImplementationOnce(async ({ nodeId }) => ({
      type: "base",
      node: nodeVO(nodeId, null),
    }));

    const result = await nodeCreateTask.execute(mocks.client, inputFor("base"));

    expect(result).toMatchObject({
      nodeId: "nod_base",
      visibilityWrite: { applied: false, requested: "private", nodeId: "nod_base", actual: null },
    });
  });

  it("reports a pending proposal that does not carry visibility", async () => {
    const mocks = fullClient();
    mocks.docsCreate.mockImplementationOnce(async () => ({
      materialized: false,
      id: "cr_1",
      status: "in_review",
      operations: [{ operation: "node_create", headCommit: { payload: { metadata: {} } } }],
    }));

    const result = await nodeCreateTask.execute(mocks.client, {
      ...inputFor("doc"),
      requireReview: true,
    });

    expect(result).toMatchObject({
      id: "cr_1",
      visibilityWrite: { applied: false, requested: "private" },
    });
    expect((result as { visibilityWrite: { nextStep: string } }).visibilityWrite.nextStep).toMatch(
      /^Once the change request merges: busabase-cli nodes update-visibility/,
    );
    expect(mocks.nodesGet).not.toHaveBeenCalled();
  });

  it("accepts a pending proposal that carries visibility to the merge", async () => {
    const mocks = fullClient();
    mocks.basesCreate.mockImplementationOnce(async () => ({
      materialized: false,
      id: "cr_1",
      status: "in_review",
      operations: [
        {
          operation: "node_create",
          headCommit: { payload: { metadata: { visibility: "private" } } },
        },
      ],
    }));

    const result = await nodeCreateTask.execute(mocks.client, {
      ...inputFor("base"),
      requireReview: true,
    });

    expect(result).not.toHaveProperty("visibilityWrite");
    expect(mocks.nodesGet).not.toHaveBeenCalled();
  });

  // A server from before the `explicit_visibility` column kept a Skill's
  // visibility in metadata and honoured it; that is not a skew to report.
  it("reads metadata.visibility only from a server that sends no explicitVisibility", async () => {
    const mocks = fullClient();
    mocks.fileTreesCreate.mockImplementationOnce(async () => ({
      materialized: true,
      node: { id: "nod_tree", metadata: { visibility: "private" } },
      visibility: "private",
      files: [],
    }));

    const result = await nodeCreateTask.execute(mocks.client, inputFor("skill"));

    expect(result).not.toHaveProperty("visibilityWrite");
  });

  it("reports, rather than fails, when the confirming read-back errors", async () => {
    const mocks = fullClient();
    mocks.nodesGet.mockRejectedValueOnce(new Error("Service Unavailable"));

    const result = await nodeCreateTask.execute(mocks.client, inputFor("base"));

    expect(result).toMatchObject({
      nodeId: "nod_base",
      visibilityWrite: { applied: false, requested: "private", nodeId: "nod_base" },
    });
    expect((result as { visibilityWrite: { reason: string } }).visibilityWrite.reason).toContain(
      "Service Unavailable",
    );
  });

  it("refuses an unknown visibility before creating anything", async () => {
    const mocks = fullClient();

    await expect(
      nodeCreateTask.execute(mocks.client, { ...inputFor("doc"), visibility: "secret" }),
    ).rejects.toThrow(/visibility must be one of/);
    expect(mocks.docsCreate).not.toHaveBeenCalled();
  });

  it("keeps reporting the prompt write alongside a visibility report", async () => {
    const mocks = fullClient();
    mocks.docsCreate.mockImplementationOnce(async () => ({
      materialized: true,
      node: nodeVO("nod_doc", null),
      body: "",
    }));

    const result = await nodeCreateTask.execute(mocks.client, {
      ...inputFor("doc"),
      agentPrompts: prompts,
    });

    expect(result).toMatchObject({
      visibilityWrite: { applied: false },
      agentPromptsWrite: { written: true, nodeId: "nod_doc" },
    });
  });
});

describe("nodeCreateTask version", () => {
  // Only the file-tree endpoint has a version; every other branch used to drop
  // it without a word.
  it.each(["doc", "base", "folder"])("rejects version for --type %s", async (type) => {
    const create = vi.fn();
    const { client } = clientFor({
      docs: { create },
      bases: { create },
      nodes: { createChangeRequest: create },
    });

    await expect(
      nodeCreateTask.execute(client, {
        type: type as "doc",
        slug: "x",
        name: "X",
        version: "1.0.0",
      }),
    ).rejects.toThrow(/version is not valid for --type/);
    expect(create).not.toHaveBeenCalled();
  });
});
