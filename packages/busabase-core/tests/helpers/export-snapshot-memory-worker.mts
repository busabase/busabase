/** Disposable child process: only this producer has a constrained V8 heap. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resetStorage } from "openlib/storage";
import * as schema from "../../src/db/schema";
import { seedSnapshotSpace, snapshotHttpHost } from "./export-snapshot-fixture";

const directory = await mkdtemp(path.join(tmpdir(), "snapshot-heap-proof-"));
process.env.STORAGE_URL = `local:${directory}/storage?base_url=/api/storage`;
resetStorage();
const client = await PGlite.create({ extensions: { pg_trgm } });
let host: Awaited<ReturnType<typeof snapshotHttpHost>> | undefined;
try {
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: path.resolve(
      import.meta.dirname,
      "../../../../apps/busabase/src/db/migrations",
    ),
  });
  await seedSnapshotSpace(db, "memory-proof");
  // A large JSON string containing quoted JSON and CJK forces wide V8 strings
  // and the extra escape layer in rowsJson, unlike a repeat of ASCII "x".
  const unit = JSON.stringify({ title: "中文", path: "a\\b", value: '"quoted"\n' });
  const inserted = await client.query<{ bytes: number }>(
    `WITH added AS (
      INSERT INTO busabase_commits(id,space_id,base_id,payload,author)
      SELECT 'large-' || g, 'memory-proof', 'memory-proof-base',
        jsonb_build_object('source-summary', repeat($1::text, 450000)), 'owner'
      FROM generate_series(1,4) g RETURNING payload
    ) SELECT sum(octet_length(payload::text))::bigint AS bytes FROM added`,
    [unit],
  );
  host = await snapshotHttpHost(db);
  process.stdout.write(
    `${JSON.stringify({ ready: host.origin, sqlPayloadBytes: Number(inserted.rows[0].bytes) })}\n`,
  );
  await new Promise<void>((resolve) => process.once("SIGTERM", resolve));
} finally {
  await host?.close();
  await client.close();
  resetStorage();
  await rm(directory, { recursive: true, force: true });
}
