import { describe, expect, it } from "vitest";
import { FormBoundFieldSchema, FormFieldBindingSchema } from "../../form/types";
import { PackageBaseFieldSchema } from "../../package/types";
import {
  createBaseFieldInputSchema,
  fieldHelpSchema,
  updateFieldChangeRequestInputSchema,
} from "./base-schemas";

describe("field guidance contract", () => {
  const help = { description: "客户实际验收通过的日期；未验收时留空。", example: "2026-10-14" };

  it("retains guidance in create input and template serialization", () => {
    const field = { slug: "delivered", name: "Actual delivery", type: "date", options: { help } };
    expect(createBaseFieldInputSchema.parse(field).options.help).toEqual(help);
    expect(PackageBaseFieldSchema.parse({ ...field, position: 0 }).options.help).toEqual(help);
  });

  it("distinguishes no change, replacement, and removal", () => {
    const parse = (patch: unknown) =>
      updateFieldChangeRequestInputSchema.parse({ fieldId: "fld_test", patch }).patch;
    expect(parse({ name: "Delivery" }).help).toBeUndefined();
    expect(parse({ help }).help).toEqual(help);
    expect(parse({ help: null }).help).toBeNull();
    expect(parse({ help }).options).toBeUndefined();
  });

  it("limits guidance and retains plain text without HTML interpretation", () => {
    expect(
      fieldHelpSchema.safeParse({ description: "x".repeat(1000), example: "x".repeat(200) })
        .success,
    ).toBe(true);
    expect(fieldHelpSchema.safeParse({ description: "x".repeat(1001) }).success).toBe(false);
    expect(fieldHelpSchema.safeParse({ example: "x".repeat(201) }).success).toBe(false);
    expect(
      fieldHelpSchema.parse({ description: "<script>plain text</script>\nMore" }).description,
    ).toBe("<script>plain text</script>\nMore");
  });

  it("projects only safe form guidance and preserves explicit empty overrides", () => {
    const field = FormBoundFieldSchema.parse({
      slug: "delivered",
      name: "Delivery",
      type: "date",
      help,
      options: { secret: "private" },
    });
    expect(field.help).toEqual(help);
    expect(field).not.toHaveProperty("options");
    expect(
      FormFieldBindingSchema.parse({ inputName: "date", fieldSlug: "delivered", help: "" }).help,
    ).toBe("");
    expect(
      FormFieldBindingSchema.parse({ inputName: "date", fieldSlug: "delivered" }).help,
    ).toBeUndefined();
  });
});
