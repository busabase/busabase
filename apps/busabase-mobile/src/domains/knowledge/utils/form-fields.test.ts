import type { FormBoundFieldVO, FormFieldBindingVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildFormSubmissionValues,
  getFormControlKind,
  hasMissingRequiredFormValue,
} from "./form-fields";

const field = (type: FormBoundFieldVO["type"], slug: string = type): FormBoundFieldVO => ({
  slug,
  name: slug,
  type,
  choices: [],
});

const binding = (inputName: string, fieldSlug = inputName): FormFieldBindingVO => ({
  inputName,
  fieldSlug,
  required: true,
});

describe("getFormControlKind", () => {
  it("matches generated web form controls", () => {
    expect(getFormControlKind(field("markdown"))).toBe("textarea");
    expect(getFormControlKind(field("checkbox"))).toBe("checkbox");
    expect(getFormControlKind(field("select"))).toBe("select");
    expect(getFormControlKind(field("multiselect"))).toBe("multiselect");
    expect(getFormControlKind(field("phone"))).toBe("tel");
    expect(getFormControlKind(field("embed"))).toBe("url");
    expect(getFormControlKind(field("formula"))).toBe("text");
  });
});

describe("hasMissingRequiredFormValue", () => {
  it("treats blank strings and empty arrays as missing while preserving false", () => {
    const bindings = [binding("title"), binding("tags"), binding("approved")];
    expect(hasMissingRequiredFormValue(bindings, { title: " ", tags: [], approved: false })).toBe(
      true,
    );
    expect(
      hasMissingRequiredFormValue(bindings, {
        title: "Ready",
        tags: ["product"],
        approved: false,
      }),
    ).toBe(false);
  });
});

describe("buildFormSubmissionValues", () => {
  it("converts valid numeric controls and keeps other values unchanged", () => {
    const bindings = [binding("score"), binding("approved")];
    const fields = new Map([
      ["score", field("number", "score")],
      ["approved", field("checkbox", "approved")],
    ]);
    expect(buildFormSubmissionValues(bindings, fields, { score: "42.5", approved: false })).toEqual(
      { score: 42.5, approved: false },
    );
  });
});
