import { describe, expect, it } from "vitest";
import { getChangedFieldValues } from "./record-form";

describe("getChangedFieldValues", () => {
  it("keeps only added and changed values", () => {
    expect(
      getChangedFieldValues(
        {
          title: "Before",
          metadata: { audience: "operators", priority: 1 },
          unchanged: true,
        },
        {
          title: "After",
          metadata: { priority: 1, audience: "operators" },
          unchanged: true,
          added: "New",
          ignored: undefined,
        },
      ),
    ).toEqual({ title: "After", added: "New" });
  });

  it("keeps every defined value when there is no base snapshot", () => {
    expect(
      getChangedFieldValues(null, { title: "Created", empty: null, ignored: undefined }),
    ).toEqual({ title: "Created", empty: null });
  });
});
