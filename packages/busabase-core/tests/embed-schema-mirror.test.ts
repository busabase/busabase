import { createBaseFieldInputSchema as contractCreateBaseFieldInputSchema } from "busabase-contract/domains/base/contract/base-schemas";
import { describe, expect, it } from "vitest";
import { fieldSchema as coreFieldSchema } from "../src/logic/base-schemas";

const validEmbedField = {
  slug: "launch_video",
  name: "Launch video",
  type: "embed",
  options: {
    embed: {
      aspectRatio: "4:3",
      height: 480,
      providers: ["youtube", "google_drive"],
    },
  },
};

const schemas = [
  ["contract", contractCreateBaseFieldInputSchema],
  ["core", coreFieldSchema],
] as const;

describe("embed field schema mirror", () => {
  it.each(schemas)("%s schema accepts embed fields with display options", (_name, schema) => {
    const parsed = schema.parse(validEmbedField);
    expect(parsed.type).toBe("embed");
    expect(parsed.options.embed).toEqual({
      aspectRatio: "4:3",
      height: 480,
      providers: ["youtube", "google_drive"],
    });
  });

  it.each(schemas)(
    "%s schema defaults missing embed options to an empty options object",
    (_name, schema) => {
      const parsed = schema.parse({
        slug: "demo",
        name: "Demo",
        type: "embed",
      });
      expect(parsed).toMatchObject({ slug: "demo", type: "embed", options: {} });
    },
  );

  it.each(schemas)("%s schema rejects unsupported aspect ratios and heights", (_name, schema) => {
    expect(() =>
      schema.parse({
        ...validEmbedField,
        options: { embed: { aspectRatio: "21:9" } },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...validEmbedField,
        options: { embed: { height: 0 } },
      }),
    ).toThrow();
    expect(() =>
      schema.parse({
        ...validEmbedField,
        options: { embed: { height: 1201 } },
      }),
    ).toThrow();
  });
});
