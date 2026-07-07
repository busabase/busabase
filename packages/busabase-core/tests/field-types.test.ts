import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Field-type functionality end-to-end against a real PGLite database:
 *  - every field type stores a value through the create → review → merge loop;
 *  - auto_number auto-increments per base;
 *  - created_time / created_by / updated_time / updated_by are server-populated;
 *  - updates preserve create-time fields and re-stamp the updated_ fields;
 *  - client attempts to set system fields are ignored;
 *  - bad values are rejected at change-request submission.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const SELECT_CHOICES = [
  { id: "s1", name: "Open" },
  { id: "s2", name: "Closed" },
];
const MULTI_CHOICES = [
  { id: "m1", name: "alpha" },
  { id: "m2", name: "beta" },
];
const ATTACHMENT_OPTS = {
  maxFiles: 2,
  allowedMimeTypes: ["image/png", "text/markdown"],
  maxFileSize: 10 * 1024 * 1024,
};
// Synthetic inline refs — `attachmentId` is a loose text ref (not an FK), so the
// merge registers them via ensureAsset without a real upload.
const ATTACH_PNG = {
  id: "att_ft_png",
  url: "https://cdn.example.com/x.png",
  fileName: "x.png",
  mimeType: "image/png",
  size: 142_336,
};
const ATTACH_MD = {
  id: "att_ft_md",
  url: "https://cdn.example.com/n.md",
  fileName: "notes.md",
  mimeType: "text/markdown",
  size: 4_096,
};

describe("Base field types — end-to-end", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let relatedRecordId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldtypes-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fieldtypes-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // A base to point relation fields at, plus one record to link to.
    const related = await client.bases.create({
      slug: "ft-related",
      name: "Related",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
    });
    const relCr = await client.bases.createChangeRequest({
      baseId: related.id,
      fields: { title: "linked" },
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestId: relCr.id, verdict: "approved" });
    const relMerged = await client.changeRequests.merge({ changeRequestId: relCr.id });
    relatedRecordId = relMerged.record?.id ?? "";

    // The base under test: one field per type.
    const base = await client.bases.create({
      slug: "ft-everything",
      name: "Everything",
      fields: [
        { slug: "f_text", name: "Text", type: "text" },
        { slug: "f_longtext", name: "Long", type: "longtext" },
        { slug: "f_markdown", name: "Markdown", type: "markdown" },
        { slug: "f_html", name: "Html", type: "html" },
        { slug: "f_code", name: "Code", type: "code" },
        { slug: "f_json", name: "JSON", type: "json" },
        { slug: "f_yaml", name: "YAML", type: "yaml" },
        { slug: "f_number", name: "Number", type: "number" },
        { slug: "f_checkbox", name: "Checkbox", type: "checkbox" },
        { slug: "f_date", name: "Date", type: "date" },
        { slug: "f_email", name: "Email", type: "email" },
        { slug: "f_url", name: "Url", type: "url" },
        { slug: "f_phone", name: "Phone", type: "phone" },
        { slug: "f_select", name: "Select", type: "select", options: { choices: SELECT_CHOICES } },
        {
          slug: "f_multiselect",
          name: "Multi",
          type: "multiselect",
          options: { choices: MULTI_CHOICES },
        },
        {
          slug: "f_relation",
          name: "Relation",
          type: "relation",
          options: { targetBaseId: related.id },
        },
        {
          slug: "f_attachment",
          name: "Attachment",
          type: "attachment",
          options: { attachment: ATTACHMENT_OPTS },
        },
        { slug: "f_ai_summary", name: "AI Summary", type: "ai_summary" },
        { slug: "f_ai_tags", name: "AI Tags", type: "ai_tags" },
        { slug: "created_at", name: "Created", type: "created_time" },
        { slug: "updated_at", name: "Updated", type: "updated_time" },
        { slug: "created_by", name: "Author", type: "created_by" },
        { slug: "updated_by", name: "Editor", type: "updated_by" },
        { slug: "seq", name: "Seq", type: "auto_number" },
      ],
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const createRecord = async (fields: Record<string, unknown>, submittedBy = "agent") => {
    const cr = await client.bases.createChangeRequest({ baseId, fields, submittedBy });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestId: cr.id });
    if (!merged.record) throw new Error("expected a created record");
    return merged.record.id;
  };

  const readFields = async (recordId: string): Promise<Record<string, unknown>> => {
    const record = await client.records.get({ recordId });
    return record.headCommit.fields;
  };

  const validValues = (): Record<string, unknown> => ({
    f_text: "hello",
    f_longtext: "a longer body",
    f_markdown: "# title",
    f_html: "<b>x</b>",
    f_code: "const x = 1;",
    f_json: '{"ok":true,"items":[1,2]}',
    f_yaml: "ok: true\nitems:\n  - 1\n  - 2",
    f_number: 42,
    f_checkbox: true,
    f_date: "2026-06-24T00:00:00.000Z",
    f_email: "a@b.com",
    f_url: "https://example.com",
    f_phone: "+1 555-123-4567",
    f_select: "Open",
    f_multiselect: ["alpha", "beta"],
    f_relation: [relatedRecordId],
    f_attachment: [ATTACH_PNG, ATTACH_MD],
    f_ai_summary: "a summary",
    f_ai_tags: ["x", "y"],
  });

  describe("stores every field type and computes system fields", () => {
    let recordId = "";
    let stored: Record<string, unknown> = {};

    beforeAll(async () => {
      recordId = await createRecord(validValues());
      stored = await readFields(recordId);
    });

    it("round-trips every user-supplied field value", () => {
      const expected = validValues();
      for (const [slug, value] of Object.entries(expected)) {
        expect(stored[slug], `field ${slug}`).toEqual(value);
      }
    });

    it("assigns auto_number = 1 for the first record", () => {
      expect(stored.seq).toBe(1);
    });

    it("populates created_time / updated_time as ISO strings", () => {
      expect(typeof stored.created_at).toBe("string");
      expect(Number.isNaN(new Date(stored.created_at as string).getTime())).toBe(false);
      expect(typeof stored.updated_at).toBe("string");
    });

    it("populates created_by / updated_by with the submitter", () => {
      expect(stored.created_by).toBe("agent");
      expect(stored.updated_by).toBe("agent");
    });
  });

  it("auto_number increments per base across records", async () => {
    const r2 = await createRecord({ f_text: "second" });
    const r3 = await createRecord({ f_text: "third" });
    expect((await readFields(r2)).seq).toBe(2);
    expect((await readFields(r3)).seq).toBe(3);
  });

  it("ignores client-supplied system field values (server wins)", async () => {
    const recordId = await createRecord({
      f_text: "spoofed",
      seq: 999,
      created_by: "hacker",
      created_at: "1999-01-01T00:00:00.000Z",
    });
    const fields = await readFields(recordId);
    expect(fields.seq).not.toBe(999); // sequential, not the spoofed value
    expect(fields.created_by).toBe("agent"); // resolved actor, not "hacker"
    expect(fields.created_at).not.toBe("1999-01-01T00:00:00.000Z");
  });

  it("on update: re-stamps updated_*, preserves created_* and auto_number", async () => {
    const recordId = await createRecord({ f_text: "v1" });
    const before = await readFields(recordId);

    const updateCr = await client.records.updateChangeRequest({
      recordId,
      fields: { f_text: "v2" },
      author: "editor-2",
    });
    await client.changeRequests.review({ changeRequestId: updateCr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: updateCr.id });
    const after = await readFields(recordId);

    expect(after.f_text).toBe("v2"); // user edit applied
    expect(after.created_at).toBe(before.created_at); // preserved
    expect(after.created_by).toBe(before.created_by); // preserved
    expect(after.seq).toBe(before.seq); // auto_number preserved
    expect(after.updated_by).toBe("editor-2"); // re-stamped to the editor
    expect(typeof after.updated_at).toBe("string");
  });

  describe("rejects invalid values at submission", () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["number", { f_number: "abc" }, /must be a number/],
      ["email", { f_email: "not-an-email" }, /valid email/],
      ["url", { f_url: "not a url" }, /valid URL/],
      ["checkbox", { f_checkbox: "yes" }, /true or false/],
      ["date", { f_date: "not-a-date" }, /valid date/],
      ["json", { f_json: "{bad json" }, /valid JSON/],
      ["yaml", { f_yaml: "bad: [" }, /valid YAML/],
      ["phone", { f_phone: "call-me" }, /valid phone/],
      ["relation", { f_relation: 42 }, /record id/],
      ["select outside choices", { f_select: "Unknown" }, /one of its options/],
      ["multiselect outside choices", { f_multiselect: ["alpha", "zzz"] }, /list of its options/],
      ["attachment not an array", { f_attachment: ATTACH_PNG }, /list of attachments/],
      ["attachment malformed ref", { f_attachment: [{ url: "x" }] }, /invalid attachment/],
      [
        "attachment too many files",
        { f_attachment: [ATTACH_PNG, ATTACH_MD, { ...ATTACH_PNG, id: "a3" }] },
        /at most 2 files/,
      ],
      [
        "attachment disallowed mime",
        { f_attachment: [{ ...ATTACH_PNG, mimeType: "application/pdf" }] },
        /does not allow files of type/,
      ],
      [
        "attachment oversized file",
        { f_attachment: [{ ...ATTACH_PNG, size: 11 * 1024 * 1024 }] },
        /larger than/,
      ],
    ];

    it.each(cases)("rejects a bad %s", async (_label, fields, pattern) => {
      await expect(
        client.bases.createChangeRequest({ baseId, fields, submittedBy: "agent" }),
      ).rejects.toThrow(pattern);
    });
  });

  describe("updates round-trip every editable field type", () => {
    // Create with one set of valid values, then change ALL user fields in a single
    // update CR and confirm each new value is what got persisted (not just f_text).
    const updatedValues = (): Record<string, unknown> => ({
      f_text: "updated text",
      f_longtext: "an updated longer body",
      f_markdown: "## updated",
      f_html: "<i>updated</i>",
      f_code: "const y = 2;",
      f_number: -7.5,
      f_checkbox: false, // falsy-but-present must survive the round-trip
      f_date: "2027-01-15T00:00:00.000Z",
      f_email: "updated@example.com",
      f_url: "https://updated.example.com",
      f_phone: "+44 20 7946 0000",
      f_select: "Closed",
      f_multiselect: ["beta"],
      f_relation: [relatedRecordId],
      f_attachment: [ATTACH_MD], // replaced the two-file set with one
      f_ai_summary: "an updated summary",
      f_ai_tags: ["updated"],
    });

    it("persists each updated user field through the update → merge loop", async () => {
      const recordId = await createRecord(validValues());
      const updateCr = await client.records.updateChangeRequest({
        recordId,
        fields: updatedValues(),
        author: "editor",
      });
      await client.changeRequests.review({ changeRequestId: updateCr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: updateCr.id });

      const stored = await readFields(recordId);
      for (const [slug, value] of Object.entries(updatedValues())) {
        expect(stored[slug], `field ${slug}`).toEqual(value);
      }
    });
  });

  it("rejects a change request that omits a required field", async () => {
    // ft-related's `title` is required; an empty submission is rejected at creation.
    const related = await client.bases.create({
      slug: "ft-required",
      name: "Required",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
    });
    await expect(
      client.bases.createChangeRequest({ baseId: related.id, fields: {}, submittedBy: "agent" }),
    ).rejects.toThrow(/is required/);
  });

  it("stores only the fields supplied; system fields are still computed", async () => {
    const recordId = await createRecord({ f_text: "sparse" });
    const stored = await readFields(recordId);
    expect(stored.f_text).toBe("sparse");
    expect(stored.f_number).toBeUndefined(); // omitted optional → not invented
    expect(typeof stored.created_at).toBe("string"); // system fields always present
    expect(stored.created_by).toBe("agent");
    expect(typeof stored.seq).toBe("number");
  });

  it("projects field values to the searchable index after merge", async () => {
    const marker = "needle-zxcv-9182";
    const recordId = await createRecord({ f_text: marker });
    const hits = await client.records.search({ baseId, fieldSlug: "f_text", valueText: marker });
    expect(hits.some((r) => r.id === recordId)).toBe(true);
    expect(hits.every((r) => r.headCommit.fields.f_text === marker)).toBe(true);
  });

  it("accepts a relation given as a single id string, not just an array", async () => {
    const recordId = await createRecord({ f_text: "single-rel", f_relation: relatedRecordId });
    expect((await readFields(recordId)).f_relation).toEqual(relatedRecordId);
  });
});
