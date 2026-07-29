import type { BaseFieldVO, BaseVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getPrimaryField, isPrimaryField } from "./primary-field";

const field = (id: string, position: number): BaseFieldVO => ({
  id,
  baseId: "base-1",
  slug: id,
  name: id,
  type: "text",
  required: false,
  position,
  options: {},
});

const base = (fields: BaseFieldVO[]): Pick<BaseVO, "fields"> => ({ fields });

describe("primary field", () => {
  it("returns the lowest-position field even when fields are unsorted", () => {
    const value = base([field("third", 2), field("first", 0), field("second", 1)]);

    expect(getPrimaryField(value)?.id).toBe("first");
    expect(isPrimaryField(value, "first")).toBe(true);
    expect(isPrimaryField(value, "second")).toBe(false);
  });

  it("returns null for a base without fields", () => {
    expect(getPrimaryField(base([]))).toBeNull();
    expect(getPrimaryField(null)).toBeNull();
  });
});
