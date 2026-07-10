import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Field-type functionality driven through the PUBLIC OpenAPI REST surface
 * (`/api/v1`) instead of the in-process `createRouterClient` used by
 * field-types.test.ts. This exercises the layer createRouterClient SKIPS — HTTP
 * method + path routing, path/query-param coercion, JSON body decoding, and VO
 * JSON serialization — for every field type, using the exact OpenAPIHandler the
 * app mounts at app/api/v1/[[...rest]]/route.ts.
 *
 * Every field is asserted to survive a REST round-trip with its JSON type intact
 * (number stays number, checkbox stays boolean, arrays stay arrays), and bad
 * values are rejected with an HTTP 400 at the REST boundary.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
// The contract carries a global `oc.prefix("/api/v1")`, so the handler matches
// full `/api/v1/...` paths — the same URLs the Next.js route receives.
const API = "http://localhost/api/v1";

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

/** A synthetic inline attachment ref — `attachmentId` is a loose text ref (not an
 *  FK), so the merge's ensureAsset registers it without a real upload. */
const attachmentRef = (over: Record<string, unknown> = {}) => ({
  id: "att_seed_png",
  url: "https://cdn.example.com/x.png",
  fileName: "x.png",
  mimeType: "image/png",
  size: 142_336,
  ...over,
});

describe("Base field types — OpenAPI (/api/v1) route round-trip", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let handler: OpenAPIHandler<Record<never, never>>;
  let baseId = "";
  let relatedRecordId = "";

  /** Drive one REST call through the OpenAPIHandler; returns status + parsed JSON. */
  const call = async (
    method: string,
    routePath: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }> => {
    const request = new Request(`${API}${routePath}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await handler.handle(request, { context: {} });
    if (!result.matched) {
      throw new Error(`no OpenAPI route matched ${method} ${routePath}`);
    }
    return { status: result.response.status, body: await result.response.json() };
  };

  const ok = async (method: string, routePath: string, body?: unknown): Promise<any> => {
    const res = await call(method, routePath, body);
    if (res.status >= 400) {
      throw new Error(`${method} ${routePath} → ${res.status}: ${JSON.stringify(res.body)}`);
    }
    return res.body;
  };

  /** create-CR → approve → merge; returns the merged record id. */
  const createRecord = async (fields: Record<string, unknown>): Promise<string> => {
    const cr = await ok("POST", `/bases/${baseId}/change-requests`, {
      fields,
      submittedBy: "agent",
    });
    await ok("POST", `/change-requests/${cr.id}/reviews`, { verdict: "approved" });
    const merged = await ok("POST", `/change-requests/${cr.id}/merge`);
    if (!merged.record?.id) throw new Error("expected a merged record");
    return merged.record.id;
  };

  const readFields = async (recordId: string): Promise<Record<string, unknown>> => {
    const record = await ok("GET", `/records/${recordId}`);
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
    f_embed: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    f_phone: "+1 555-123-4567",
    f_select: "Open",
    f_multiselect: ["alpha", "beta"],
    f_relation: [relatedRecordId],
    f_attachment: [
      attachmentRef(),
      attachmentRef({
        id: "att_seed_md",
        fileName: "notes.md",
        mimeType: "text/markdown",
        size: 4_096,
      }),
    ],
    f_ai_summary: "a summary",
    f_ai_tags: ["x", "y"],
  });

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-ft-openapi-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-ft-openapi-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    handler = new OpenAPIHandler(busabaseRouter);

    // A base for relation fields to point at, plus one record to link to.
    const related = await ok("POST", "/bases", {
      slug: "ftapi-related",
      name: "Related",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    const relCr = await ok("POST", `/bases/${related.id}/change-requests`, {
      fields: { title: "linked" },
      submittedBy: "agent",
    });
    await ok("POST", `/change-requests/${relCr.id}/reviews`, { verdict: "approved" });
    const relMerged = await ok("POST", `/change-requests/${relCr.id}/merge`);
    relatedRecordId = relMerged.record?.id ?? "";

    const base = await ok("POST", "/bases", {
      slug: "ftapi-everything",
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
        { slug: "f_embed", name: "Embed", type: "embed" },
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
      autoMerge: true,
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

  describe("round-trips every field type through REST (types preserved)", () => {
    let stored: Record<string, unknown> = {};

    beforeAll(async () => {
      stored = await readFields(await createRecord(validValues()));
    });

    it("round-trips every user-supplied field value with its JSON type intact", () => {
      for (const [slug, value] of Object.entries(validValues())) {
        expect(stored[slug], `field ${slug}`).toEqual(value);
      }
    });

    it("keeps number a number and checkbox a boolean across JSON (de)serialization", () => {
      expect(typeof stored.f_number).toBe("number");
      expect(stored.f_number).toBe(42);
      expect(typeof stored.f_checkbox).toBe("boolean");
      expect(stored.f_checkbox).toBe(true);
    });

    it("returns the attachment cell as an array of refs", () => {
      expect(Array.isArray(stored.f_attachment)).toBe(true);
      expect(stored.f_attachment).toHaveLength(2);
      expect((stored.f_attachment as any[])[0]).toMatchObject({ mimeType: "image/png" });
    });

    it("server-computes system fields (auto_number, created_by, timestamps)", () => {
      expect(stored.seq).toBe(1);
      expect(stored.created_by).toBe("agent");
      expect(typeof stored.created_at).toBe("string");
      expect(Number.isNaN(new Date(stored.created_at as string).getTime())).toBe(false);
    });
  });

  describe("relation accepts both a single id and an array over REST", () => {
    it("stores a single id string unchanged", async () => {
      const id = await createRecord({ f_text: "single", f_relation: relatedRecordId });
      expect((await readFields(id)).f_relation).toEqual(relatedRecordId);
    });
    it("stores an id array unchanged", async () => {
      const id = await createRecord({ f_text: "array", f_relation: [relatedRecordId] });
      expect((await readFields(id)).f_relation).toEqual([relatedRecordId]);
    });
  });

  describe("AI fields round-trip over REST", () => {
    it("stores ai_summary text and ai_tags array", async () => {
      const id = await createRecord({
        f_text: "ai",
        f_ai_summary: "generated summary",
        f_ai_tags: ["alpha", "beta", "gamma"],
      });
      const stored = await readFields(id);
      expect(stored.f_ai_summary).toBe("generated summary");
      expect(stored.f_ai_tags).toEqual(["alpha", "beta", "gamma"]);
    });
  });

  describe("rejects invalid values with HTTP 400 at the REST boundary", () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["number", { f_number: "abc" }, /must be a number/],
      ["email", { f_email: "not-an-email" }, /valid email/],
      ["embed", { f_embed: "not a url" }, /embeddable/],
      ["checkbox", { f_checkbox: "yes" }, /true or false/],
      ["json", { f_json: "{bad json" }, /valid JSON/],
      ["yaml", { f_yaml: "bad: [" }, /valid YAML/],
      ["select outside choices", { f_select: "Nope" }, /one of its options/],
      ["relation as number", { f_relation: 42 }, /record id/],
      ["attachment not an array", { f_attachment: attachmentRef() }, /list of attachments/],
      ["attachment malformed ref", { f_attachment: [{ url: "x" }] }, /invalid attachment/],
      [
        "attachment too many files",
        {
          f_attachment: [attachmentRef(), attachmentRef({ id: "a2" }), attachmentRef({ id: "a3" })],
        },
        /at most 2 files/,
      ],
      [
        "attachment disallowed mime",
        { f_attachment: [attachmentRef({ mimeType: "application/pdf" })] },
        /does not allow files of type/,
      ],
      [
        "attachment oversized file",
        { f_attachment: [attachmentRef({ size: 11 * 1024 * 1024 })] },
        /larger than/,
      ],
    ];

    it.each(cases)("rejects a bad %s (400)", async (_label, fields, pattern) => {
      const res = await call("POST", `/bases/${baseId}/change-requests`, {
        fields: { f_text: "x", ...fields },
        submittedBy: "agent",
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(pattern);
    });
  });

  it("search endpoint (GET /records/search) finds a record by field text", async () => {
    const marker = "openapi-needle-7781";
    const recordId = await createRecord({ f_text: marker });
    const hits = await ok(
      "GET",
      `/records/search?baseId=${baseId}&fieldSlug=f_text&valueText=${marker}`,
    );
    expect(Array.isArray(hits)).toBe(true);
    expect(hits.some((r: any) => r.id === recordId)).toBe(true);
  });
});
