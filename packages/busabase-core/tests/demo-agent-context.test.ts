import { reduceAcpEvents } from "@acp-ui/core/reduce";
import { createRouterClient } from "@orpc/server";
import {
  createAgentPromptEnvelope,
  createPromptResourceContext,
} from "busabase-contract/domains/agents/prompt-context";
import {
  AgentContextResourceVOSchema,
  type AgentSessionEventVO,
} from "busabase-contract/domains/agents/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { runWithBusabaseContext } from "../src/context";
import { translateAgentSessionEvent } from "../src/domains/agents/hooks/use-agent-session";
import {
  DEMO_AGENT_SLUG,
  resetDemoAgentSessions,
  subscribeDemoAgentSession,
} from "../src/domains/agents/logic/demo-agent";
import { resolveDemoAgentContextResources } from "../src/domains/agents/logic/demo-agent-context";
import * as demoStore from "../src/logic/demo-store";
import { busabaseDemoRouter } from "../src/router-demo";

const client = createRouterClient(busabaseDemoRouter);
const docId = "nod_doc_agent_operating_guide";
const userMessageSchema = z.object({ sessionUpdate: z.literal("user_message") });

const userEvent = async (sessionId: string): Promise<AgentSessionEventVO> => {
  for await (const event of subscribeDemoAgentSession(sessionId, -1)) {
    if (event.kind === "acpUpdate" && userMessageSchema.safeParse(event.acpUpdate).success) {
      return event;
    }
  }
  throw new Error("No demo user message was emitted");
};

afterEach(() => {
  resetDemoAgentSessions();
  vi.restoreAllMocks();
});

describe("demo explicit page references", () => {
  it("stages and replays immutable prompt context with no text expansion", async () => {
    await runWithBusabaseContext({ embedOrigin: "https://busa.test" }, async () => {
      const context = createPromptResourceContext(
        createAgentPromptEnvelope({
          scenario: { id: "find", title: "Find records" },
          target: { nodeId: "descriptive-only", nodeName: "目标", nodeType: "base" },
          source: { origin: "https://busa.test", edition: "desktop" },
          segments: [{ kind: "task", text: "Full immutable task\n完整" }],
        }),
        "demo-paste",
      );
      const session = await client.agents.sessions.create({ slug: DEMO_AGENT_SLUG });
      await expect(
        client.agents.sessions.prompt({
          sessionId: session.id,
          text: "",
          resourceContext: [context],
        }),
      ).resolves.toMatchObject({ accepted: true });
      const event = await userEvent(session.id);
      expect(event.acpUpdate).toEqual({
        sessionUpdate: "user_message",
        text: "",
        resourceContext: [context],
      });
      const blocks = reduceAcpEvents([], translateAgentSessionEvent(event));
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toMatchObject({
        text: "",
        attachments: [
          {
            resource: {
              resource: { text: context.text },
              _meta: { "acp-ui.resourceContext": { id: context.id, name: context.name } },
            },
          },
        ],
      });
    });
  });
  it("accepts reference-only prompts and replays the actual seeded document as a resource card", async () => {
    const session = await client.agents.sessions.create({ slug: DEMO_AGENT_SLUG });
    await expect(
      client.agents.sessions.prompt({
        sessionId: session.id,
        text: "",
        contextReferences: [{ nodeId: docId }],
      }),
    ).resolves.toMatchObject({ accepted: true });
    const event = await userEvent(session.id);
    const blocks = reduceAcpEvents([], translateAgentSessionEvent(event));
    const message = blocks[0];
    if (message?.kind !== "message") throw new Error("Expected the demo user message");
    expect(message.text).toBe("");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments?.[0]?.resource).toMatchObject({
      type: "resource",
      _meta: { "busabase.node": { id: docId, type: "doc" } },
      resource: { text: expect.stringContaining(demoStore.demoGetNodeDetail(docId).node.name) },
    });
    const detail = demoStore.demoGetNodeDetail(docId);
    if (detail.type !== "doc") throw new Error("Expected a seeded document");
    expect(message.attachments?.[0]?.resource?.resource).toMatchObject({
      text: expect.stringContaining(detail.body),
    });
  });

  it("does not invent references for an ordinary text-only turn", async () => {
    const session = await client.agents.sessions.create({ slug: DEMO_AGENT_SLUG });
    await client.agents.sessions.prompt({ sessionId: session.id, text: "/status" });
    const event = await userEvent(session.id);
    expect(event.acpUpdate).toEqual({ sessionUpdate: "user_message", text: "/status" });
  });

  it("rejects a missing reference before any user event or scripted turn, then accepts retry", async () => {
    const session = await client.agents.sessions.create({ slug: DEMO_AGENT_SLUG });
    await expect(
      client.agents.sessions.prompt({
        sessionId: session.id,
        text: "Keep this draft",
        contextReferences: [{ nodeId: docId }, { nodeId: "deleted-demo-node" }],
      }),
    ).rejects.toThrow(/not found/i);
    expect(await client.agents.sessions.list()).toMatchObject([{ id: session.id, status: "idle" }]);
    await client.agents.sessions.prompt({ sessionId: session.id, text: "/status" });
    expect((await userEvent(session.id)).acpUpdate).toEqual({
      sessionUpdate: "user_message",
      text: "/status",
    });
  });

  it("bounds multibyte document snapshots to 32 KiB without invalid UTF-8", () => {
    const detail = demoStore.demoGetNodeDetail(docId);
    if (detail.type !== "doc") throw new Error("Expected a seeded document");
    vi.spyOn(demoStore, "demoGetNodeDetail").mockReturnValueOnce({
      ...detail,
      body: "资料🐈".repeat(10_000),
    });
    const [snapshot] = resolveDemoAgentContextResources([{ nodeId: docId }]);
    expect(snapshot?.truncated).toBe(true);
    expect(Buffer.byteLength(snapshot?.text ?? "", "utf8")).toBeLessThanOrEqual(32 * 1024);
    expect(snapshot?.text).not.toContain("\uFFFD");
    expect(snapshot?.text).toContain("[Context truncated:");
  });

  it("samples the whole seeded Base and deduplicates submitted references", () => {
    const [base] = demoStore.demoListBases();
    if (!base) throw new Error("Expected a seeded Base");
    const snapshots = resolveDemoAgentContextResources([
      { nodeId: base.nodeId },
      { nodeId: base.nodeId },
    ]);
    expect(snapshots).toHaveLength(1);
    const snapshot = AgentContextResourceVOSchema.parse(snapshots[0]);
    expect(snapshot.text).toContain("at most 20 records from the whole Base");
    expect(snapshot.text).toContain(base.fields[0]?.slug);
    const records = demoStore.demoListRecords({ baseId: base.id });
    expect(snapshot.text).toContain(records[0]?.id);
    expect(snapshot.truncated).toBe(records.length > 20);
  });

  it("reads seeded directory entries and marks unavailable asset bodies honestly", () => {
    const drive = demoStore
      .demoListNodeSummaries(["drive"])
      .find((node) => node.id === "nod_drive_team_files");
    const [file] = demoStore.demoListNodeSummaries(["file"]);
    if (!drive || !file) throw new Error("Expected seeded Drive and File nodes");
    const [directory, asset] = resolveDemoAgentContextResources([
      { nodeId: drive.id },
      { nodeId: file.id },
    ]);
    expect(directory?.text).toContain("## Entry file:");
    expect(directory?.text).toContain("# Team Files");
    expect(asset?.text).toContain("File body is not available in the stateless demo");
    expect(asset?.text).toContain("no model or persistent workspace");
  });
});
