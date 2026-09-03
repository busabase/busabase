import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SPACE = "space_node_agent_prompts";

const PROMPTS = [
  {
    key: "weekly-severity-summary",
    intent: "read-only" as const,
    label: { en: "Weekly severity summary", "zh-CN": "本周按严重程度汇总" },
    body: {
      en: "Summarize tickets opened in {target} in the last 7 days.",
      "zh-CN": "汇总 {target} 最近 7 天新建的工单。",
    },
  },
  { key: "draft-response", label: "Draft a response", body: "Draft a reply in {target}." },
];

describe("nodes agent prompts", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";

  const inSpace = <T>(
    fn: () => Promise<T>,
    context: { actorId?: string; isSpaceManager?: boolean } = {},
  ): Promise<T> => runWithBusabaseContext({ spaceId: SPACE, ...context }, fn);

  const asManager = <T>(fn: () => Promise<T>): Promise<T> =>
    inSpace(fn, { actorId: "alice", isSpaceManager: true });

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-prompts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-agent-prompts-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await asManager(() =>
      client.bases.create({ slug: "tickets", name: "Tickets", autoMerge: true }),
    );
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    nodeId = base.nodeId;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("starts as null — never set is not the same as set-and-empty", async () => {
    const read = await asManager(() => client.nodes.getAgentPrompts({ nodeId }));
    expect(read.agentPrompts).toBeNull();
  });

  it("round-trips a list, including per-locale labels and bodies", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));

    const read = await asManager(() => client.nodes.getAgentPrompts({ nodeId }));
    expect(read.agentPrompts).toEqual(PROMPTS);
  });

  it("replaces rather than merges — a shorter list drops the entries left out", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: [PROMPTS[1]] }));

    const read = await asManager(() => client.nodes.getAgentPrompts({ nodeId }));
    expect(read.agentPrompts?.map((prompt) => prompt.key)).toEqual(["draft-response"]);
  });

  it("distinguishes cleared (null) from deliberately empty ([])", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: [] }));
    expect((await asManager(() => client.nodes.getAgentPrompts({ nodeId }))).agentPrompts).toEqual(
      [],
    );

    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: null }));
    expect(
      (await asManager(() => client.nodes.getAgentPrompts({ nodeId }))).agentPrompts,
    ).toBeNull();
  });

  it("rejects a malformed list instead of storing it", async () => {
    await expect(
      asManager(() =>
        client.nodes.updateAgentPrompts({
          nodeId,
          // `label` must be a string or a locale map, never a number.
          agentPrompts: [{ key: "broken", label: 12345, body: "About {target}." }] as never,
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects duplicate keys within one list", async () => {
    await expect(
      asManager(() =>
        client.nodes.updateAgentPrompts({
          nodeId,
          agentPrompts: [
            { key: "dup", label: "One", body: "One about {target}." },
            { key: "dup", label: "Two", body: "Two about {target}." },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  /**
   * The reason this column exists. Prompts are capped at 50 x 8 KiB per locale,
   * and a sidebar load reads every node in the tree — so a list must not carry
   * them no matter how large they get. Asserting on the VO rather than on a
   * byte count keeps this honest: the field is absent, not merely small.
   */
  it("never rides along on a node listing", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));

    const listed = await asManager(() => client.nodes.list({}));
    const flatten = (nodes: typeof listed): typeof listed =>
      nodes.flatMap((node) => [node, ...flatten(node.children)]);
    const node = flatten(listed).find((candidate) => candidate.id === nodeId);

    expect(node).toBeDefined();
    expect(node).not.toHaveProperty("agentPrompts");
    // And not smuggled back through the bag it used to live in.
    expect(node?.metadata).not.toHaveProperty("agentPrompts");
  });

  // Same setup as `nodes.updateMetadata`'s own permission test: `isSpaceManager`
  // must be explicitly false. Leaving it undefined is NOT "a plain member" —
  // the context then takes a different branch and the write is allowed, which
  // is what this test caught the first time it was written.
  /**
   * Writing an audit action the READ contract does not list makes the next
   * `auditEvents.list` fail output validation — a 500 that takes the node's
   * whole page down, for everyone, from then on. Nothing else catches it: the
   * write-side enum and the read-side enum each compile on their own, and this
   * only fires once a row with the new action exists.
   */
  it("writes an audit action the audit list can actually read back", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));

    const events = await asManager(() => client.auditEvents.list({}));
    expect(events.some((event) => event.action === "node.agent_prompts_updated")).toBe(true);
  });

  it("requires write permission, like every other single-node edit", async () => {
    await expect(
      inSpace(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }), {
        actorId: "bob",
        isSpaceManager: false,
      }),
    ).rejects.toThrow(/Requires write access/);
  });

  // The read/write split, pinned from one actor: they are the node's own
  // prompts, split out for SIZE and not for secrecy, so anyone who can read the
  // node can read them — while writing them stays a write.
  it("lets a plain member read what it will not let them write", async () => {
    await asManager(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: PROMPTS }));

    const asMember = <T>(fn: () => Promise<T>) =>
      inSpace(fn, { actorId: "bob", isSpaceManager: false });

    const read = await asMember(() => client.nodes.getAgentPrompts({ nodeId }));
    expect(read.agentPrompts?.map((prompt) => prompt.key)).toEqual([
      "weekly-severity-summary",
      "draft-response",
    ]);

    await expect(
      asMember(() => client.nodes.updateAgentPrompts({ nodeId, agentPrompts: [] })),
    ).rejects.toThrow(/Requires write access/);
  });
});
