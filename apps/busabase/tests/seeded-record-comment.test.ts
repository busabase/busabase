import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Commenting on a SEEDED record.
 *
 * Comment permission is scoped by walking record -> headCommitId -> commits ⋈
 * operations to find the owning ChangeRequest. The seeder writes commits directly
 * with no operation row, so that join came back empty and the API answered
 * `404 Subject not found: cmt_…` — naming a commit id, for a record that plainly
 * exists and that the same actor can already read and write. Every seeded record
 * was affected; a record created through the CR pipeline was not, which is why
 * nothing noticed until the demo walkthrough tried it.
 *
 * Uses `englishScenario` (what `db:seed:all` applies) because that is the scenario
 * that seeds records directly — the busabase-core collaboration test seeds only
 * folders and bases, so every record in it has a CR history and cannot reproduce
 * this at all.
 */
describe("comments on seeded records", () => {
  let dataDir = "";
  let storageDir = "";

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-seeded-comment-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-seeded-comment-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("accepts a comment on a seeded record whose commit has no operation", async () => {
    const store = await import("busabase-core/logic/store");
    const base = await import("busabase-core/domains/base/handlers");
    const { englishScenario } = await import("busabase-core/demo/dataset");
    await store.seedScenario(englishScenario);

    // Assert the premise rather than assume it: this record must have NO
    // change-request history, i.e. be one the seeder wrote directly. A record with
    // a CR would exercise the CR lookup and never reach the fallback.
    const { records } = await base.listRecordsPaged({ limit: 50 });
    expect(records.length).toBeGreaterThan(0);
    let seeded: (typeof records)[number] | undefined;
    for (const candidate of records) {
      const history = await store.listRecordChangeRequests(candidate.id);
      if (history.length === 0) {
        seeded = candidate;
        break;
      }
    }
    if (!seeded) {
      throw new Error(
        "expected a seeded record with no change-request history — if the seeder now goes through the CR pipeline this test is vacuous and should be deleted, not relaxed",
      );
    }

    const comment = await store.createComment({
      subjectType: "record",
      subjectId: seeded.id,
      authorId: "seeded-record-commenter",
      body: "Commenting on a seeded record used to 404 with its commit id.",
    });
    expect(comment.subjectId).toBe(seeded.id);
    expect(comment.recordId).toBe(seeded.id);

    const listed = await store.listComments({ subjectType: "record", subjectId: seeded.id });
    expect(listed.map((item) => item.id)).toContain(comment.id);
  });
});
