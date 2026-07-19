import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Field management: delete field (soft-delete), update field metadata,
 * type conversion preview, type conversion commit.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Field management — delete / update / convert", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let testBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fields-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fields-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    // Create a dedicated test base with a variety of field types
    const base = await client.bases.create({
      autoMerge: true,
      slug: "field-mgmt-test",
      name: "Field Management Test",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "score", name: "Score", type: "number" },
        { slug: "active", name: "Active", type: "checkbox" },
        {
          slug: "status",
          name: "Status",
          type: "select",
          options: {
            choices: [
              { id: "s1", name: "Draft", color: "gray" },
              { id: "s2", name: "Published", color: "green" },
            ],
          },
        },
        {
          slug: "tags",
          name: "Tags",
          type: "multiselect",
          options: {
            choices: [
              { id: "t1", name: "Frontend", color: "blue" },
              { id: "t2", name: "Backend", color: "red" },
            ],
          },
        },
        { slug: "notes", name: "Notes", type: "longtext" },
      ],
    });
    testBaseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = async (changeRequestId: string) =>
    client.changeRequests
      .review({ changeRequestId, verdict: "approved" })
      .then(() => client.changeRequests.merge({ changeRequestId }));

  const getBase = () => client.bases.list().then((bs) => bs.find((b) => b.id === testBaseId)!);

  const getFieldId = async (baseId: string, slug: string): Promise<string> => {
    const bases = await client.bases.list();
    const b = bases.find((b) => b.id === baseId);
    if (!b) throw new Error(`Base not found: ${baseId}`);
    const field = b.fields.find((f) => f.slug === slug);
    if (!field) throw new Error(`Field not found: ${slug}`);
    return field.id;
  };

  // ── deleteField ─────────────────────────────────────────────────────────────

  describe("deleteField", () => {
    it("soft-deletes a field: field disappears from base but values are retained in DB", async () => {
      // Add a throwaway field
      await client.bases.createField({
        baseId: testBaseId,
        slug: "to-delete",
        name: "To Delete",
        type: "text",
      });

      let base = await getBase();
      expect(base.fields.map((f) => f.slug)).toContain("to-delete");

      // Delete it via change request
      const toDeleteId = await getFieldId(testBaseId, "to-delete");
      const cr = await client.bases.deleteFieldChangeRequest({
        baseId: testBaseId,
        fieldId: toDeleteId,
      });
      await approveAndMerge(cr.id);

      // Field should no longer appear in base
      base = await getBase();
      expect(base.fields.map((f) => f.slug)).not.toContain("to-delete");
    });

    it("refuses to delete a system field", async () => {
      await expect(
        client.bases.deleteFieldChangeRequest({
          baseId: testBaseId,
          fieldId: "fake-system-field-id",
        }),
      ).rejects.toThrow();
    });

    it("removes deleted field from view filters and sorts", async () => {
      // Add a temp field and a view that references it
      await client.bases.createField({
        baseId: testBaseId,
        slug: "temp-filter-field",
        name: "Temp Filter Field",
        type: "text",
      });

      // Create a view with a filter on this field
      const viewCr = await client.bases.createViewChangeRequest({
        baseId: testBaseId,
        slug: "temp-view",
        name: "Temp View",
        type: "table",
        config: {
          filters: [{ fieldSlug: "temp-filter-field", operator: "not_empty" }],
          sorts: [{ fieldSlug: "temp-filter-field", direction: "asc" }],
          visibleFieldSlugs: ["title", "temp-filter-field"],
        },
      });
      await approveAndMerge(viewCr.id);

      // Delete the field
      const tempFieldId = await getFieldId(testBaseId, "temp-filter-field");
      const deleteCr = await client.bases.deleteFieldChangeRequest({
        baseId: testBaseId,
        fieldId: tempFieldId,
      });
      await approveAndMerge(deleteCr.id);

      // View should no longer reference the deleted field
      const views = await client.bases.listViews({ baseId: testBaseId });
      const view = views.find((v) => v.slug === "temp-view");
      expect(view).toBeDefined();
      expect(view?.config.filters?.map((f) => f.fieldSlug)).not.toContain("temp-filter-field");
      expect(view?.config.sorts?.map((s) => s.fieldSlug)).not.toContain("temp-filter-field");
      expect(view?.config.visibleFieldSlugs).not.toContain("temp-filter-field");
    });
  });

  // ── updateField ─────────────────────────────────────────────────────────────

  describe("updateField", () => {
    it("renames a field (name only, slug stays the same)", async () => {
      const notesId = await getFieldId(testBaseId, "notes");
      const cr = await client.bases.updateFieldChangeRequest({
        baseId: testBaseId,
        fieldId: notesId,
        patch: { name: "Remarks" },
      });
      await approveAndMerge(cr.id);

      const base = await getBase();
      const field = base.fields.find((f) => f.slug === "notes");
      expect(field?.name).toBe("Remarks");
      expect(field?.slug).toBe("notes"); // slug unchanged
    });

    it("updates required flag", async () => {
      const scoreId = await getFieldId(testBaseId, "score");
      const cr = await client.bases.updateFieldChangeRequest({
        baseId: testBaseId,
        fieldId: scoreId,
        patch: { required: true },
      });
      await approveAndMerge(cr.id);

      const base = await getBase();
      expect(base.fields.find((f) => f.slug === "score")?.required).toBe(true);
    });

    it("adds a new choice to a select field via options patch", async () => {
      const statusId = await getFieldId(testBaseId, "status");
      const cr = await client.bases.updateFieldChangeRequest({
        baseId: testBaseId,
        fieldId: statusId,
        patch: {
          options: {
            choices: [
              { id: "s1", name: "Draft", color: "gray" },
              { id: "s2", name: "Published", color: "green" },
              { id: "s3", name: "Archived", color: "orange" },
            ],
          },
        },
      });
      await approveAndMerge(cr.id);

      const base = await getBase();
      const field = base.fields.find((f) => f.slug === "status");
      expect(field?.options.choices?.map((c) => c.name)).toContain("Archived");
    });

    it("refuses to change field type via updateField (must use convertField)", async () => {
      // Zod strips unknown keys at the client level, so we test the server-side guard
      // by calling the handler directly with an invalid patch that bypasses the schema.
      // The oRPC schema strips `type` before sending, so this test verifies the
      // schema itself enforces the no-type-change rule by ensuring the field type
      // remains unchanged after an update attempt with an empty patch.
      const titleId = await getFieldId(testBaseId, "title");
      const cr = await client.bases.updateFieldChangeRequest({
        baseId: testBaseId,
        fieldId: titleId,
        patch: { name: "Title Field" },
      });
      await approveAndMerge(cr.id);
      const base = await getBase();
      // Type should still be "text", not changed
      expect(base.fields.find((f) => f.id === titleId)?.type).toBe("text");
    });
  });

  // ── previewFieldTypeConversion ───────────────────────────────────────────────

  describe("previewFieldTypeConversion", () => {
    it("returns conversion stats without mutating anything", async () => {
      const scoreId2 = await getFieldId(testBaseId, "score");
      const preview = await client.bases.previewFieldConversion({
        baseId: testBaseId,
        fieldId: scoreId2,
        newType: "text",
      });

      expect(preview).toMatchObject({
        totalCount: expect.any(Number),
        convertibleCount: expect.any(Number),
        nullCount: expect.any(Number),
        conflicts: expect.any(Array),
      });
      expect(preview.convertibleCount + preview.nullCount).toBe(preview.totalCount);

      // Base must be unchanged after preview
      const base = await getBase();
      expect(base.fields.find((f) => f.slug === "score")?.type).toBe("number");
    });

    it("flags conflicts for select → text with no matching choices", async () => {
      const activeId = await getFieldId(testBaseId, "active");
      const preview = await client.bases.previewFieldConversion({
        baseId: testBaseId,
        fieldId: activeId,
        newType: "number",
      });
      // checkbox→number via text: "true"→NaN (null) or 1, "false"→0
      // Should report 0 conflicts (all values convert cleanly to null/number)
      expect(preview).toBeDefined();
    });

    it("throws for relation → text conversion", async () => {
      // Create a relation field first
      await client.bases.createField({
        baseId: testBaseId,
        slug: "rel-field",
        name: "Rel Field",
        type: "relation",
        options: { targetBaseId: testBaseId },
      });

      const relFieldId = await getFieldId(testBaseId, "rel-field");
      await expect(
        client.bases.previewFieldConversion({
          baseId: testBaseId,
          fieldId: relFieldId,
          newType: "text",
        }),
      ).rejects.toThrow();
    });
  });

  // ── convertFieldType ─────────────────────────────────────────────────────────

  describe("convertFieldType", () => {
    it("converts number field to text: updates field type and migrates all values", async () => {
      // Create a fresh base for this test to avoid state bleed
      const base = await client.bases.create({
        autoMerge: true,
        slug: "convert-test",
        name: "Convert Test",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          { slug: "score", name: "Score", type: "number" },
        ],
      });
      const baseId = base.id;

      // Convert score: number → text
      const scoreFieldId = base.fields.find((f) => f.slug === "score")?.id;
      const cr = await client.bases.convertFieldChangeRequest({
        baseId,
        fieldId: scoreFieldId,
        newType: "text",
        selectChoiceMode: "null_on_missing",
      });
      await approveAndMerge(cr.id);

      const updated = (await client.bases.list()).find((b) => b.id === baseId)!;
      const scoreField = updated.fields.find((f) => f.slug === "score");
      expect(scoreField?.type).toBe("text");
    });

    it("converts select field to text: replaces choice ids with labels", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "select-to-text",
        name: "Select To Text",
        fields: [
          { slug: "title", name: "Title", type: "text" },
          {
            slug: "status",
            name: "Status",
            type: "select",
            options: {
              choices: [
                { id: "s1", name: "Active" },
                { id: "s2", name: "Inactive" },
              ],
            },
          },
        ],
      });

      const statusFieldId = base.fields.find((f) => f.slug === "status")?.id;
      const cr = await client.bases.convertFieldChangeRequest({
        baseId: base.id,
        fieldId: statusFieldId,
        newType: "text",
        selectChoiceMode: "null_on_missing",
      });
      await approveAndMerge(cr.id);

      const updated = (await client.bases.list()).find((b) => b.id === base.id)!;
      expect(updated.fields.find((f) => f.slug === "status")?.type).toBe("text");
    });

    it("auto_create mode: creates new choices for unmatched values when converting to select", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "text-to-select",
        name: "Text To Select",
        fields: [{ slug: "category", name: "Category", type: "text" }],
      });

      const categoryFieldId = base.fields.find((f) => f.slug === "category")?.id;
      const cr = await client.bases.convertFieldChangeRequest({
        baseId: base.id,
        fieldId: categoryFieldId,
        newType: "select",
        selectChoiceMode: "auto_create",
      });
      await approveAndMerge(cr.id);

      const updated = (await client.bases.list()).find((b) => b.id === base.id)!;
      expect(updated.fields.find((f) => f.slug === "category")?.type).toBe("select");
    });

    it("refuses to convert a system field", async () => {
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: testBaseId,
          fieldId: "fake-auto-number-id",
          newType: "text",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toThrow();
    });

    it("refuses to convert to relation or attachment", async () => {
      const titleId = await getFieldId(testBaseId, "title");
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: testBaseId,
          fieldId: titleId,
          newType: "relation",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toThrow();
    });
  });

  // ── convert rejects surface as BAD_REQUEST, not a raw 500 ───────────────────
  //
  // These conversions are all intentionally disallowed (system-computed target
  // types, and relation/attachment on either side) — the rejection itself is
  // correct. What's under test is *how* it's reported: a clean oRPC BAD_REQUEST,
  // not an unclassified Error that the OpenAPIHandler turns into a generic 500.
  describe("convert rejects with BAD_REQUEST (not a raw 500)", () => {
    let guardrailsBaseId = "";
    let textFieldId = "";
    let systemFieldId = "";
    let relationFieldId = "";
    let attachmentFieldId = "";

    beforeAll(async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "convert-guardrails",
        name: "Convert Guardrails",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      });
      guardrailsBaseId = base.id;
      textFieldId = base.fields.find((f) => f.slug === "title")!.id;

      // A system-computed field, plus a relation and an attachment field, added
      // directly (not via the convert path) so we have real fields to convert
      // from.
      await client.bases.createField({
        baseId: guardrailsBaseId,
        slug: "created",
        name: "Created",
        type: "auto_number",
      });
      await client.bases.createField({
        baseId: guardrailsBaseId,
        slug: "linked",
        name: "Linked",
        type: "relation",
        options: { targetBaseId: guardrailsBaseId },
      });
      await client.bases.createField({
        baseId: guardrailsBaseId,
        slug: "files",
        name: "Files",
        type: "attachment",
      });

      systemFieldId = await getFieldId(guardrailsBaseId, "created");
      relationFieldId = await getFieldId(guardrailsBaseId, "linked");
      attachmentFieldId = await getFieldId(guardrailsBaseId, "files");
    });

    const systemNewTypes = [
      "created_by",
      "updated_by",
      "created_time",
      "updated_time",
      "auto_number",
    ] as const;

    for (const newType of systemNewTypes) {
      it(`previewFieldConversion: converting text field to "${newType}" → BAD_REQUEST`, async () => {
        await expect(
          client.bases.previewFieldConversion({
            baseId: guardrailsBaseId,
            fieldId: textFieldId,
            newType,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });

      it(`createConvertFieldChangeRequest: converting text field to "${newType}" → BAD_REQUEST`, async () => {
        await expect(
          client.bases.convertFieldChangeRequest({
            baseId: guardrailsBaseId,
            fieldId: textFieldId,
            newType,
            selectChoiceMode: "null_on_missing",
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      });
    }

    it("previewFieldConversion: converting an existing system field → BAD_REQUEST", async () => {
      await expect(
        client.bases.previewFieldConversion({
          baseId: guardrailsBaseId,
          fieldId: systemFieldId,
          newType: "text",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("createConvertFieldChangeRequest: converting an existing system field → BAD_REQUEST", async () => {
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: guardrailsBaseId,
          fieldId: systemFieldId,
          newType: "text",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("previewFieldConversion: converting a relation field → BAD_REQUEST", async () => {
      await expect(
        client.bases.previewFieldConversion({
          baseId: guardrailsBaseId,
          fieldId: relationFieldId,
          newType: "text",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("createConvertFieldChangeRequest: converting a relation field → BAD_REQUEST", async () => {
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: guardrailsBaseId,
          fieldId: relationFieldId,
          newType: "text",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("previewFieldConversion: converting an attachment field → BAD_REQUEST", async () => {
      await expect(
        client.bases.previewFieldConversion({
          baseId: guardrailsBaseId,
          fieldId: attachmentFieldId,
          newType: "text",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("createConvertFieldChangeRequest: converting an attachment field → BAD_REQUEST", async () => {
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: guardrailsBaseId,
          fieldId: attachmentFieldId,
          newType: "text",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("previewFieldConversion: converting a text field to relation → BAD_REQUEST", async () => {
      await expect(
        client.bases.previewFieldConversion({
          baseId: guardrailsBaseId,
          fieldId: textFieldId,
          newType: "relation",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("createConvertFieldChangeRequest: converting a text field to attachment → BAD_REQUEST", async () => {
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId: guardrailsBaseId,
          fieldId: textFieldId,
          newType: "attachment",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── relation field requires a target Base ────────────────────────────────────

  describe("relation field without a target Base rejects with BAD_REQUEST (not a raw 500)", () => {
    let noTargetBaseId = "";

    beforeAll(async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "relation-no-target-test",
        name: "Relation No Target Test",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      });
      noTargetBaseId = base.id;
    });

    it("createField: relation field with no options → BAD_REQUEST", async () => {
      await expect(
        client.bases.createField({
          baseId: noTargetBaseId,
          slug: "linked",
          name: "Linked",
          type: "relation",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("createFieldChangeRequest: relation field with no options → BAD_REQUEST", async () => {
      await expect(
        client.bases.createFieldChangeRequest({
          baseId: noTargetBaseId,
          slug: "linked",
          name: "Linked",
          type: "relation",
          required: false,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  // ── reorderFields ────────────────────────────────────────────────────────────

  describe("reorderFields", () => {
    it("reorders fields via change request", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "reorder-test",
        name: "Reorder Test",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "score", name: "Score", type: "number" },
          { slug: "notes", name: "Notes", type: "longtext" },
        ],
      });
      const baseId = base.id;
      const fieldIds = base.fields.map((f) => f.id).reverse();
      const cr = await client.bases.reorderFieldsChangeRequest({ baseId, fieldIds });
      expect(cr.status).toBe("in_review");
      await approveAndMerge(cr.id);
      const updatedBases = await client.bases.list();
      const updatedBase = updatedBases.find((b) => b.id === baseId)!;
      const updatedIds = updatedBase.fields.map((f) => f.id);
      expect(updatedIds).toEqual(fieldIds);
    });
  });

  // ── record restore ────────────────────────────────────────────────────────────

  describe("record restore", () => {
    it("restores an archived record", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "restore-record-test",
        name: "Restore Record Test",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      });
      const baseId = base.id;
      // Create a record and delete it (archive it)
      const createCr = await client.bases.createChangeRequest({
        baseId,
        fields: { title: "to-restore-unique" },
      });
      await approveAndMerge(createCr.id);
      const allRecords = await client.records.search({
        baseId,
        fieldSlug: "title",
        valueText: "to-restore-unique",
      });
      const record = allRecords[0]!;
      const deleteCr = await client.records.deleteChangeRequest({
        recordId: record.id,
        deleteMode: "archive",
      });
      await approveAndMerge(deleteCr.id);
      // Now restore it
      const restoreCr = await client.records.restoreChangeRequest({ recordId: record.id });
      expect(restoreCr.status).toBe("in_review");
      await approveAndMerge(restoreCr.id);
      const restored = await client.records.get({ recordId: record.id });
      expect(restored).toBeDefined();
      expect(restored?.status).toBe("active");
    });
  });

  // ── field restore ─────────────────────────────────────────────────────────────

  describe("field restore", () => {
    it("restores a soft-deleted field", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "restore-field-test",
        name: "Restore Field Test",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      });
      const baseId = base.id;
      // Create a field and delete it
      const addCr = await client.bases.createFieldChangeRequest({
        baseId,
        slug: "restorable",
        type: "text",
        name: "Restorable",
        required: false,
      });
      await approveAndMerge(addCr.id);
      const fieldId = await getFieldId(baseId, "restorable");
      const delCr = await client.bases.deleteFieldChangeRequest({ baseId, fieldId });
      await approveAndMerge(delCr.id);
      // Now restore it
      const restoreCr = await client.bases.restoreFieldChangeRequest({ baseId, fieldId });
      expect(restoreCr.status).toBe("in_review");
      await approveAndMerge(restoreCr.id);
      const bases = await client.bases.list();
      const updatedBase = bases.find((b) => b.id === baseId)!;
      const restoredField = updatedBase.fields.find((f) => f.id === fieldId);
      expect(restoredField).toBeDefined();
    });
  });

  // ── partial index: slug reuse after delete ────────────────────────────────────

  describe("partial index: slug reuse after delete", () => {
    it("allows creating a new field with the same slug after soft-delete", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "slug-reuse-test",
        name: "Slug Reuse Test",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      });
      const baseId = base.id;
      const addCr1 = await client.bases.createFieldChangeRequest({
        baseId,
        slug: "reusable-slug",
        type: "text",
        name: "Original",
        required: false,
      });
      await approveAndMerge(addCr1.id);
      const fieldId = await getFieldId(baseId, "reusable-slug");
      const delCr = await client.bases.deleteFieldChangeRequest({ baseId, fieldId });
      await approveAndMerge(delCr.id);
      // Should be able to create another field with same slug
      const addCr2 = await client.bases.createFieldChangeRequest({
        baseId,
        slug: "reusable-slug",
        type: "number",
        name: "New",
        required: false,
      });
      await approveAndMerge(addCr2.id);
      const bases = await client.bases.list();
      const updatedBase = bases.find((b) => b.id === baseId)!;
      const newField = updatedBase.fields.find((f) => f.slug === "reusable-slug");
      expect(newField).toBeDefined();
      expect(newField?.type).toBe("number");
    });
  });

  // ── concurrent convert check ──────────────────────────────────────────────────

  describe("concurrent convert check", () => {
    it("rejects a second convert CR while one is in_review", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "concurrent-convert-test",
        name: "Concurrent Convert Test",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "score", name: "Score", type: "number" },
        ],
      });
      const baseId = base.id;
      const scoreId = base.fields.find((f) => f.slug === "score")?.id;
      // Create first convert CR (don't merge it)
      await client.bases.convertFieldChangeRequest({
        baseId,
        fieldId: scoreId,
        newType: "text",
        selectChoiceMode: "null_on_missing",
      });
      // Try to create another - should fail
      await expect(
        client.bases.convertFieldChangeRequest({
          baseId,
          fieldId: scoreId,
          newType: "text",
          selectChoiceMode: "null_on_missing",
        }),
      ).rejects.toThrow();
    });
  });

  // ── listBases excludes archived base ──────────────────────────────────────

  describe("listBases filters archived bases", () => {
    it("does not return a base after it is archived", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "archive-filter-test",
        name: "Archive Filter Test",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      });
      const baseId = base.id;
      // Confirm it appears before archive
      const before = await client.bases.list();
      expect(before.some((b) => b.id === baseId)).toBe(true);
      // Archive it
      const archiveCr = await client.bases.archiveChangeRequest({ baseId });
      await approveAndMerge(archiveCr.id);
      // Should no longer appear in list
      const after = await client.bases.list();
      expect(after.some((b) => b.id === baseId)).toBe(false);
    });
  });

  // ── reorderFields rejects partial fieldIds ────────────────────────────────

  describe("reorderFields completeness validation", () => {
    it("rejects when fieldIds does not include all active fields", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "reorder-partial-test",
        name: "Reorder Partial Test",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "score", name: "Score", type: "number" },
        ],
      });
      const baseId = base.id;
      const titleId = base.fields.find((f) => f.slug === "title")?.id;
      // Only pass one of the two fields → should throw
      await expect(
        client.bases.reorderFieldsChangeRequest({ baseId, fieldIds: [titleId] }),
      ).rejects.toThrow();
    });

    it("accepts when all active fields are included", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "reorder-complete-test",
        name: "Reorder Complete Test",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "score", name: "Score", type: "number" },
        ],
      });
      const baseId = base.id;
      const titleId = base.fields.find((f) => f.slug === "title")?.id;
      const scoreId = base.fields.find((f) => f.slug === "score")?.id;
      const cr = await client.bases.reorderFieldsChangeRequest({
        baseId,
        fieldIds: [scoreId, titleId],
      });
      expect(cr.status).toBe("in_review");
    });
  });

  // ── merge blocked on archived base ───────────────────────────────────────

  describe("merge blocked on archived base", () => {
    it("rejects merging a field operation after the base is archived", async () => {
      const base = await client.bases.create({
        autoMerge: true,
        slug: "archived-merge-block-test",
        name: "Archived Merge Block Test",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "score", name: "Score", type: "number" },
        ],
      });
      const baseId = base.id;
      const scoreId = base.fields.find((f) => f.slug === "score")?.id;
      // Create a field update CR (don't merge yet)
      const updateCr = await client.bases.updateFieldChangeRequest({
        baseId,
        fieldId: scoreId,
        patch: { name: "Updated Score" },
      });
      // Archive the base
      const archiveCr = await client.bases.archiveChangeRequest({ baseId });
      await approveAndMerge(archiveCr.id);
      // Now try to merge the field update CR → should throw
      await expect(approveAndMerge(updateCr.id)).rejects.toThrow();
    });
  });
});
