/**
 * Playbook attribution on change requests (agent-playbook-discovery.md §11b,
 * H1) against a real PGLite database.
 *
 * The transport (Cloud `/api/v1`, the open-source `/api/v1` route) calls
 * `withDeclaredPlaybook` once per request inside the resolved context; these
 * tests do exactly that, then assert on BOTH the stored row (what was
 * recorded) and the VO (what a given reader is shown).
 */
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type BusabaseSourceProvenance,
  LOCAL_SPACE_ID,
  runWithBusabaseContext,
  runWithLocalContext,
} from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests } from "../src/db/schema";
import { withDeclaredPlaybook } from "../src/domains/playbooks/logic/playbook-attribution";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const API = "http://busabase.test/api/v1";

/** What Cloud's API-key transport puts in the context (see busabase-cloud openapi/provenance.ts). */
const CLOUD_PROVENANCE: BusabaseSourceProvenance = {
  owner: { id: "alice", name: "Alice", email: "alice@example.com", image: null },
  apiKey: { id: "key_1", name: "Codex" },
  channel: "cli",
};

const request = (playbook?: string, method = "POST") => ({
  method,
  headers: new Headers(playbook === undefined ? {} : { "x-busabase-playbook": playbook }),
});

/** A member request as Cloud's workbench middleware runs it: context first, then the playbook. */
const asUser = <T>(
  actorId: string,
  isSpaceManager: boolean,
  playbook: string | undefined,
  fn: () => Promise<T>,
) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager,
      // A plain member who may propose changes but is not a space manager.
      ...(isSpaceManager ? {} : { permissionLevel: "write" as const }),
      sourceProvenance: { ...CLOUD_PROVENANCE, owner: { ...CLOUD_PROVENANCE.owner, id: actorId } },
    },
    () => withDeclaredPlaybook(request(playbook), fn),
  );

const asManager = <T>(fn: () => Promise<T>, playbook?: string) =>
  asUser("alice", true, playbook, fn);
const asMember = <T>(fn: () => Promise<T>, playbook?: string) => asUser("bob", false, playbook, fn);

const VISIT_PROMPTS: CustomAgentPrompts = [
  {
    key: "log-visit",
    intent: "change",
    label: { en: "Log a customer visit", "zh-CN": "记录客户拜访" },
    body: "Add one record to {target} for today's customer visit.",
  },
];

const storedSourceMeta = async (changeRequestId: string) => {
  const db = await getDb();
  const [row] = await db
    .select({ sourceMeta: busabaseChangeRequests.sourceMeta })
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId));
  if (!row) throw new Error(`change request ${changeRequestId} not found`);
  return row.sourceMeta as Record<string, unknown>;
};

const storedPlaybook = async (changeRequestId: string) => {
  const meta = await storedSourceMeta(changeRequestId);
  return (meta.provenance as Record<string, unknown> | undefined)?.playbook;
};

describe("change request playbook attribution", () => {
  let raw: RawClient;
  let visitsId = "";
  let skillId = "";
  let payrollId = "";

  /** A pending (review-first) record change request, so the change request itself comes back. */
  const createVisit = async (title: string) => {
    const cr = await raw.bases.createChangeRequest({
      baseId: visitsId,
      fields: { title },
      autoMerge: false,
    });
    if (cr.materialized) throw new Error("expected a pending change request");
    return cr;
  };

  beforeAll(async () => {
    await seedScenario("playbook-attribution");
    raw = createRouterClient(busabaseRouter);
    await asManager(async () => {
      const cr = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "base",
            slug: "visits",
            name: "Visits",
            fields: [{ slug: "title", name: "Title", type: "text" }],
          },
          {
            kind: "create",
            nodeType: "base",
            slug: "payroll",
            name: "Payroll",
            fields: [{ slug: "title", name: "Title", type: "text" }],
          },
          {
            kind: "create",
            nodeType: "skill",
            slug: "weekly-report",
            name: "Weekly Report",
            description: "Compile the weekly sales report",
          },
        ],
      });
      expect(cr.status).toBe("merged");
      const tree = await raw.nodes.list();
      const flat = (nodes: typeof tree): typeof tree =>
        nodes.flatMap((node) => [node, ...flat(node.children)]);
      const bySlug = new Map(flat(tree).map((node) => [node.slug, node.id]));
      visitsId = bySlug.get("visits") ?? "";
      payrollId = bySlug.get("payroll") ?? "";
      skillId = bySlug.get("weekly-report") ?? "";
      await raw.nodes.updateAgentPrompts({ nodeId: visitsId, agentPrompts: VISIT_PROMPTS });
      await raw.nodes.updateAgentPrompts({
        nodeId: payrollId,
        agentPrompts: [{ key: "run-payroll", label: "Run payroll", body: "Pay {target}." }],
      });
      await raw.nodes.updateVisibility({ nodeId: payrollId, visibility: "private" });
    });
    expect(visitsId && payrollId && skillId).toBeTruthy();
  });

  it("stamps a prompt playbook on a record change request, labelled by the server", async () => {
    const cr = await asManager(() => createVisit("Acme"), `prompt:${visitsId}:log-visit`);
    expect(await storedPlaybook(cr.id)).toEqual({
      kind: "prompt",
      nodeId: visitsId,
      key: "log-visit",
      nodeType: "base",
      nodeSlug: "visits",
      label: "Log a customer visit",
    });
    // The VO a reader gets: the chip data, plus the old attribution untouched.
    expect(cr.sourceAttribution).toEqual({
      displayName: "Codex",
      ownerName: "Alice",
      channel: "cli",
      playbook: {
        kind: "prompt",
        accessible: true,
        nodeId: visitsId,
        key: "log-visit",
        nodeType: "base",
        nodeSlug: "visits",
        label: "Log a customer visit",
      },
    });
    // Raw provenance never leaves the server.
    expect(cr.sourceMeta).not.toHaveProperty("provenance");
  });

  it("stamps a skill playbook on a node change request and a skill-file change request", async () => {
    const nodeCr = await asManager(
      () =>
        raw.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "reports", name: "Reports" }],
        }),
      `skill:${skillId}`,
    );
    const expected = {
      kind: "skill",
      nodeId: skillId,
      key: null,
      nodeType: "skill",
      nodeSlug: "weekly-report",
      label: "Weekly Report",
    };
    expect(await storedPlaybook(nodeCr.id)).toEqual(expected);

    const current = await asManager(() =>
      raw.fileTrees.readFile({ type: "skill", nodeId: skillId, filePath: "SKILL.md" }),
    );
    const fileCr = await asManager(
      () =>
        raw.fileTrees.createChangeRequest({
          type: "skill",
          nodeId: skillId,
          operations: [
            {
              kind: "update",
              path: "SKILL.md",
              content: `${current.content}\n\nEdited.\n`,
              baseContentHash: current.contentHash,
            },
          ],
        }),
      `skill:${skillId}`,
    );
    expect(await storedPlaybook(fileCr.id)).toEqual(expected);
    const read = await asManager(() => raw.changeRequests.get({ changeRequestId: fileCr.id }));
    expect(read.sourceAttribution?.playbook).toMatchObject({ kind: "skill", accessible: true });
  });

  it.each([
    ["malformed (prompt without key)", () => `prompt:${visitsId}`],
    ["malformed (unknown kind)", () => `recipe:${visitsId}`],
    ["garbage", () => "not a playbook"],
    ["unknown prompt key", () => `prompt:${visitsId}:no-such-key`],
    ["skill kind on a non-skill node", () => `skill:${visitsId}`],
    ["node that does not exist", () => "skill:nod_missing"],
  ])("drops an invalid declaration (%s) without failing the write", async (_label, header) => {
    const cr = await asManager(() => createVisit("Dropped"), header());
    expect(cr.status).toBeDefined();
    expect(await storedPlaybook(cr.id)).toBeUndefined();
    expect(cr.sourceAttribution).toEqual({
      displayName: "Codex",
      ownerName: "Alice",
      channel: "cli",
    });
    expect(cr.sourceAttribution).not.toHaveProperty("playbook");
  });

  it("drops a playbook the WRITER cannot read, without failing the write", async () => {
    const cr = await asMember(() => createVisit("Bob's visit"), `prompt:${payrollId}:run-payroll`);
    expect(await storedPlaybook(cr.id)).toBeUndefined();
    expect(cr.sourceAttribution).not.toHaveProperty("playbook");
  });

  it("shows a reader who cannot read the playbook only that one was used", async () => {
    const cr = await asManager(
      () => createVisit("Payroll-driven"),
      `prompt:${payrollId}:run-payroll`,
    );
    expect(await storedPlaybook(cr.id)).toMatchObject({ nodeId: payrollId, label: "Run payroll" });

    const managerView = await asManager(() => raw.changeRequests.get({ changeRequestId: cr.id }));
    expect(managerView.sourceAttribution?.playbook).toMatchObject({
      accessible: true,
      label: "Run payroll",
    });

    const hidden = {
      kind: "prompt",
      accessible: false,
      nodeId: null,
      key: null,
      nodeType: null,
      nodeSlug: null,
      label: null,
    };
    const memberView = await asMember(() => raw.changeRequests.get({ changeRequestId: cr.id }));
    expect(memberView.sourceAttribution?.playbook).toEqual(hidden);

    // The inbox list path narrows too (one batched check for the whole page).
    const page = await asMember(() => raw.changeRequests.inboxSnapshot({ page: 1, pageSize: 50 }));
    const listed = page.changeRequests.find((item) => item.id === cr.id);
    expect(listed?.sourceAttribution?.playbook).toEqual(hidden);
    const visible = page.changeRequests.find(
      (item) => item.sourceAttribution?.playbook?.nodeId === visitsId,
    );
    expect(visible?.sourceAttribution?.playbook).toMatchObject({ accessible: true });
  });

  it("ignores the header on reads", async () => {
    // A GET never validates or re-enters the context; nothing observable, so just prove it runs.
    await expect(
      runWithBusabaseContext(
        { spaceId: LOCAL_SPACE_ID, actorId: "alice", isSpaceManager: true },
        () => withDeclaredPlaybook(request(`skill:${skillId}`, "GET"), async () => "ok"),
      ),
    ).resolves.toBe("ok");
  });

  describe("open-source local host (through the real OpenAPI handler)", () => {
    const handler = new OpenAPIHandler(busabaseRouter);
    const post = (headers: Record<string, string>) => {
      const req = new Request(`${API}/bases/${visitsId}/change-requests`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify({ fields: { title: "Local" }, autoMerge: false }),
      });
      // Exactly what apps/busabase's /api/v1 route does.
      return runWithLocalContext({ localUserName: "Local" }, () =>
        withDeclaredPlaybook(req, async () => {
          const result = await handler.handle(req, { context: {} });
          if (!result.matched) throw new Error("route not matched");
          return (await result.response.json()) as { id: string; sourceAttribution: unknown };
        }),
      );
    };

    it("without the header: no provenance at all, attribution null (unchanged)", async () => {
      const cr = await post({ "x-busabase-channel": "sdk" });
      expect(await storedSourceMeta(cr.id)).not.toHaveProperty("provenance");
      expect(cr.sourceAttribution).toBeNull();
    });

    it("with the header: only the playbook (+ declared channel) is recorded", async () => {
      const withChannel = await post({
        "x-busabase-playbook": `prompt:${visitsId}:log-visit`,
        "x-busabase-channel": "cli",
      });
      expect((await storedSourceMeta(withChannel.id)).provenance).toEqual({
        channel: "cli",
        playbook: expect.objectContaining({ nodeId: visitsId, key: "log-visit" }),
      });
      expect(withChannel.sourceAttribution).toMatchObject({
        displayName: null,
        ownerName: null,
        channel: "cli",
        playbook: { accessible: true, label: "Log a customer visit" },
      });

      // No channel named: it must NOT default to "openapi" ("API") — nothing said so.
      const bare = await post({ "x-busabase-playbook": `prompt:${visitsId}:log-visit` });
      expect(bare.sourceAttribution).toMatchObject({
        displayName: null,
        ownerName: null,
        channel: null,
        playbook: { accessible: true },
      });
    });
  });
});
