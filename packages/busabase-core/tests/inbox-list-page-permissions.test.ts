import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * The inbox paginator vs. the inbox tab badge, for a NON-manager.
 *
 * These are two different code paths over the same tab, and they used to
 * disagree: `countChangeRequests` filtered by what the caller may see, while
 * `listChangeRequestsPage` counted every row with a bare `count(*)` and only
 * applied the visibility filter to the page it had already sliced. The visible
 * symptom was a tab reading one number, the paginator underneath it reading a
 * larger one, and pages rendering fewer rows than the page size — or none — when
 * the OFFSET window happened to land on change requests the reviewer cannot read.
 *
 * The setup is deliberately lopsided: the hidden base carries MORE change
 * requests than the visible one, so an unfiltered count can never coincidentally
 * match the filtered one.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MEMBER = "local-editor";
const VISIBLE_PENDING = 7;
const HIDDEN_PENDING = 19;
const OVERSIZED_BODY = "x".repeat(400_000);

/** Everything a plain space member (explicitly NOT a manager) would see. */
const asMember = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithBusabaseContext(
    {
      spaceId: LOCAL_SPACE_ID,
      actorId: MEMBER,
      isSpaceManager: false,
      permissionLevel: "manage",
    },
    fn,
  );

describe("inbox listPage permissions", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let oversizedVisibleCrId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-listpage-acl-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-listpage-acl-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const fields = [
      { slug: "name", name: "Name", type: "text", required: true, options: {} },
      { slug: "body", name: "Body", type: "longtext", options: {} },
    ];
    const visible = await client.bases.create({
      slug: "listpage-visible",
      name: "Visible",
      fields,
      autoMerge: true,
    } as never);
    const hidden = await client.bases.create({
      slug: "listpage-hidden",
      name: "Hidden",
      fields,
      autoMerge: true,
    } as never);

    const propose = async (baseId: string, name: string, body?: string) =>
      client.bases.createChangeRequest({
        baseId,
        fields: { name, ...(body ? { body } : {}) },
        submittedBy: "local-producer",
        autoMerge: false,
      });

    const oversized = await propose(visible.id, "visible-oversized", OVERSIZED_BODY);
    oversizedVisibleCrId = oversized.id;
    for (let i = 1; i < VISIBLE_PENDING; i++) await propose(visible.id, `visible-${i}`);
    for (let i = 0; i < HIDDEN_PENDING; i++) await propose(hidden.id, `hidden-${i}`);

    // Done last so the proposals above are authored while the base is still
    // reachable — the point of the test is the READ path, not the write path.
    await client.nodes.updateVisibility({ nodeId: hidden.nodeId, visibility: "private" } as never);
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("a manager still sees every pending change request", async () => {
    const page = await client.changeRequests.listPage({
      status: ["in_review"],
      page: 1,
      pageSize: 100,
    } as never);
    expect(page.total).toBe(VISIBLE_PENDING + HIDDEN_PENDING);
    expect(page.changeRequests).toHaveLength(VISIBLE_PENDING + HIDDEN_PENDING);
  });

  // The load-bearing one: the number under the list must be the number on the tab.
  it("returns matching badges and page from one non-manager snapshot", async () => {
    const snapshot = await asMember(() =>
      client.changeRequests.inboxSnapshot({
        status: ["in_review"],
        page: 1,
        pageSize: 5,
      } as never),
    );

    expect(snapshot.counts.review).toBe(VISIBLE_PENDING);
    expect(snapshot.total).toBe(snapshot.counts.review);
    expect(snapshot.totalPages).toBe(Math.ceil(VISIBLE_PENDING / 5));
    expect(snapshot.changeRequests).toHaveLength(5);
  });

  it("emits payload-free scan metrics once for one snapshot", async () => {
    const metrics: Array<{
      candidateRows: number;
      visibleRows: number;
      pageRows: number;
      responseBytes: number;
    }> = [];
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MEMBER,
        isSpaceManager: false,
        permissionLevel: "manage",
        onPerformanceMetric: (metric) => metrics.push(metric),
      },
      () =>
        client.changeRequests.inboxSnapshot({
          status: ["in_review"],
          page: 1,
          pageSize: 5,
        } as never),
    );

    expect(metrics).toHaveLength(1);
    expect(metrics[0]).toMatchObject({
      candidateRows: expect.any(Number),
      visibleRows: expect.any(Number),
      pageRows: 5,
      responseBytes: expect.any(Number),
    });
    expect(metrics[0]?.candidateRows).toBeGreaterThan(metrics[0]?.visibleRows ?? 0);
    expect(metrics[0]?.visibleRows).toBeGreaterThanOrEqual(VISIBLE_PENDING);
  });

  it("every page a non-manager can reach is full, and holds only visible rows", async () => {
    const seen = await asMember(async () => {
      const ids = new Set<string>();
      const first = await client.changeRequests.listPage({
        status: ["in_review"],
        page: 1,
        pageSize: 5,
      } as never);
      for (let n = 1; n <= first.totalPages; n++) {
        const page = await client.changeRequests.listPage({
          status: ["in_review"],
          page: n,
          pageSize: 5,
        } as never);
        // The last page may be short; no earlier page may be.
        if (n < first.totalPages) expect(page.changeRequests).toHaveLength(5);
        expect(page.changeRequests.length).toBeGreaterThan(0);
        for (const cr of page.changeRequests) ids.add(cr.id);
      }
      return ids;
    });
    expect(seen.size).toBe(VISIBLE_PENDING);
  });

  it("agrees with the cursor listing a non-manager gets", async () => {
    const { viaCursor, viaPage } = await asMember(async () => {
      const cursorIds: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await client.changeRequests.list({
          status: ["in_review"],
          limit: 5,
          cursor,
        } as never);
        cursorIds.push(...page.changeRequests.map((cr) => cr.id));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      const pageIds: string[] = [];
      const totalPages = Math.ceil(VISIBLE_PENDING / 5);
      for (let n = 1; n <= totalPages; n++) {
        const page = await client.changeRequests.listPage({
          status: ["in_review"],
          page: n,
          pageSize: 5,
        } as never);
        pageIds.push(...page.changeRequests.map((cr) => cr.id));
      }
      return { viaCursor: cursorIds, viaPage: pageIds };
    });

    expect(viaPage).toEqual(viaCursor);
  });

  it("keeps ACL semantics and list memory bounded for an oversized commit", async () => {
    const { detail, listRow } = await asMember(async () => {
      const page = await client.changeRequests.listPage({
        status: ["in_review"],
        page: 1,
        pageSize: 100,
      } as never);
      return {
        listRow: page.changeRequests.find((row) => row.id === oversizedVisibleCrId),
        detail: await client.changeRequests.get({ changeRequestId: oversizedVisibleCrId } as never),
      };
    });

    expect(listRow).toBeDefined();
    expect(String(listRow?.operations[0]?.headCommit.payload.body)).toContain("omitted");
    expect(String(detail?.operations[0]?.headCommit.payload.body)).toHaveLength(
      OVERSIZED_BODY.length,
    );
  });
});
