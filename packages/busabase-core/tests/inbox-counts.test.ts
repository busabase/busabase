import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Inbox tab badge counts.
 *
 * `countChangeRequests` has two code paths: a space manager sees everything, so
 * the badges come from a SQL aggregate; a non-manager's visibility depends on
 * each change request's node scope, so that path still walks the table and
 * filters. The whole point of the aggregate is that it is EQUIVALENT — this
 * pins that, because a counting fast path that quietly disagrees with the slow
 * one shows the user wrong badges with no error anywhere.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MINE = "local-editor";
const OTHER = "local-producer";

describe("inbox counts", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-counts-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-inbox-counts-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "inbox-counts",
      name: "Inbox Counts",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;

    const propose = async (name: string, submittedBy: string) =>
      (
        await client.bases.createChangeRequest({
          baseId,
          fields: { name },
          submittedBy,
          autoMerge: false,
        })
      ).id;

    // A deliberately uneven spread so a bug that conflates two statuses, or
    // drops the "mine" scoping, cannot coincidentally produce right numbers.
    for (let i = 0; i < 7; i++) await propose(`pending-${i}`, OTHER);
    for (let i = 0; i < 3; i++) await propose(`pending-mine-${i}`, MINE);

    for (let i = 0; i < 4; i++) {
      const id = await propose(`merged-${i}`, OTHER);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [id] });
    }
    for (let i = 0; i < 2; i++) {
      const id = await propose(`merged-mine-${i}`, MINE);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [id] });
    }

    for (let i = 0; i < 5; i++) {
      const id = await propose(`approved-${i}`, OTHER);
      await client.changeRequests.review({ changeRequestIds: [id], verdict: "approved" });
    }
    for (let i = 0; i < 6; i++) {
      const id = await propose(`closed-${i}`, OTHER);
      await client.changeRequests.close({ changeRequestId: id } as never);
    }
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts every status across the whole space, not just one page", async () => {
    const counts = await client.changeRequests.counts({} as never);
    expect(counts).toEqual({
      review: 10, // 7 + 3 still in_review
      changes: 0,
      created: 5, // 3 pending-mine + 2 merged-mine
      approved: 5,
      // 4 + 2 seeded, plus the change request that creating the Base itself
      // merged (`bases.create({ autoMerge: true })` goes through the same
      // review-first pipeline — there is no back door that writes without one).
      merged: 7,
      rejected: 6,
    });
  });

  it("the badge totals agree with what each tab's list actually returns", async () => {
    const counts = await client.changeRequests.counts({} as never);
    const walk = async (input: Record<string, unknown>) => {
      const seen = new Set<string>();
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await client.changeRequests.list({ ...input, limit: 5, cursor } as never);
        for (const cr of page.changeRequests) seen.add(cr.id);
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      return seen.size;
    };
    expect(await walk({ status: ["in_review"] })).toBe(counts.review);
    expect(await walk({ status: ["approved"] })).toBe(counts.approved);
    expect(await walk({ status: ["merged"] })).toBe(counts.merged);
    expect(await walk({ status: ["rejected", "abandoned"] })).toBe(counts.rejected);
    expect(await walk({ mine: true })).toBe(counts.created);
  });

  // The load-bearing one. The manager path is a SQL aggregate; the non-manager
  // path walks and filters. On a space where everything is visible to both they
  // must produce identical badges — otherwise the fast path is not an
  // optimisation, it is a second, disagreeing implementation.
  it("manager aggregate and non-manager walk agree on a fully visible space", async () => {
    const asManager = await client.changeRequests.counts({} as never);
    const asMember = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: MINE,
        isSpaceManager: false,
        permissionLevel: "manage",
      },
      () => client.changeRequests.counts({} as never),
    );
    expect(asMember).toEqual(asManager);
  });
});
