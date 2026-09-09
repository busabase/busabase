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

  // The CLI and the server ship separately: a current caller routinely talks to
  // a server that predates the dedicated endpoint.
  it("falls back to the metadata key when the server has no agent-prompts endpoint", async () => {
    const create = vi.fn(async () => ({ materialized: true, id: "bas_1", nodeId: "nod_1" }));
    const { client, updateMetadata } = clientFor({ bases: { create } });
    (
      client.nodes as unknown as { updateAgentPrompts: ReturnType<typeof vi.fn> }
    ).updateAgentPrompts.mockRejectedValueOnce(
      Object.assign(new Error("Not Found"), { status: 404 }),
    );

    await nodeCreateTask.execute(client, {
      type: "base",
      slug: "visits",
      name: "Visits",
      fields: [],
      agentPrompts: prompts,
    });

    expect(updateMetadata).toHaveBeenCalledWith({
      nodeId: "nod_1",
      metadata: { agentPrompts: prompts },
    });
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
