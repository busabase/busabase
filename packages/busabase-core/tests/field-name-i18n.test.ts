import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import {
  iStringFromText,
  iStringIsEmpty,
  iStringParse,
  iStringToText,
  iStringTrim,
} from "openlib/i18n/i-string";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateRecordFields } from "../src/domains/base/field-rules";
import { fieldDisplayName } from "../src/domains/base/field-types";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const COMPANY_NAME = { en: "Company", "zh-CN": "公司", ja: "会社" } as const;

describe("iString text-column codec", () => {
  it("passes plain strings through unchanged", () => {
    expect(iStringToText("Company")).toBe("Company");
    expect(iStringFromText("Company")).toBe("Company");
  });

  it("round-trips locale records via JSON", () => {
    const encoded = iStringToText(COMPANY_NAME);
    expect(typeof encoded).toBe("string");
    expect(iStringFromText(encoded)).toEqual(COMPANY_NAME);
  });

  it("treats non-record JSON text as a plain string", () => {
    expect(iStringFromText("[1,2]")).toBe("[1,2]");
    expect(iStringFromText('{"nope":1}')).toBe('{"nope":1}');
  });

  it("trims per locale and collapses empty records", () => {
    expect(iStringTrim({ en: "  Company ", "zh-CN": "  " })).toEqual({ en: "Company" });
    expect(iStringTrim({ en: "   " })).toBe("");
    expect(iStringIsEmpty({ en: " " })).toBe(true);
    expect(iStringIsEmpty(COMPANY_NAME)).toBe(false);
  });
});

describe("multilingual field names — validation messages", () => {
  it("resolves the record name in required errors instead of [object Object]", () => {
    const errors = validateRecordFields({}, [
      { slug: "company", name: COMPANY_NAME, type: "text", required: true },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("Company is required");
    expect(errors[0].message).not.toContain("[object Object]");
  });

  it("fieldDisplayName resolves per locale with fallback", () => {
    const def = { name: COMPANY_NAME };
    expect(fieldDisplayName(def, "zh-CN")).toBe("公司");
    expect(fieldDisplayName(def, "ja")).toBe("会社");
    // zh-TW is not present — falls back through the chain rather than blank.
    expect(fieldDisplayName(def, "zh-TW")).not.toBe("");
    expect(fieldDisplayName({ name: "Plain" }, "zh-CN")).toBe("Plain");
  });
});

describe("multilingual field names — end-to-end", () => {
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-iname-db-"));
    const storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-iname-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
  });

  it("stores a locale-record field name and returns it intact in the VO", async () => {
    const base = await client.bases.create({
      slug: "iname-e2e",
      name: "iName",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "company", name: COMPANY_NAME, type: "text" },
      ],
      autoMerge: true,
    });
    const company = base.fields.find((field) => field.slug === "company");
    expect(company?.name).toEqual(COMPANY_NAME);
    // Plain-string names stay plain strings.
    const title = base.fields.find((field) => field.slug === "title");
    expect(title?.name).toBe("Title");
  }, 60_000);

  it("adds a field with a record name via createField and reads it back", async () => {
    const base = await client.bases.create({
      slug: "iname-add",
      name: "iName Add",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    const updated = await client.bases.createField({
      baseId: base.id,
      name: { en: "Owner", "zh-CN": "负责人" },
      slug: "owner",
      type: "text",
    });
    const owner = updated.fields.find((field) => field.slug === "owner");
    expect(owner?.name).toEqual({ en: "Owner", "zh-CN": "负责人" });
    expect(iStringParse(owner?.name ?? "", "zh-CN")).toBe("负责人");
  }, 60_000);

  it("renames a field to a record name via update change request → merge", async () => {
    const base = await client.bases.create({
      slug: "iname-rename",
      name: "iName Rename",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "stage", name: "Stage", type: "text" },
      ],
      autoMerge: true,
    });
    const stage = base.fields.find((field) => field.slug === "stage");
    expect(stage).toBeDefined();
    if (!stage) throw new Error("stage field missing");

    const NEW_NAME = { en: "Stage", "zh-CN": "阶段", ja: "ステージ" };
    const cr = await client.bases.updateFieldChangeRequest({
      baseId: base.id,
      fieldId: stage.id,
      patch: { name: NEW_NAME },
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const bases = await client.bases.list();
    const renamed = bases
      .find((item) => item.id === base.id)
      ?.fields.find((field) => field.slug === "stage");
    expect(renamed?.name).toEqual(NEW_NAME);
    expect(iStringParse(renamed?.name ?? "", "zh-CN")).toBe("阶段");
  }, 60_000);
});
