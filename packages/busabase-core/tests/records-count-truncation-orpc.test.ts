import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Regression: `valueText` (what `contains`/`equals` match against in SQL) is
 * truncated at `VALUE_TEXT_INDEX_LIMIT` (8,000 chars, see logic/vo.ts), but
 * the authoritative client match (`recordMatchesViewFilter` → the full value
 * in `commits.payload`) is never truncated. Without a truncation guard, a
 * `longtext`/`markdown` field with a match term past the cutoff would
 * silently under-count — exactly the "confidently wrong authoritative number"
 * failure `records.count` exists to avoid. `countRecords`'s
 * `hasTruncatedFieldValue` probe must detect this and route the whole count
 * to the exact fallback. Kept in its own file (one real-PGLite fixture per
 * file — see vitest.config.ts) rather than a second `describe` in
 * `records-count-filters-orpc.test.ts`.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MARKER = "ZZUNIQUEMARKERZZ";

describe("records.count — truncated valueText projection", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-count-trunc-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-count-trunc-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "articles",
      name: "Articles",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "body", name: "Body", type: "longtext", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records: [
        // Marker sits AFTER the 8,000-char truncation point — invisible to a
        // naive ILIKE against the truncated `valueText` projection.
        { title: "long", body: `${"a".repeat(9000)}${MARKER}` },
        // Control: marker well before the limit — must always match, on
        // either the fast path or the fallback.
        { title: "short", body: `hello ${MARKER} world` },
        // Control: no marker at all — must never match.
        { title: "unrelated", body: "nothing to see here" },
      ],
      message: "Seed articles",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
  }, 180_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("counts a match past the truncation cutoff correctly (contains)", async () => {
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "body", fieldType: "longtext", operator: "contains", value: MARKER }],
    });
    expect(total).toBe(2); // "long" (match past cutoff) + "short" (match well within it)
  });

  it("counts a match past the truncation cutoff correctly (equals, full value)", async () => {
    const longBody = `${"a".repeat(9000)}${MARKER}`;
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "body", fieldType: "longtext", operator: "equals", value: longBody }],
    });
    expect(total).toBe(1); // only the exact 9000+marker-char value
  });

  it("truncation on one field doesn't block an exact-count on an untruncated field", async () => {
    // `title` never exceeds the limit, so it must stay on the cheap SQL path
    // even though `body` (a different field on the same Base) is truncated.
    const { total } = await client.records.count({
      baseId,
      filters: [{ fieldSlug: "title", fieldType: "text", operator: "equals", value: "short" }],
    });
    expect(total).toBe(1);
  });
});
