import type { BaseFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { defaultNewFieldValue, getEditorFieldValue } from "./field";

/**
 * What the record editor puts INTO a field control when opening an existing
 * record. The bug this file exists for: a field type that falls through to the
 * `fieldValueToString` default gets its value JSON-stringified, and a control
 * that expects a list then reads the whole `["local-admin"]` string as one id.
 *
 * That is invisible to typecheck (everything is `unknown`) and invisible to the
 * server tests (the value is correct in the DB) — it only shows up in the
 * editor, which is exactly where `member` hit it.
 */

const field = (type: string, options: Record<string, unknown> = {}): BaseFieldVO =>
  ({
    id: `f_${type}`,
    baseId: "b1",
    slug: type,
    name: type,
    type,
    required: false,
    position: 0,
    options,
  }) as BaseFieldVO;

describe("getEditorFieldValue — id-list field types keep their shape", () => {
  it("hands a multi-member field its id ARRAY, never a JSON string", () => {
    const value = getEditorFieldValue(field("member"), ["local-admin", "local-editor"]);
    expect(value).toEqual(["local-admin", "local-editor"]);
    expect(typeof value).not.toBe("string");
  });

  it("hands a single-member field a scalar id", () => {
    expect(getEditorFieldValue(field("member", { multiple: false }), "local-admin")).toBe(
      "local-admin",
    );
    // An array arriving on a single-member field (retyped, or written by an API
    // caller) collapses to its first id rather than rendering as "[object]".
    expect(getEditorFieldValue(field("member", { multiple: false }), ["local-editor"])).toBe(
      "local-editor",
    );
  });

  it("maps an empty / unset member cell to the control's empty value", () => {
    expect(getEditorFieldValue(field("member"), undefined)).toEqual([]);
    expect(getEditorFieldValue(field("member"), null)).toEqual([]);
    expect(getEditorFieldValue(field("member", { multiple: false }), undefined)).toBe("");
  });

  it("treats member the same way it treats relation", () => {
    const ids = ["a", "b"];
    expect(getEditorFieldValue(field("member"), ids)).toEqual(
      getEditorFieldValue(field("relation"), ids),
    );
    expect(getEditorFieldValue(field("member", { multiple: false }), ids)).toEqual(
      getEditorFieldValue(field("relation", { multiple: false }), ids),
    );
  });

  it("still stringifies the scalar text-ish types", () => {
    expect(getEditorFieldValue(field("text"), "hello")).toBe("hello");
    expect(getEditorFieldValue(field("number"), 42)).toBe("42");
  });
});

describe("defaultNewFieldValue — the create form's starting value", () => {
  it("starts a member field as an empty list, like relation", () => {
    expect(defaultNewFieldValue("member")).toEqual([]);
    expect(defaultNewFieldValue("relation")).toEqual([]);
  });

  it("starts scalar fields as an empty string", () => {
    expect(defaultNewFieldValue("text")).toBe("");
  });
});
