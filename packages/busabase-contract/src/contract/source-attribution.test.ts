import { describe, expect, expectTypeOf, it } from "vitest";
import type { SourceAttributionVO } from "../types";
import { auditEventSchema, changeRequestSchema, sourceAttributionSchema } from "./schemas";

describe("source attribution contract", () => {
  it("accepts the safe public attribution shape", () => {
    const parsed = sourceAttributionSchema.parse({
      displayName: "Codex",
      ownerName: "Leon",
      channel: "mcp",
    });
    expect(parsed).toEqual({ displayName: "Codex", ownerName: "Leon", channel: "mcp" });
    expectTypeOf(parsed).toMatchTypeOf<SourceAttributionVO>();
  });

  it("keeps sourceAttribution optional for older wire responses", () => {
    expect(changeRequestSchema.shape.sourceAttribution.safeParse(undefined).success).toBe(true);
    expect(auditEventSchema.shape.sourceAttribution.safeParse(undefined).success).toBe(true);
  });
});
