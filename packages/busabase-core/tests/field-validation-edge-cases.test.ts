import { describe, expect, it } from "vitest";
import { computeSystemFieldValues, validateRecordFields } from "../src/domains/base/field-rules";
import { FIELD_TYPES, type FieldDef } from "../src/domains/base/field-types";
import type { FieldType } from "../src/types";

// Per-field-type validation edge cases. The happy-path file (field-rules.test.ts)
// proves every type accepts ONE valid value and rejects ONE bad one; this file
// walks each type's boundaries individually — the falsy-but-valid cases (false,
// 0), the format variants, the array shapes, and the required/empty interplay —
// so a regression in any single validator surfaces against its own `it`.

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
  return validateRecordFields({ [d.slug]: value }, [d])[0]?.message ?? null;
};

const SELECT_OPTS = {
  options: { choices: [{ id: "s1", name: "Open" }] },
} satisfies Partial<FieldDef>;
const MULTI_OPTS = {
  options: {
    choices: [
      { id: "m1", name: "a" },
      { id: "m2", name: "b" },
    ],
  },
} satisfies Partial<FieldDef>;

describe("text-like fields (text / longtext / markdown / html / code / ai_summary)", () => {
  const TEXT_TYPES: FieldType[] = ["text", "longtext", "markdown", "html", "code", "ai_summary"];

  it.each(TEXT_TYPES)("%s accepts any string, including whitespace and unicode", (type) => {
    expect(checkOne(type, "")).toBeNull(); // empty optional → skipped
    expect(checkOne(type, "   ")).toBeNull(); // whitespace is a string
    expect(checkOne(type, "héllo 世界 🚀")).toBeNull();
    expect(checkOne(type, "a".repeat(100_000))).toBeNull(); // no length cap
  });

  it.each(TEXT_TYPES)("%s rejects non-string scalars and objects", (type) => {
    expect(checkOne(type, 123)).toMatch(/must be text/);
    expect(checkOne(type, true)).toMatch(/must be text/);
    expect(checkOne(type, { toString: () => "x" })).toMatch(/must be text/);
    expect(checkOne(type, ["x"])).toMatch(/must be text/);
  });
});

describe("structured text fields (json / yaml)", () => {
  it("json accepts valid JSON text and rejects malformed JSON", () => {
    expect(checkOne("json", '{"ok":true}')).toBeNull();
    expect(checkOne("json", "[1,2,3]")).toBeNull();
    expect(checkOne("json", "{bad json")).toMatch(/valid JSON/);
    expect(checkOne("json", 123)).toMatch(/must be text/);
  });

  it("yaml accepts valid YAML text and rejects malformed YAML", () => {
    expect(checkOne("yaml", "ok: true\nitems:\n  - 1")).toBeNull();
    expect(checkOne("yaml", "bad: [")).toMatch(/valid YAML/);
    expect(checkOne("yaml", 123)).toMatch(/must be text/);
  });

  it("code validates structured syntax only when configured with that language", () => {
    expect(checkOne("code", "{bad json")).toBeNull();
    expect(checkOne("code", "{bad json", { options: { code: { language: "json" } } })).toMatch(
      /valid JSON/,
    );
    expect(checkOne("code", "bad: [", { options: { code: { language: "yaml" } } })).toMatch(
      /valid YAML/,
    );
  });

  // Regression: `JSON.parse` on a well-formed-but-absurdly-deep string (e.g.
  // 10,000 levels of `[[[[...]]]]`) succeeds fine in V8 — it does NOT throw,
  // so jsonValidator's own try/catch never fires. The crash actually happened
  // downstream, when the parsed deeply-nested structure was written to the
  // `valueJson` jsonb column: drizzle-orm's jsonb column serialization
  // (`mapToDriverValue` → `JSON.stringify`) blows the call stack with an
  // unclassified RangeError, surfacing as a raw 500. The fix rejects
  // pathologically deep input here — before any parsing — with a clean
  // validation error, so it never reaches that downstream re-serialization.
  it("json rejects pathologically deep nesting with a clean validation error instead of crashing", () => {
    const buildNested = (depth: number) => "[".repeat(depth) + "]".repeat(depth);

    // Previously crashed the whole write path with an unclassified 500.
    expect(checkOne("json", buildNested(10_000))).toMatch(/nested too deeply/);

    // A reasonably-sized valid JSON value (including moderate nesting well
    // under the cap) still works normally — no false-positive rejection.
    expect(checkOne("json", buildNested(100))).toBeNull();
    expect(checkOne("json", JSON.stringify({ a: [1, 2, { b: "c" }], d: null }))).toBeNull();
  });
});

describe("number", () => {
  it("accepts the falsy-but-valid zero (not treated as empty)", () => {
    expect(checkOne("number", 0)).toBeNull();
    expect(checkOne("number", "0")).toBeNull();
  });
  it("accepts negatives, decimals, and exponential notation", () => {
    expect(checkOne("number", -42)).toBeNull();
    expect(checkOne("number", 3.14)).toBeNull();
    expect(checkOne("number", "-3.14")).toBeNull();
    expect(checkOne("number", "1e3")).toBeNull();
    expect(checkOne("number", " 42 ")).toBeNull(); // Number() trims
  });
  it("rejects non-finite numbers and non-numeric strings", () => {
    expect(checkOne("number", Number.NaN)).toMatch(/must be a number/);
    expect(checkOne("number", Number.POSITIVE_INFINITY)).toMatch(/must be a number/);
    expect(checkOne("number", "abc")).toMatch(/must be a number/);
    expect(checkOne("number", "12px")).toMatch(/must be a number/);
  });
  it("rejects booleans and other non-numeric types", () => {
    expect(checkOne("number", true)).toMatch(/must be a number/);
    expect(checkOne("number", [1])).toMatch(/must be a number/);
    expect(checkOne("number", {})).toMatch(/must be a number/);
  });
  it("0 satisfies a required number (falsy, but present)", () => {
    expect(checkOne("number", 0, { required: true })).toBeNull();
  });
});

describe("checkbox", () => {
  it("accepts both booleans — false is valid and not treated as empty", () => {
    expect(checkOne("checkbox", true)).toBeNull();
    expect(checkOne("checkbox", false)).toBeNull();
  });
  it("false satisfies a required checkbox (present, just falsy)", () => {
    expect(checkOne("checkbox", false, { required: true })).toBeNull();
  });
  it("rejects truthy/falsy stand-ins that are not real booleans", () => {
    expect(checkOne("checkbox", "true")).toMatch(/true or false/);
    expect(checkOne("checkbox", 1)).toMatch(/true or false/);
    expect(checkOne("checkbox", 0)).toMatch(/true or false/); // 0 is present, not empty
    expect(checkOne("checkbox", "yes")).toMatch(/true or false/);
  });
});

describe("date", () => {
  it("accepts ISO datetimes, date-only strings, and epoch numbers", () => {
    expect(checkOne("date", "2026-06-24T00:00:00.000Z")).toBeNull();
    expect(checkOne("date", "2026-06-24")).toBeNull();
    expect(checkOne("date", 1_719_187_200_000)).toBeNull();
    expect(checkOne("date", 0)).toBeNull(); // the Unix epoch is a valid instant
  });
  it("rejects unparseable strings and non-date types", () => {
    expect(checkOne("date", "not-a-date")).toMatch(/valid date/);
    expect(checkOne("date", "2026-13-99")).toMatch(/valid date/);
    expect(checkOne("date", true)).toMatch(/valid date/);
    expect(checkOne("date", {})).toMatch(/valid date/);
  });
  it("rejects year 0 and negative ISO-8601 extended years (both parse fine in JS Date but crash Postgres timestamp inserts)", () => {
    expect(checkOne("date", "0000-01-01")).toMatch(/valid date/);
    expect(checkOne("date", "-000001-01-01")).toMatch(/valid date/);
  });
  it("still accepts the year-1 and year-9999 boundaries (must not regress)", () => {
    expect(checkOne("date", "0001-01-01")).toBeNull();
    expect(checkOne("date", "9999-12-31")).toBeNull();
  });
});

describe("email", () => {
  it("accepts well-formed addresses", () => {
    expect(checkOne("email", "a@b.com")).toBeNull();
    expect(checkOne("email", "first.last+tag@sub.example.co")).toBeNull();
  });
  it("rejects each kind of malformation", () => {
    expect(checkOne("email", "plainaddress")).toMatch(/valid email/);
    expect(checkOne("email", "no-domain@")).toMatch(/valid email/);
    expect(checkOne("email", "no-tld@example")).toMatch(/valid email/);
    expect(checkOne("email", "has space@example.com")).toMatch(/valid email/);
    expect(checkOne("email", "two@@example.com")).toMatch(/valid email/);
    expect(checkOne("email", 123)).toMatch(/valid email/);
  });
});

describe("url", () => {
  it("accepts http and https URLs", () => {
    expect(checkOne("url", "http://example.com")).toBeNull();
    expect(checkOne("url", "https://example.com/path?q=1#frag")).toBeNull();
  });
  it("rejects non-http(s) protocols, protocol-less strings, and non-strings", () => {
    expect(checkOne("url", "ftp://host/x")).toMatch(/valid URL/);
    expect(checkOne("url", "mailto:a@b.com")).toMatch(/valid URL/);
    expect(checkOne("url", "example.com")).toMatch(/valid URL/); // no protocol
    expect(checkOne("url", "not a url")).toMatch(/valid URL/);
    expect(checkOne("url", 123)).toMatch(/valid URL/);
  });
});

describe("embed", () => {
  it("accepts common user-facing YouTube and Google Drive URLs", () => {
    expect(checkOne("embed", "https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(checkOne("embed", "https://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(checkOne("embed", "https://drive.google.com/file/d/abc123/view")).toBeNull();
  });
  it("accepts generic http(s) URLs unless providers are restricted", () => {
    expect(checkOne("embed", "https://example.com/embed")).toBeNull();
    expect(
      checkOne("embed", "https://example.com/embed", {
        options: { embed: { providers: ["youtube", "google_drive"] } },
      }),
    ).toMatch(/embeddable/);
  });
  it("rejects non-http(s) values and non-strings", () => {
    expect(checkOne("embed", "ftp://host/x")).toMatch(/embeddable/);
    expect(checkOne("embed", "not a url")).toMatch(/embeddable/);
    expect(checkOne("embed", 123)).toMatch(/embeddable/);
  });
});

describe("phone", () => {
  it("accepts international, spaced, and punctuated forms at/above the 6-char floor", () => {
    expect(checkOne("phone", "+1 555-123-4567")).toBeNull();
    expect(checkOne("phone", "(555) 123-4567")).toBeNull();
    expect(checkOne("phone", "123456")).toBeNull(); // exactly six digits
  });
  it("rejects too-short, lettered, and non-string values", () => {
    expect(checkOne("phone", "12345")).toMatch(/valid phone/); // five chars
    expect(checkOne("phone", "call-me")).toMatch(/valid phone/);
    expect(checkOne("phone", "555 CALL")).toMatch(/valid phone/);
    expect(checkOne("phone", 5_551_234)).toMatch(/valid phone/);
  });
});

describe("select", () => {
  it("matches a choice by either its id or its display name", () => {
    expect(checkOne("select", "Open", SELECT_OPTS)).toBeNull();
    expect(checkOne("select", "s1", SELECT_OPTS)).toBeNull();
  });
  it("rejects a value outside the defined choices", () => {
    expect(checkOne("select", "Closed", SELECT_OPTS)).toMatch(/one of its options/);
  });
  it("is unconstrained when no choices are configured", () => {
    expect(checkOne("select", "anything-goes")).toBeNull();
    expect(checkOne("select", "anything-goes", { options: { choices: [] } })).toBeNull();
  });
  it("rejects non-string values regardless of choices", () => {
    expect(checkOne("select", ["Open"], SELECT_OPTS)).toMatch(/one of its options/);
    expect(checkOne("select", 1, SELECT_OPTS)).toMatch(/one of its options/);
  });
});

describe("multiselect", () => {
  it("accepts an array of valid choices, by id or name", () => {
    expect(checkOne("multiselect", ["a"], MULTI_OPTS)).toBeNull();
    expect(checkOne("multiselect", ["a", "b"], MULTI_OPTS)).toBeNull();
    expect(checkOne("multiselect", ["m1", "m2"], MULTI_OPTS)).toBeNull();
  });
  it("accepts an empty array when NOT required (documents current behavior: emptiness is not a choice violation)", () => {
    expect(checkOne("multiselect", [], MULTI_OPTS)).toBeNull();
  });
  it("rejects an empty array on a REQUIRED multiselect — [] is not a meaningful value", () => {
    expect(checkOne("multiselect", [], { ...MULTI_OPTS, required: true })).toMatch(/is required/);
  });
  it("rejects a bare string, an out-of-set member, and non-string members", () => {
    expect(checkOne("multiselect", "a", MULTI_OPTS)).toMatch(/list of its options/);
    expect(checkOne("multiselect", ["a", "zzz"], MULTI_OPTS)).toMatch(/list of its options/);
    expect(checkOne("multiselect", [1, 2], MULTI_OPTS)).toMatch(/list of its options/);
  });
});

describe("relation", () => {
  it("accepts a single record id, a list of ids, and an empty list when NOT required", () => {
    expect(checkOne("relation", "rec_1")).toBeNull();
    expect(checkOne("relation", ["rec_1", "rec_2"])).toBeNull();
    expect(checkOne("relation", [])).toBeNull();
  });
  it("rejects an empty list on a REQUIRED relation — [] is not a meaningful value", () => {
    expect(checkOne("relation", [], { required: true })).toMatch(/is required/);
  });
  it("rejects numbers, mixed-type arrays, and objects", () => {
    expect(checkOne("relation", 5)).toMatch(/record id/);
    expect(checkOne("relation", ["rec_1", 2])).toMatch(/record id/);
    expect(checkOne("relation", { id: "rec_1" })).toMatch(/record id/);
  });
});

describe("ai_tags", () => {
  it("accepts a string array, including empty", () => {
    expect(checkOne("ai_tags", ["x", "y"])).toBeNull();
    expect(checkOne("ai_tags", [])).toBeNull();
  });
  it("rejects a bare string and arrays with non-string members", () => {
    expect(checkOne("ai_tags", "x")).toMatch(/list of tags/);
    expect(checkOne("ai_tags", ["x", 2])).toMatch(/list of tags/);
  });
});

describe("attachment", () => {
  const ref = {
    id: "att_1",
    url: "https://cdn/x.png",
    fileName: "x.png",
    mimeType: "image/png",
    size: 1_000,
  };
  it("requires an array of well-formed attachment refs", () => {
    expect(FIELD_TYPES.attachment.validate).toBeDefined();
    expect(checkOne("attachment", [ref])).toBeNull();
    expect(checkOne("attachment", [])).toBeNull(); // empty cell is valid
    expect(checkOne("attachment", { url: "x" })).toMatch(/list of attachments/); // not an array
    expect(checkOne("attachment", "anything")).toMatch(/list of attachments/);
    expect(checkOne("attachment", [{ url: "x" }])).toMatch(/invalid attachment/); // missing fields
  });
  it("honors required (empty value flagged before the shape validator)", () => {
    expect(checkOne("attachment", undefined, { required: true })).toMatch(/is required/);
  });
  it("rejects an empty array on a REQUIRED attachment — [] is not a meaningful value", () => {
    expect(checkOne("attachment", [], { required: true })).toMatch(/is required/);
  });
});

describe("required & empty handling across types", () => {
  it("flags every emptiness form (undefined / null / empty string) on a required field", () => {
    for (const empty of [undefined, null, ""]) {
      expect(checkOne("text", empty, { required: true })).toMatch(/is required/);
    }
  });
  it("flags an empty array as empty too, uniformly across every array-shaped required type", () => {
    expect(checkOne("multiselect", [], { ...MULTI_OPTS, required: true })).toMatch(/is required/);
    expect(checkOne("attachment", [], { required: true })).toMatch(/is required/);
    expect(checkOne("relation", [], { required: true })).toMatch(/is required/);
  });
  it("skips an empty optional field of any type without error, including an empty array", () => {
    expect(checkOne("number", "")).toBeNull();
    expect(checkOne("email", null)).toBeNull();
    expect(checkOne("select", undefined, SELECT_OPTS)).toBeNull();
    expect(checkOne("relation", null)).toBeNull();
    expect(checkOne("relation", [])).toBeNull(); // optional array field: [] still fine
    expect(checkOne("multiselect", [], MULTI_OPTS)).toBeNull();
    expect(checkOne("attachment", [])).toBeNull();
  });
  it("does NOT treat the present-but-falsy values false / 0 as empty", () => {
    expect(checkOne("checkbox", false, { required: true })).toBeNull();
    expect(checkOne("number", 0, { required: true })).toBeNull();
  });
});

describe("validateRecordFields — multi-field aggregation", () => {
  it("reports one error per offending field and leaves valid ones out", () => {
    const defs: FieldDef[] = [
      def("text", { slug: "title", required: true }),
      def("number", { slug: "score" }),
      def("email", { slug: "contact" }),
    ];
    const errors = validateRecordFields(
      { title: "", score: "abc", contact: "ok@example.com" },
      defs,
    );
    expect(errors.map((e) => e.slug).sort()).toEqual(["score", "title"]);
    expect(errors.find((e) => e.slug === "title")?.message).toMatch(/is required/);
    expect(errors.find((e) => e.slug === "score")?.type).toBe("number");
  });
  it("returns an empty array when every field is valid", () => {
    const defs: FieldDef[] = [def("text", { slug: "title" }), def("number", { slug: "score" })];
    expect(validateRecordFields({ title: "hi", score: 1 }, defs)).toEqual([]);
  });
});

describe("computeSystemFieldValues — additional edge cases", () => {
  const systemDefs = [
    def("created_time", { slug: "ct" }),
    def("updated_time", { slug: "ut" }),
    def("created_by", { slug: "cb" }),
    def("updated_by", { slug: "ub" }),
    def("auto_number", { slug: "an" }),
  ];

  it("create mode ignores any pre-existing values (clean stamp)", () => {
    const out = computeSystemFieldValues({
      defs: systemDefs,
      mode: "create",
      actorId: "alice",
      timestampIso: "2026-06-24T10:00:00.000Z",
      existing: { ct: "1999-01-01T00:00:00.000Z", cb: "ghost", an: 999 },
      nextAutoNumber: () => 1,
    });
    expect(out.ct).toBe("2026-06-24T10:00:00.000Z");
    expect(out.cb).toBe("alice");
    expect(out.an).toBe(1);
  });

  it("returns an empty object when no system fields are present", () => {
    const out = computeSystemFieldValues({
      defs: [def("text", { slug: "title" }), def("number", { slug: "score" })],
      mode: "create",
      actorId: "x",
      timestampIso: "t",
    });
    expect(out).toEqual({});
  });

  it("update always re-stamps updated_time / updated_by even when unchanged in existing", () => {
    const out = computeSystemFieldValues({
      defs: systemDefs,
      mode: "update",
      actorId: "bob",
      timestampIso: "2026-06-24T12:00:00.000Z",
      existing: {
        ct: "2026-01-01T00:00:00.000Z",
        ut: "2026-01-01T00:00:00.000Z",
        cb: "alice",
        ub: "alice",
        an: 3,
      },
      nextAutoNumber: () => 99,
    });
    expect(out.ut).toBe("2026-06-24T12:00:00.000Z");
    expect(out.ub).toBe("bob");
    expect(out.an).toBe(3); // never reassigned on update
  });
});
