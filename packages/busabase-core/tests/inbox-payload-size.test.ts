import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Inbox list PAYLOAD size — the dimension every earlier benchmark here missed.
 *
 * The previous rounds measured row counts and query time with fixtures whose
 * fields were `name: "Contact 123"`, so a per-row payload problem was invisible.
 * A production HAR showed the real shape: a change request that creates an
 * AirApp stores the app's entire source tree inline in its commit fields, and an
 * inbox page of 41 such rows was 5.2 MB — 1.1s of download against ~350ms of
 * server time.
 *
 * These tests pin that a list row stays small no matter how large the underlying
 * content is, while the detail view still returns everything.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
/** Roughly the size the production HAR showed for one AirApp's `initialFiles`. */
const HUGE_FIELD = "x".repeat(400_000);
const ROWS = 10;

describe("inbox list payload size", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-payload-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-payload-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "payload",
      name: "Payload",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "body", name: "Body", type: "longtext", options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    for (let i = 0; i < ROWS; i++) {
      await client.bases.createChangeRequest({
        baseId,
        fields: { name: `Row ${i}`, body: HUGE_FIELD },
        submittedBy: "local-producer",
        autoMerge: false,
      });
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

  const bytesOf = (value: unknown) => JSON.stringify(value)?.length ?? 0;

  it("keeps a list page small even when every row holds a huge field", async () => {
    const page = await client.changeRequests.list({ limit: ROWS } as never);
    const rows = page.changeRequests.filter((cr) => cr.baseId === baseId);
    expect(rows.length).toBeGreaterThan(0);

    const total = bytesOf(page);
    // Uncapped this is >4 MB for 10 rows (400 KB each, doubled by
    // `primaryOperation`). The budget is deliberately far below that and far
    // above what the small fields legitimately need.
    expect(total).toBeLessThan(300_000);
  }, 120_000);

  it("replaces only the oversized value, keeping the key and the small fields", async () => {
    const page = await client.changeRequests.list({ limit: ROWS } as never);
    const row = page.changeRequests.find((cr) => cr.baseId === baseId);
    if (!row) throw new Error("seeded row not found");
    const fields = row.operations[0]?.headCommit.fields ?? {};

    // The small field is untouched — list rows render this.
    expect(String(fields.name)).toMatch(/^Row \d+$/);
    // The key survives (a caller can still see the field exists)...
    expect(fields).toHaveProperty("body");
    // ...but the value is a short, self-describing marker, not the content.
    expect(bytesOf(fields.body)).toBeLessThan(200);
    expect(String(fields.body)).toContain("omitted");
  }, 120_000);

  it("the detail view still returns the full content", async () => {
    const page = await client.changeRequests.list({ limit: ROWS } as never);
    const row = page.changeRequests.find((cr) => cr.baseId === baseId);
    if (!row) throw new Error("seeded row not found");

    const detail = await client.changeRequests.get({ changeRequestId: row.id } as never);
    const body = detail?.operations[0]?.headCommit.fields.body;
    expect(String(body)).toHaveLength(HUGE_FIELD.length);
  }, 120_000);
});
