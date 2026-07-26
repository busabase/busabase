import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

const resolve = () => (slug: string) => {
  throw new Error(`unexpected field ref in test: ${slug}`);
};

describe("formula record functions", () => {
  it("RECORD_ID resolves from the record context", () => {
    expect(
      evaluateFormula("RECORD_ID()", resolve(), {
        recordId: "rec_abc123",
        createdAtIso: null,
        lastModifiedIso: null,
      }),
    ).toBe("rec_abc123");
  });

  it("RECORD_ID resolves to null when no record context is given", () => {
    expect(evaluateFormula("RECORD_ID()", resolve())).toBeNull();
  });

  it("CREATED_TIME resolves the record's original creation timestamp", () => {
    const out = evaluateFormula("CREATED_TIME()", resolve(), {
      recordId: "rec_abc123",
      createdAtIso: "2026-01-01T00:00:00.000Z",
      lastModifiedIso: "2026-06-01T00:00:00.000Z",
    });
    expect(out).toBeInstanceOf(Date);
    expect((out as Date).toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("LAST_MODIFIED_TIME resolves this write's own timestamp", () => {
    const out = evaluateFormula("LAST_MODIFIED_TIME()", resolve(), {
      recordId: "rec_abc123",
      createdAtIso: "2026-01-01T00:00:00.000Z",
      lastModifiedIso: "2026-06-01T00:00:00.000Z",
    });
    expect((out as Date).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });

  it("record functions reject arguments", () => {
    expect(() => evaluateFormula("RECORD_ID(1)", resolve())).toThrow(/expected 0 argument/);
  });
});
