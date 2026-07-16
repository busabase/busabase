import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Regression coverage for the 2026-07-15 news-merge incident: raising
 * VALUE_TEXT_INDEX_LIMIT (vo.ts) from 1,024 to 8,000 chars let long,
 * multi-byte-heavy field values overflow Postgres's btree row-size limit
 * when busabase_field_values_base_field_text_idx indexed the full value_text
 * column, aborting the merge transaction. The fix drops valueText from that
 * index (schema.ts) — this suite proves the write path survives realistic
 * long CJK content and that exact-value lookups (listRecordsByFieldText, the
 * query a lifebee_key-style de-dup check relies on) still work afterward.
 *
 * Defaults to a throwaway PGlite dir like the rest of this suite, but honors
 * an externally-provided PG_DATABASE_URL so it can be re-run against a real
 * Postgres — PGlite does not reliably reproduce Postgres's btree row-size
 * enforcement for highly-compressible repeated text, so real Postgres is the
 * only way to actually confirm this fix.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const EXTERNAL_PG_URL = process.env.PG_DATABASE_URL;

// Random (non-repeating) CJK codepoints so the value can't be squashed by
// TOAST/pglz compression before it reaches the btree — repeat()-style
// content compresses away and would silently fail to reproduce the bug.
const randomCjkText = (chars: number) => {
  let out = "";
  for (let i = 0; i < chars; i++) {
    out += String.fromCharCode(0x4e00 + Math.floor(Math.random() * 20000));
  }
  return out;
};

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("busabase_field_values btree index survives long field values", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    if (EXTERNAL_PG_URL) {
      process.env.PG_DATABASE_URL = EXTERNAL_PG_URL;
    } else {
      dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-btree-db-"));
      process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    }
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-btree-storage-"));
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "btree-news",
      name: "BTree News",
      fields: [
        { slug: "lifebeeKey", name: "Lifebee Key", type: "text", required: true },
        { slug: "body", name: "Body", type: "longtext" },
        { slug: "html", name: "HTML", type: "html" },
      ],
      autoMerge: true,
    });
    baseId = base.id;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("merges a record with a long Chinese body and ~200KB HTML without a btree error", async () => {
    const lifebeeKey = "news-canary-001";
    const body = randomCjkText(6_000);
    // ~200KB of (deliberately non-repeating) HTML-ish content.
    const html = Array.from(
      { length: 4_000 },
      (_, i) => `<p data-i="${i}">${randomCjkText(40)}</p>`,
    ).join("\n");
    expect(html.length).toBeGreaterThan(190_000);

    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { lifebeeKey, body, html },
      message: "canary: long CJK news article",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestId: cr.id });

    if (!merged.record) {
      throw new Error("Expected merge to return a record");
    }
    expect(merged.changeRequest.status).toBe("merged");

    const record = await client.records.get({ recordId: merged.record.id });
    expect(record?.headCommit.fields.lifebeeKey).toBe(lifebeeKey);
    expect(record?.headCommit.fields.body).toBe(body);
    expect(record?.headCommit.fields.html).toBe(html);
  });

  it("exact-match search by field value (lifebee_key-style de-dup check) still works", async () => {
    const lifebeeKey = "news-canary-002";
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { lifebeeKey, body: "short body", html: "<p>short</p>" },
      message: "second canary record",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const hits = await client.records.search({
      baseId,
      fieldSlug: "lifebeeKey",
      valueText: lifebeeKey,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.headCommit.fields.lifebeeKey).toBe(lifebeeKey);

    const misses = await client.records.search({
      baseId,
      fieldSlug: "lifebeeKey",
      valueText: "does-not-exist",
    });
    expect(misses).toHaveLength(0);
  });

  it("a failed merge surfaces a clean error and leaves existing state untouched", async () => {
    // Merge atomicity itself (a multi-op CR rolling back an earlier op when a
    // later one fails) is covered by merge-atomicity.test.ts. This asserts the
    // other half of the incident report's ask: whatever throws during merge,
    // the client only ever sees a short, generic message — never raw SQL /
    // field content — and unrelated existing records are unaffected.
    const lifebeeKey = "news-canary-003";
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { lifebeeKey, body: "x", html: "<p>x</p>" },
      message: "clean-error probe",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const before = await client.records.search({
      baseId,
      fieldSlug: "lifebeeKey",
      valueText: lifebeeKey,
    });
    expect(before).toHaveLength(1);

    // Re-merging an already-merged CR is idempotent by design (see
    // cr-lifecycle.ts), so assert on a genuinely invalid merge instead: an
    // unknown changeRequestId must surface a clean NOT_FOUND, not a raw error.
    let caught: unknown;
    try {
      await client.changeRequests.merge({ changeRequestId: "crq_does_not_exist" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).not.toMatch(/INSERT INTO|SELECT .* FROM|btree|value_text/i);
    expect(message.length).toBeLessThan(200);

    const after = await client.records.search({
      baseId,
      fieldSlug: "lifebeeKey",
      valueText: lifebeeKey,
    });
    expect(after).toHaveLength(1);
  });
});
