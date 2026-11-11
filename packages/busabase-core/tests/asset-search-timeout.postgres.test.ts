/** Real server cancellation must not erase already completed file-match pages. */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { storage } from "openlib/storage";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "../src/db";
import { busabaseAssetUsages } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

const adminUrl = process.env.ASSET_SEARCH_PG_TEST_URL;
const migrationsCwd = path.resolve(__dirname, "../../../apps/busabase");
const marker = "BODYTIMEOUTMARKER";

describe.skipIf(!adminUrl)("file search — real PostgreSQL statement timeout", () => {
  const dbName = `busabase_asset_timeout_${Date.now()}`;
  let admin: ReturnType<typeof postgres>;
  let observer: ReturnType<typeof postgres>;
  let originalCwd = "";
  let storageDir = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  const fastIds: string[] = [];
  let slowId = "";

  beforeAll(async () => {
    if (!adminUrl) throw new Error("ASSET_SEARCH_PG_TEST_URL is required");
    admin = postgres(adminUrl, { max: 1, prepare: false });
    await admin.unsafe(`create database "${dbName}"`);
    const url = new URL(adminUrl);
    url.pathname = `/${dbName}`;
    observer = postgres(url.toString(), { max: 2, prepare: false });
    originalCwd = process.cwd();
    process.chdir(migrationsCwd);
    storageDir = await mkdtemp(path.join(os.tmpdir(), "asset-timeout-storage-"));
    process.env.PG_DATABASE_URL = url.toString();
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const db = await getDb();
    await migrate(db as Parameters<typeof migrate>[0], {
      migrationsFolder: path.resolve(migrationsCwd, "src/db/migrations"),
    });
    client = createRouterClient(busabaseRouter);
    for (let index = 0; index < 41; index++) {
      const bytes = Buffer.from(`%PDF timeout fixture ${index}`);
      const input = {
        fileName: `fixture-${index}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: bytes.length,
        contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      };
      const pending = await client.assets.createUploadUrl(input);
      await storage.uploadFileToKey(bytes, pending.storageKey, input.mimeType);
      const confirmed = await client.assets.confirm({ ...input, storageKey: pending.storageKey });
      if (!confirmed.assetId) throw new Error("Missing asset id");
      const assetId = confirmed.assetId;
      await client.nodes.createChangeRequest({
        autoMerge: true,
        operations: [
          {
            kind: "create",
            nodeType: "file",
            name: `Fixture ${index}`,
            slug: `timeout-fixture-${index}`,
            metadata: { assetId },
          },
        ],
      });
      await client.assets.putText({ assetId, text: `${marker} is in fixture ${index}.` });
      await db
        .update(busabaseAssetUsages)
        .set({ updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 60 - index)) })
        .where(eq(busabaseAssetUsages.assetId, assetId));
      if (index < 32) fastIds.push(assetId);
      if (index === 32) slowId = assetId;
    }
    // Keep the ranking workload at a large workspace's scale. These older
    // indexed assets do not match; no object reads or background heal are needed.
    const templateId = fastIds[0];
    await observer`
      insert into busabase_assets(id, space_id, attachment_id, name)
      select 'bulk_timeout_' || g, a.space_id, a.attachment_id, 'Bulk fixture'
      from busabase_assets a cross join generate_series(1, 24000) g where a.id = ${templateId}`;
    await observer`
      insert into busabase_asset_usages(id, space_id, asset_id, owner_type, node_id, updated_at)
      select a.id, a.space_id, a.id, 'file_node', u.node_id, timestamp '2025-01-01'
      from busabase_assets a cross join busabase_asset_usages u
      where a.id like 'bulk_timeout_%' and u.asset_id = ${templateId}`;
    await observer`
      insert into busabase_asset_texts(id, space_id, asset_id, text_storage_key, written_by)
      select a.id, a.space_id, a.id, a.id, 'test' from busabase_assets a where a.id like 'bulk_timeout_%'`;
    await observer`
      insert into busabase_asset_text_search(asset_id, space_id, text_storage_key, complete)
      select a.id, a.space_id, a.id, true from busabase_assets a where a.id like 'bulk_timeout_%'`;
    await observer`
      insert into busabase_asset_text_search_chunks(asset_id, chunk_index, content_text)
      select a.id, 0, 'Unrelated indexed body' from busabase_assets a where a.id like 'bulk_timeout_%'`;
    await observer`analyze`;
    // This throwaway DB alone gets a slow later candidate. No search/timer mock.
    await observer.unsafe(
      `alter table busabase_asset_text_search_chunks rename to timeout_original_chunks`,
    );
    await observer.unsafe(`create function timeout_text(asset text, body text) returns text language plpgsql stable as $$
      begin
        if asset = '${slowId}' and current_setting('test.asset_delay', true) = 'on' then
          perform pg_sleep(3);
        end if;
        return body;
      end $$`);
    await observer.unsafe(`create view busabase_asset_text_search_chunks as
      select asset_id, chunk_index, timeout_text(asset_id, content_text) as content_text from timeout_original_chunks`);
  }, 120_000);

  afterAll(async () => {
    await closeDb();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    await observer?.end();
    await admin?.unsafe(`drop database if exists "${dbName}" with (force)`);
    await admin?.end();
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("keeps completed matching pages when the next page is cancelled", async () => {
    const input = {
      query: marker,
      sources: ["files"] as "files"[],
      mode: "full" as const,
      sort: "updated_desc" as const,
      limit: 100,
    };
    const control = await client.search(input);
    expect(control.results).toHaveLength(41);
    await observer.unsafe(`alter database "${dbName}" set "test.asset_delay" = 'on'`);
    await closeDb();
    const started = Date.now();
    const result = await client.search(input);
    expect(result.results.map((row) => row.id.split(":")[0])).toEqual(fastIds);
    expect(result.contentTruncated).toBe(true);
    expect(Date.now() - started).toBeLessThan(7_000);
    const active = await observer`select count(*)::int as n from pg_stat_activity
      where datname = current_database() and pid <> pg_backend_pid() and state = 'active'
      and query ilike '%busabase_asset_text_search_chunks%'`;
    expect(active[0]?.n).toBe(0);
  }, 30_000);
});
