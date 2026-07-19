import { describe, expect, it } from "vitest";
import { computeSystemFieldValues, validateRecordFields } from "../src/domains/base/field-rules";
import {
  type FieldDef,
  isSystemFieldType,
  SYSTEM_FIELD_TYPES,
} from "../src/domains/base/field-types";
import type { FieldType } from "../src/types";

const ALL_FIELD_TYPES: FieldType[] = [
  "text",
  "longtext",
  "markdown",
  "html",
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "embed",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  "ai_summary",
  "ai_tags",
  "code",
  "json",
  "yaml",
];

const def = (type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  slug: extra.slug ?? type,
  name: extra.name ?? type,
  type,
  required: extra.required,
  options: extra.options,
});

/** Validate a single field value in isolation; returns the error message or null. */
const checkOne = (
  type: FieldType,
  value: unknown,
  extra: Partial<FieldDef> = {},
): string | null => {
  const d = def(type, extra);
  const errors = validateRecordFields({ [d.slug]: value }, [d]);
  return errors[0]?.message ?? null;
};

describe("SYSTEM_FIELD_TYPES", () => {
  it("is exactly the five server-managed types", () => {
    expect([...SYSTEM_FIELD_TYPES].sort()).toEqual(
      ["auto_number", "created_by", "created_time", "updated_by", "updated_time"].sort(),
    );
  });
  it("isSystemFieldType agrees with the set for every field type", () => {
    for (const t of ALL_FIELD_TYPES) {
      expect(isSystemFieldType(t)).toBe(SYSTEM_FIELD_TYPES.has(t));
    }
  });
});

describe("validateRecordFields — every field type has a rule path", () => {
  // Guards that validateRecordFields handles all field types without
  // throwing, and that a reasonable valid value passes for each.
  const VALID: Record<FieldType, unknown> = {
    text: "hello",
    longtext: "a longer body",
    markdown: "# title",
    html: "<b>x</b>",
    code: "const x = 1;",
    json: '{"ok":true}',
    yaml: "ok: true\nitems:\n  - 1",
    attachment: [
      {
        id: "att_1",
        url: "https://cdn/x.png",
        fileName: "x.png",
        mimeType: "image/png",
        size: 100,
      },
    ],
    relation: ["rec_1", "rec_2"],
    number: 42,
    date: "2026-06-24T00:00:00.000Z",
    checkbox: true,
    select: "Open",
    multiselect: ["a", "b"],
    url: "https://example.com",
    embed: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    email: "a@b.com",
    phone: "+1 555-123-4567",
    ai_summary: "a summary",
    ai_tags: ["x", "y"],
    // System fields: value is ignored by validation entirely.
    created_time: "garbage",
    updated_time: 123,
    created_by: 999,
    updated_by: {},
    auto_number: "not-a-number",
  };
  const choiceOpts = {
    select: { options: { choices: [{ id: "s1", name: "Open" }] } },
    multiselect: {
      options: {
        choices: [
          { id: "m1", name: "a" },
          { id: "m2", name: "b" },
        ],
      },
    },
  } as Record<string, Partial<FieldDef>>;

  it.each(ALL_FIELD_TYPES)("accepts a valid %s value", (type) => {
    expect(checkOne(type, VALID[type], choiceOpts[type] ?? {})).toBeNull();
  });

  it("never validates system fields, even with nonsense values", () => {
    const defs = [...SYSTEM_FIELD_TYPES].map((t) => def(t, { required: true }));
    const fields = Object.fromEntries(defs.map((d) => [d.slug, { junk: true }]));
    expect(validateRecordFields(fields, defs)).toEqual([]);
  });
});

describe("validateRecordFields — rejects bad values per type", () => {
  it("number rejects non-numeric", () => {
    expect(checkOne("number", "abc")).toMatch(/must be a number/);
    expect(checkOne("number", "42")).toBeNull(); // numeric string ok
  });
  it("checkbox requires a boolean", () => {
    expect(checkOne("checkbox", "true")).toMatch(/true or false/);
  });
  it("date rejects an unparseable value", () => {
    expect(checkOne("date", "not-a-date")).toMatch(/valid date/);
  });
  it("email rejects a malformed address", () => {
    expect(checkOne("email", "nope")).toMatch(/valid email/);
  });
  it("url rejects non-http(s) and garbage", () => {
    expect(checkOne("url", "ftp://host/x")).toMatch(/valid URL/);
    expect(checkOne("url", "not a url")).toMatch(/valid URL/);
  });
  it("embed accepts supported URLs and rejects garbage", () => {
    expect(checkOne("embed", "https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(checkOne("embed", "https://drive.google.com/file/d/abc123/view")).toBeNull();
    expect(checkOne("embed", "not a url")).toMatch(/embeddable/);
    expect(
      checkOne("embed", "https://example.com", {
        options: { embed: { providers: ["youtube", "google_drive"] } },
      }),
    ).toMatch(/embeddable/);
  });
  it("phone rejects letters", () => {
    expect(checkOne("phone", "call-me")).toMatch(/valid phone/);
  });
  it("select must be one of its choices (by id or name)", () => {
    const opts = { options: { choices: [{ id: "s1", name: "Open" }] } };
    expect(checkOne("select", "Open", opts)).toBeNull();
    expect(checkOne("select", "s1", opts)).toBeNull();
    expect(checkOne("select", "Closed", opts)).toMatch(/one of its options/);
  });
  it("select is unconstrained when no choices are defined", () => {
    expect(checkOne("select", "anything")).toBeNull();
  });
  it("multiselect must be an array of valid choices", () => {
    const opts = { options: { choices: [{ id: "m1", name: "a" }] } };
    expect(checkOne("multiselect", ["a"], opts)).toBeNull();
    expect(checkOne("multiselect", "a", opts)).toMatch(/list of its options/);
    expect(checkOne("multiselect", ["a", "zzz"], opts)).toMatch(/list of its options/);
  });
  it("relation accepts a string or string[] but not a number", () => {
    expect(checkOne("relation", "rec_1")).toBeNull();
    expect(checkOne("relation", ["rec_1", "rec_2"])).toBeNull();
    expect(checkOne("relation", 5)).toMatch(/record id/);
  });
  it("ai_tags must be a list of strings", () => {
    expect(checkOne("ai_tags", ["x"])).toBeNull();
    expect(checkOne("ai_tags", "x")).toMatch(/list of tags/);
  });
  it("json rejects malformed JSON", () => {
    expect(checkOne("json", '{"ok":true}')).toBeNull();
    expect(checkOne("json", "{bad json")).toMatch(/valid JSON/);
  });
  it("yaml rejects malformed YAML", () => {
    expect(checkOne("yaml", "ok: true\nitems:\n  - 1")).toBeNull();
    expect(checkOne("yaml", "bad: [")).toMatch(/valid YAML/);
  });
  it("code rejects malformed structured text only when its language asks for it", () => {
    expect(checkOne("code", "{bad json")).toBeNull();
    expect(checkOne("code", "{bad json", { options: { code: { language: "json" } } })).toMatch(
      /valid JSON/,
    );
    expect(checkOne("code", "bad: [", { options: { code: { language: "yaml" } } })).toMatch(
      /valid YAML/,
    );
    expect(
      checkOne("code", "bad: [", { options: { code: { language: "typescript" } } }),
    ).toBeNull();
  });
  describe("attachment", () => {
    const ref = (over: Record<string, unknown> = {}) => ({
      id: "att_1",
      url: "https://cdn/x.png",
      fileName: "x.png",
      mimeType: "image/png",
      size: 1_000,
      ...over,
    });
    it("accepts an array of well-formed refs (and an empty array)", () => {
      expect(checkOne("attachment", [ref()])).toBeNull();
      expect(checkOne("attachment", [])).toBeNull();
    });
    it("rejects a non-array value", () => {
      expect(checkOne("attachment", ref())).toMatch(/list of attachments/);
      expect(checkOne("attachment", "x")).toMatch(/list of attachments/);
    });
    it("rejects a malformed ref (missing/!typed fields)", () => {
      expect(checkOne("attachment", [{ url: "x" }])).toMatch(/invalid attachment/);
      expect(checkOne("attachment", [ref({ size: "big" })])).toMatch(/invalid attachment/);
    });
    it("enforces maxFiles", () => {
      const opts = { options: { attachment: { maxFiles: 1 } } };
      expect(checkOne("attachment", [ref()], opts)).toBeNull();
      expect(checkOne("attachment", [ref(), ref({ id: "att_2" })], opts)).toMatch(/at most 1 file/);
    });
    it("enforces allowedMimeTypes", () => {
      const opts = { options: { attachment: { allowedMimeTypes: ["image/png"] } } };
      expect(checkOne("attachment", [ref()], opts)).toBeNull();
      expect(checkOne("attachment", [ref({ mimeType: "application/pdf" })], opts)).toMatch(
        /does not allow files of type application\/pdf/,
      );
    });
    it('supports a trailing /* wildcard in allowedMimeTypes (e.g. "image/*")', () => {
      const opts = { options: { attachment: { allowedMimeTypes: ["image/*"] } } };
      expect(checkOne("attachment", [ref({ mimeType: "image/png" })], opts)).toBeNull();
      expect(checkOne("attachment", [ref({ mimeType: "image/jpeg" })], opts)).toBeNull();
      expect(checkOne("attachment", [ref({ mimeType: "text/plain" })], opts)).toMatch(
        /does not allow files of type text\/plain/,
      );
    });
    it("still requires an EXACT match when no wildcard is present in the pattern", () => {
      const opts = { options: { attachment: { allowedMimeTypes: ["image/png"] } } };
      expect(checkOne("attachment", [ref({ mimeType: "image/png" })], opts)).toBeNull();
      expect(checkOne("attachment", [ref({ mimeType: "image/jpeg" })], opts)).toMatch(
        /does not allow files of type image\/jpeg/,
      );
    });
    it("enforces the per-field maxFileSize and the 25MB ceiling", () => {
      const opts = { options: { attachment: { maxFileSize: 2_000 } } };
      expect(checkOne("attachment", [ref({ size: 2_000 })], opts)).toBeNull();
      expect(checkOne("attachment", [ref({ size: 2_001 })], opts)).toMatch(/larger than/);
      // No per-field limit → the absolute 25MB ceiling still applies.
      expect(checkOne("attachment", [ref({ size: 25 * 1024 * 1024 + 1 })])).toMatch(/larger than/);
    });
    it("formats a sub-1MB limit in KB instead of rounding down to a meaningless 0MB", () => {
      const opts = { options: { attachment: { maxFileSize: 1024 } } };
      const message = checkOne("attachment", [ref({ size: 2000 })], opts);
      expect(message).toMatch(/larger than the 1KB limit/);
      expect(message).not.toMatch(/0MB/);
    });
  });
  it.each(["text", "longtext", "markdown", "html", "code", "ai_summary"] as FieldType[])(
    "%s must be text",
    (type) => {
      expect(checkOne(type, 123)).toMatch(/must be text/);
    },
  );
});

describe("validateRecordFields — required & empty handling", () => {
  it("flags a missing required field", () => {
    expect(checkOne("text", undefined, { required: true })).toMatch(/is required/);
    expect(checkOne("text", "", { required: true })).toMatch(/is required/);
  });
  it("ignores an empty optional field", () => {
    expect(checkOne("number", "")).toBeNull();
    expect(checkOne("email", null)).toBeNull();
  });
  it("ignores values for unknown field slugs", () => {
    expect(validateRecordFields({ ghost: 123 }, [def("text")])).toEqual([]);
  });
});

describe("computeSystemFieldValues — create", () => {
  const defs = [
    def("created_time", { slug: "ct" }),
    def("updated_time", { slug: "ut" }),
    def("created_by", { slug: "cb" }),
    def("updated_by", { slug: "ub" }),
    def("auto_number", { slug: "an" }),
    def("text", { slug: "title" }), // non-system: untouched
  ];

  it("stamps all system fields and assigns the auto_number", () => {
    const out = computeSystemFieldValues({
      defs,
      mode: "create",
      actorId: "alice",
      timestampIso: "2026-06-24T10:00:00.000Z",
      nextAutoNumber: () => 7,
    });
    expect(out).toEqual({
      ct: "2026-06-24T10:00:00.000Z",
      ut: "2026-06-24T10:00:00.000Z",
      cb: "alice",
      ub: "alice",
      an: 7,
    });
    expect(out).not.toHaveProperty("title"); // non-system untouched
  });

  it("auto_number is null when no resolver is supplied", () => {
    const out = computeSystemFieldValues({
      defs: [def("auto_number", { slug: "an" })],
      mode: "create",
      actorId: "x",
      timestampIso: "t",
    });
    expect(out.an).toBeNull();
  });
});

describe("computeSystemFieldValues — update", () => {
  const defs = [
    def("created_time", { slug: "ct" }),
    def("updated_time", { slug: "ut" }),
    def("created_by", { slug: "cb" }),
    def("updated_by", { slug: "ub" }),
    def("auto_number", { slug: "an" }),
  ];
  const existing = {
    ct: "2026-01-01T00:00:00.000Z",
    cb: "original-author",
    an: 3,
  };

  it("preserves created_/auto_number and re-stamps updated_", () => {
    const out = computeSystemFieldValues({
      defs,
      mode: "update",
      actorId: "bob",
      timestampIso: "2026-06-24T12:00:00.000Z",
      existing,
      nextAutoNumber: () => 99,
    });
    expect(out.ct).toBe("2026-01-01T00:00:00.000Z"); // preserved
    expect(out.cb).toBe("original-author"); // preserved
    expect(out.an).toBe(3); // preserved, NOT reassigned to 99
    expect(out.ut).toBe("2026-06-24T12:00:00.000Z"); // re-stamped
    expect(out.ub).toBe("bob"); // re-stamped
  });

  it("falls back when an existing value is missing (field added later)", () => {
    const out = computeSystemFieldValues({
      defs,
      mode: "update",
      actorId: "bob",
      timestampIso: "2026-06-24T12:00:00.000Z",
      existing: {},
      nextAutoNumber: () => 5,
    });
    expect(out.ct).toBe("2026-06-24T12:00:00.000Z");
    expect(out.cb).toBe("bob");
    expect(out.an).toBe(5);
  });
});
