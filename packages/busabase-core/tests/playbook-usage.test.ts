/**
 * Usage counts on the Playbooks page (agent-playbook-discovery.md §17 open
 * item 2): `playbooks.list` carries `usage: { changeRequests30d, lastUsedAt }`
 * per playbook, from the change requests agents wrote under an
 * `x-busabase-playbook` declaration (H1), against a real PGLite database.
 *
 * The change requests are written exactly the way the transport writes them —
 * `withDeclaredPlaybook` inside the resolved context — so the stored
 * `source_meta.provenance.playbook` is the real one, not a hand-built fixture.
 */
import { createRouterClient } from "@orpc/server";
import type { CustomAgentPrompts } from "busabase-contract/contract/node-agent-prompt-schemas";
import type { PlaybookListItemVO } from "busabase-contract/contract/playbook-schemas";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseChangeRequests } from "../src/db/schema";
import { withDeclaredPlaybook } from "../src/domains/playbooks/logic/playbook-attribution";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const DAY_MS = 24 * 60 * 60 * 1000;

const write = (playbook: string | undefined) => ({
  method: "POST",
  headers: new Headers(playbook === undefined ? {} : { "x-busabase-playbook": playbook }),
});

const asUser = <T>(
  actorId: string,
  isSpaceManager: boolean,
  fn: () => Promise<T>,
  playbook?: string,
) =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId,
      isSpaceManager,
      ...(isSpaceManager ? {} : { permissionLevel: "write" as const }),
    },
    () => withDeclaredPlaybook(write(playbook), fn),
  );

const asManager = <T>(fn: () => Promise<T>, playbook?: string) =>
  asUser("alice", true, fn, playbook);
const asMember = <T>(fn: () => Promise<T>) => asUser("bob", false, fn);

const VISIT_PROMPTS: CustomAgentPrompts = [
  {
    key: "log-visit",
    intent: "change",
    label: "Log a customer visit",
    body: "Add one record to {target} for today's customer visit.",
  },
];

const backdate = async (changeRequestId: string, daysAgo: number) => {
  const db = await getDb();
  const createdAt = new Date(Date.now() - daysAgo * DAY_MS);
  await db
    .update(busabaseChangeRequests)
    .set({ createdAt })
    .where(eq(busabaseChangeRequests.id, changeRequestId));
  const [row] = await db
    .select({ createdAt: busabaseChangeRequests.createdAt })
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId));
  return row?.createdAt.toISOString() ?? "";
};

const storedCreatedAt = async (changeRequestId: string) => {
  const db = await getDb();
  const [row] = await db
    .select({ createdAt: busabaseChangeRequests.createdAt })
    .from(busabaseChangeRequests)
    .where(eq(busabaseChangeRequests.id, changeRequestId));
  return row?.createdAt.toISOString() ?? "";
};

const findPrompt = (items: PlaybookListItemVO[], nodeId: string, key: string) =>
  items.find((item) => item.kind === "prompt" && item.nodeId === nodeId && item.key === key);
const findSkill = (items: PlaybookListItemVO[], nodeId: string) =>
  items.find((item) => item.kind === "skill" && item.nodeId === nodeId);

describe("playbooks.list usage counts", () => {
  let raw: RawClient;
  let visitsId = "";
  let payrollId = "";
  let leadsId = "";
  let skillId = "";
  /** Visible to the member; rejected, to prove every status counts. */
  let visibleRejectedId = "";
  /** Visible to the member; written 10 days ago — the newest visible use. */
  let visibleRecentId = "";
  /** On the PRIVATE payroll Base, citing the (visible) visits prompt. */
  let hiddenId = "";
  /** Skill use from 45 days ago — outside the window, still the last use. */
  let staleSkillIso = "";

  beforeAll(async () => {
    await seedScenario("playbook-usage");
    raw = createRouterClient(busabaseRouter);
    await asManager(async () => {
      const cr = await raw.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          ...["visits", "payroll", "leads"].map((slug) => ({
            kind: "create" as const,
            nodeType: "base" as const,
            slug,
            name: slug[0]?.toUpperCase() + slug.slice(1),
            fields: [{ slug: "title", name: "Title", type: "text" as const }],
          })),
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
      leadsId = bySlug.get("leads") ?? "";
      skillId = bySlug.get("weekly-report") ?? "";
      await raw.nodes.updateAgentPrompts({ nodeId: visitsId, agentPrompts: VISIT_PROMPTS });
      await raw.nodes.updateAgentPrompts({
        nodeId: leadsId,
        agentPrompts: [{ key: "qualify", label: "Qualify a lead", body: "Qualify {target}." }],
      });
      await raw.nodes.updateVisibility({ nodeId: payrollId, visibility: "private" });
    });
    expect(visitsId && payrollId && leadsId && skillId).toBeTruthy();

    const visitPlaybook = `prompt:${visitsId}:log-visit`;
    const pending = async (baseId: string, title: string) => {
      const cr = await raw.bases.createChangeRequest({
        baseId,
        fields: { title },
        autoMerge: false,
      });
      if (cr.materialized) throw new Error("expected a pending change request");
      return cr.id;
    };

    visibleRejectedId = await asManager(() => pending(visitsId, "Acme"), visitPlaybook);
    await asManager(() =>
      raw.changeRequests.close({ changeRequestId: visibleRejectedId, reason: "Not needed" }),
    );
    visibleRecentId = await asManager(() => pending(visitsId, "Globex"), visitPlaybook);
    await backdate(visibleRecentId, 10);
    // Same (visible) playbook, but the change lands on a node the member cannot read.
    hiddenId = await asManager(() => pending(payrollId, "Payroll run"), visitPlaybook);
    // Uses outside the window: count 0, but still the "last used" time.
    const staleVisitId = await asManager(() => pending(visitsId, "Initech"), visitPlaybook);
    await backdate(staleVisitId, 60);
    const staleSkillCr = await asManager(
      () =>
        raw.nodes.createChangeRequest({
          operations: [{ kind: "create", nodeType: "folder", slug: "reports", name: "Reports" }],
        }),
      `skill:${skillId}`,
    );
    staleSkillIso = await backdate(staleSkillCr.id, 45);
    // A write with no playbook is not anyone's usage.
    await asManager(() => pending(leadsId, "No playbook"));
  });

  it("counts every status in the last 30 days and reports the newest use (manager sees all)", async () => {
    const { items } = await asManager(() => raw.playbooks.list({}));
    const visit = findPrompt(items, visitsId, "log-visit");
    // Rejected + in review (10 days ago) + the one on payroll; the 60-day-old one is outside.
    expect(visit?.usage?.changeRequests30d).toBe(3);
    // Newest of the three in-window ones: the payroll change (created last, not backdated).
    expect(visit?.usage?.lastUsedAt).toBe(await storedCreatedAt(hiddenId));

    const rejected = await asManager(() =>
      raw.changeRequests.get({ changeRequestId: visibleRejectedId }),
    );
    expect(rejected.status).toBe("rejected");
  });

  it("does not count change requests the viewer cannot see", async () => {
    // The member can read the visits prompt, but not the payroll Base the
    // third change landed on — the inbox hides it from them, so must the count.
    const inbox = await asMember(() => raw.changeRequests.inboxSnapshot({ page: 1, pageSize: 50 }));
    expect(inbox.changeRequests.some((cr) => cr.id === hiddenId)).toBe(false);

    const { items } = await asMember(() => raw.playbooks.list({}));
    const visit = findPrompt(items, visitsId, "log-visit");
    expect(visit?.usage?.changeRequests30d).toBe(2);
    // …and its time is not leaked through `lastUsedAt` either.
    const newestVisible = [
      await storedCreatedAt(visibleRejectedId),
      await storedCreatedAt(visibleRecentId),
    ].sort()[1];
    expect(visit?.usage?.lastUsedAt).toBe(newestVisible);
    expect(visit?.usage?.lastUsedAt).not.toBe(await storedCreatedAt(hiddenId));
  });

  it("reports a playbook used only before the window as 0 with its last use", async () => {
    const { items } = await asManager(() => raw.playbooks.list({}));
    expect(findSkill(items, skillId)?.usage).toEqual({
      changeRequests30d: 0,
      lastUsedAt: staleSkillIso,
    });
  });

  it("reports a never-cited playbook as zero, never used", async () => {
    const { items } = await asManager(() => raw.playbooks.list({}));
    expect(findPrompt(items, leadsId, "qualify")?.usage).toEqual({
      changeRequests30d: 0,
      lastUsedAt: null,
    });
  });
});
