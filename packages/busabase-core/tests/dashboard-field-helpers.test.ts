import { describe, expect, it } from "vitest";
import { FIELD_TYPE_ORDER } from "../src/domains/base/field-types";
import {
  CHOICE_BADGE_CLASS,
  createDefaultFieldOptions,
  fieldPreviewText,
  fieldTypeOptions,
  getAttachmentRefs,
  getChoiceBadgeClass,
  getChoiceLabel,
  getCodeFieldPreviewLanguage,
  getFieldChipEntries,
  getFieldName,
  getFieldPreviewText,
  getRecordFieldType,
  getRelationRecordIds,
  isRecordLongField,
  isRecordTitleField,
  normalizeCodeLanguage,
} from "../src/domains/dashboard/helpers/field";
import { safeFetchableUrl, sanitizeHtml } from "../src/domains/dashboard/helpers/html";

import type { BaseFieldVO, ChangeRequestVO, FieldType, RecordVO } from "../src/types";

// ── fixtures ─────────────────────────────────────────────────────────────────

const choices = [
  { id: "todo", name: "Todo", color: "slate" },
  { id: "done", name: "Done", color: "emerald" },
  { id: "nocolor", name: "No Color" },
];

const makeField = (overrides: Partial<BaseFieldVO> = {}): BaseFieldVO =>
  ({
    id: "fld_1",
    baseId: "bse_1",
    slug: "status",
    name: "Status",
    type: "select" as FieldType,
    required: false,
    position: 1,
    options: { choices },
    ...overrides,
  }) as BaseFieldVO;

// ── fieldTypeOptions ─────────────────────────────────────────────────────────

describe("fieldTypeOptions", () => {
  it("mirrors the registry picker order (single source of truth)", () => {
    expect(fieldTypeOptions).toEqual(FIELD_TYPE_ORDER);
  });
});

// ── createDefaultFieldOptions ────────────────────────────────────────────────

describe("createDefaultFieldOptions", () => {
  it("relation → multiple + targetBaseId", () => {
    expect(createDefaultFieldOptions("relation", "bse_target", true)).toEqual({
      multiple: true,
      targetBaseId: "bse_target",
    });
  });

  it("select / multiselect → seeded choices", () => {
    for (const type of ["select", "multiselect"] as FieldType[]) {
      const options = createDefaultFieldOptions(type, "bse_x", false);
      expect(options?.choices?.map((choice) => choice.id)).toEqual(["todo", "active", "done"]);
    }
  });

  it("ai_summary / ai_tags → ai config with review required", () => {
    for (const type of ["ai_summary", "ai_tags"] as FieldType[]) {
      const options = createDefaultFieldOptions(type, "bse_x", false);
      expect(options?.ai?.reviewRequired).toBe(true);
      expect(options?.ai?.sourceFieldIds).toEqual([]);
    }
  });

  it("plain types → undefined (no default options)", () => {
    for (const type of ["text", "number", "date", "checkbox", "url"] as FieldType[]) {
      expect(createDefaultFieldOptions(type, "bse_x", false)).toBeUndefined();
    }
  });
});

// ── getChoiceLabel ───────────────────────────────────────────────────────────

describe("getChoiceLabel", () => {
  it("resolves a choice id to its display name", () => {
    expect(getChoiceLabel(makeField(), "todo")).toBe("Todo");
  });

  it("falls back to the raw id when unknown", () => {
    expect(getChoiceLabel(makeField(), "mystery")).toBe("mystery");
  });

  it("non-string values → empty string", () => {
    expect(getChoiceLabel(makeField(), 42)).toBe("");
    expect(getChoiceLabel(makeField(), null)).toBe("");
  });
});

// ── getChoiceBadgeClass ──────────────────────────────────────────────────────

describe("getChoiceBadgeClass", () => {
  it("returns the mapped class for a known color", () => {
    expect(getChoiceBadgeClass("emerald")).toBe(CHOICE_BADGE_CLASS.emerald);
  });

  it("falls back to slate for unknown or missing colors", () => {
    expect(getChoiceBadgeClass("nonexistent")).toBe(CHOICE_BADGE_CLASS.slate);
    expect(getChoiceBadgeClass(undefined)).toBe(CHOICE_BADGE_CLASS.slate);
  });
});

// ── getFieldChipEntries ──────────────────────────────────────────────────────

describe("getFieldChipEntries", () => {
  it("select → single labelled chip with color", () => {
    expect(getFieldChipEntries(makeField(), "done")).toEqual([{ label: "Done", color: "emerald" }]);
  });

  it("select with unknown id → chip labelled by raw id", () => {
    expect(getFieldChipEntries(makeField(), "ghost")).toEqual([
      { label: "ghost", color: undefined },
    ]);
  });

  it("select with empty value → no chips", () => {
    expect(getFieldChipEntries(makeField(), "")).toEqual([]);
    expect(getFieldChipEntries(makeField(), 7)).toEqual([]);
  });

  it("multiselect → one chip per selected id, skipping non-strings", () => {
    const field = makeField({ type: "multiselect" });
    expect(getFieldChipEntries(field, ["todo", "", 3, "done"])).toEqual([
      { label: "Todo", color: "slate" },
      { label: "Done", color: "emerald" },
    ]);
  });

  it("ai_tags → plain chips without colors", () => {
    const field = makeField({ type: "ai_tags", options: {} as BaseFieldVO["options"] });
    expect(getFieldChipEntries(field, ["alpha", "beta"])).toEqual([
      { label: "alpha" },
      { label: "beta" },
    ]);
  });

  it("non-chip types → no chips", () => {
    expect(getFieldChipEntries(makeField({ type: "text" }), "hello")).toEqual([]);
    expect(getFieldChipEntries(makeField({ type: "multiselect" }), "not-an-array")).toEqual([]);
  });
});

// ── getFieldPreviewText ──────────────────────────────────────────────────────

describe("getFieldPreviewText", () => {
  it("without a field def → generic preview", () => {
    expect(getFieldPreviewText(undefined, "raw")).toBe("raw");
  });

  it("select → choice label", () => {
    expect(getFieldPreviewText(makeField(), "todo")).toBe("Todo");
  });

  it("multiselect → comma-joined choice labels", () => {
    const field = makeField({ type: "multiselect" });
    expect(getFieldPreviewText(field, ["todo", "done"])).toBe("Todo, Done");
  });

  it("currency number → localized currency string", () => {
    const field = makeField({
      type: "number",
      options: { number: { format: "currency", currency: "USD", locale: "en-US" } },
    } as Partial<BaseFieldVO>);
    expect(getFieldPreviewText(field, 1234.5)).toBe("$1,234.50");
  });

  it("plain number → passthrough via fieldPreviewText", () => {
    const field = makeField({ type: "number", options: {} as BaseFieldVO["options"] });
    expect(getFieldPreviewText(field, "42")).toBe("42");
  });
});

// ── fieldPreviewText ─────────────────────────────────────────────────────────

describe("fieldPreviewText", () => {
  it("checkbox → Yes / No", () => {
    expect(fieldPreviewText(true, "checkbox")).toBe("Yes");
    expect(fieldPreviewText("true", "checkbox")).toBe("Yes");
    expect(fieldPreviewText(false, "checkbox")).toBe("No");
    expect(fieldPreviewText(undefined, "checkbox")).toBe("No");
  });

  it("created_by / updated_by → prettified actor label", () => {
    expect(fieldPreviewText("local-admin", "created_by")).toBe("Local Admin");
    expect(fieldPreviewText("jane.doe", "updated_by")).toBe("Jane Doe");
    expect(fieldPreviewText("", "created_by")).toBe("—");
  });

  it("auto_number → hash-prefixed", () => {
    expect(fieldPreviewText(7, "auto_number")).toBe("#7");
    expect(fieldPreviewText(null, "auto_number")).toBe("");
  });

  it("date → localized date, invalid dates passthrough", () => {
    const rendered = fieldPreviewText("2026-01-15T00:00:00.000Z", "date");
    expect(rendered).toBe(new Date("2026-01-15T00:00:00.000Z").toLocaleDateString());
    expect(fieldPreviewText("not-a-date", "date")).toBe("not-a-date");
  });

  it("multiselect array → comma joined", () => {
    expect(fieldPreviewText(["a", "b"], "multiselect")).toBe("a, b");
  });

  it("created_time / updated_time → localized datetime, garbage falls back", () => {
    const iso = "2026-02-03T04:05:06.000Z";
    expect(fieldPreviewText(iso, "created_time")).toBe(new Date(iso).toLocaleString());
    expect(fieldPreviewText(12345, "updated_time")).toBe("12345");
  });

  it("html → tags stripped", () => {
    expect(fieldPreviewText("<p>Hello <b>world</b></p>", "html")).toContain("Hello");
    expect(fieldPreviewText("<p>Hello</p>", "html")).not.toContain("<p>");
  });

  it("untyped → stringified", () => {
    expect(fieldPreviewText("plain")).toBe("plain");
    expect(fieldPreviewText(null)).toBe("");
    expect(fieldPreviewText({ a: 1 })).toContain('"a"');
  });
});

// ── getRelationRecordIds ─────────────────────────────────────────────────────

describe("getRelationRecordIds", () => {
  it("array → keeps non-empty string ids only", () => {
    expect(getRelationRecordIds(["rec_1", "", 5, "rec_2"])).toEqual(["rec_1", "rec_2"]);
  });

  it("single string → wrapped in array; empty → []", () => {
    expect(getRelationRecordIds("rec_9")).toEqual(["rec_9"]);
    expect(getRelationRecordIds("")).toEqual([]);
    expect(getRelationRecordIds(null)).toEqual([]);
  });
});

// ── getAttachmentRefs ────────────────────────────────────────────────────────

describe("getAttachmentRefs", () => {
  it("keeps only well-formed refs", () => {
    const good = {
      id: "ast_1",
      url: "https://cdn/x.png",
      fileName: "x.png",
      mimeType: "image/png",
      size: 42,
    };
    expect(getAttachmentRefs([good, { url: 1 }, null, "junk"])).toEqual([good]);
  });

  it("normalizes legacy attachmentId and new assetId refs", () => {
    expect(
      getAttachmentRefs([
        {
          attachmentId: "att_1",
          url: "https://cdn/x.png",
          fileName: "x.png",
          mimeType: "image/png",
          size: 42,
        },
        {
          assetId: "ast_1",
          attachmentId: "att_2",
          url: "https://cdn/y.png",
          fileName: "y.png",
          mimeType: "image/png",
          size: 24,
        },
      ]),
    ).toEqual([
      {
        id: "att_1",
        attachmentId: "att_1",
        assetId: undefined,
        url: "https://cdn/x.png",
        fileName: "x.png",
        mimeType: "image/png",
        size: 42,
      },
      {
        id: "ast_1",
        assetId: "ast_1",
        attachmentId: "att_2",
        url: "https://cdn/y.png",
        fileName: "y.png",
        mimeType: "image/png",
        size: 24,
      },
    ]);
  });

  it("non-array → []", () => {
    expect(getAttachmentRefs("nope")).toEqual([]);
    expect(getAttachmentRefs(undefined)).toEqual([]);
  });
});

// ── media URL safety ────────────────────────────────────────────────────────

describe("safeFetchableUrl", () => {
  it("allows root-relative and absolute HTTP(S) media URLs", () => {
    expect(safeFetchableUrl("/assets/readme/example.svg")).toBe("/assets/readme/example.svg");
    expect(safeFetchableUrl("https://cdn.example.com/example.svg")).toBe(
      "https://cdn.example.com/example.svg",
    );
  });

  it("blocks bare relative image filenames before they hit the dashboard route", () => {
    expect(safeFetchableUrl("ai-native-database-paradigm.svg")).toBeNull();
    expect(safeFetchableUrl("human-ai-database-collaboration.svg")).toBeNull();
  });

  it("strips unsafe HTML image sources", () => {
    expect(sanitizeHtml('<img src="ai-native-database-paradigm.svg" alt="diagram">')).toBe(
      '<img alt="diagram">',
    );
    expect(sanitizeHtml('<img src="/assets/readme/example.svg" alt="diagram">')).toBe(
      '<img src="/assets/readme/example.svg" alt="diagram">',
    );
  });
});

// ── record title / long-field heuristics ────────────────────────────────────

describe("isRecordTitleField / isRecordLongField", () => {
  it("title-ish slugs are title fields", () => {
    expect(isRecordTitleField(makeField({ slug: "title" }))).toBe(true);
    expect(isRecordTitleField(makeField({ slug: "name" }))).toBe(true);
    expect(isRecordTitleField(makeField({ slug: "status" }))).toBe(false);
  });

  it("long by type, by slug, or by value length", () => {
    expect(isRecordLongField(makeField({ type: "markdown" }), "x")).toBe(true);
    expect(isRecordLongField(makeField({ type: "html" }), "<p>x</p>")).toBe(true);
    expect(isRecordLongField(makeField({ type: "code" }), "const x = 1;")).toBe(true);
    expect(isRecordLongField(makeField({ type: "json" }), '{"ok":true}')).toBe(true);
    expect(isRecordLongField(makeField({ type: "yaml" }), "ok: true")).toBe(true);
    expect(isRecordLongField(makeField({ slug: "description", type: "text" }), "x")).toBe(true);
    expect(isRecordLongField(makeField({ slug: "status", type: "text" }), "x".repeat(200))).toBe(
      true,
    );
    expect(isRecordLongField(makeField({ slug: "status", type: "text" }), "short")).toBe(false);
  });
});

// ── code preview language ───────────────────────────────────────────────────

describe("code preview language", () => {
  it("normalizes common aliases", () => {
    expect(normalizeCodeLanguage("TS")).toBe("typescript");
    expect(normalizeCodeLanguage("yml")).toBe("yaml");
    expect(normalizeCodeLanguage("plain")).toBe("text");
  });

  it("honors configured languages and pins structured field types", () => {
    expect(
      getCodeFieldPreviewLanguage(
        makeField({ type: "code", options: { code: { language: "ts" } } }),
        "const x: number = 1;",
      ),
    ).toBe("typescript");
    expect(getCodeFieldPreviewLanguage(makeField({ type: "json" }), '{"ok":true}')).toBe("json");
    expect(getCodeFieldPreviewLanguage(makeField({ type: "yaml" }), "ok: true")).toBe("yaml");
  });

  it("guesses a useful language for unconfigured code fields", () => {
    expect(
      getCodeFieldPreviewLanguage(makeField({ type: "code", options: {} }), "const x = 1;"),
    ).toBe("javascript");
    expect(
      getCodeFieldPreviewLanguage(makeField({ type: "code", options: {} }), '{"ok":true}'),
    ).toBe("json");
  });
});

// ── getFieldName / getRecordFieldType ────────────────────────────────────────

describe("getFieldName / getRecordFieldType", () => {
  const fields = [
    makeField({ slug: "company", name: { en: "Company", "zh-CN": "公司" } }),
    makeField({ slug: "status", name: "Status", type: "select" }),
  ];

  it("resolves iString field names from the change request base", () => {
    const changeRequest = { base: { fields } } as unknown as ChangeRequestVO;
    expect(getFieldName(changeRequest, "company")).toBe("Company");
    expect(getFieldName(changeRequest, "missing")).toBe("missing");
  });

  it("getFieldName without a base → slug fallback", () => {
    const changeRequest = { base: null } as unknown as ChangeRequestVO;
    expect(getFieldName(changeRequest, "anything")).toBe("anything");
  });

  it("getRecordFieldType looks up the field type by slug", () => {
    const record = { base: { fields } } as unknown as RecordVO;
    expect(getRecordFieldType(record, "status")).toBe("select");
    expect(getRecordFieldType(record, "missing")).toBeUndefined();
  });
});
