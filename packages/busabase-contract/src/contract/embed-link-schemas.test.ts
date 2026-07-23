import { describe, expect, it } from "vitest";
import {
  CreateEmbedLinkInputSchema,
  EmbedFramePolicyVOSchema,
  EmbedNodeTypeSchema,
} from "./embed-link-schemas";

describe("embed frame policy input", () => {
  it("accepts AirApps as embeddable nodes", () => {
    expect(EmbedNodeTypeSchema.parse("airapp")).toBe("airapp");
  });
  it("defaults to embedding anywhere", () => {
    expect(CreateEmbedLinkInputSchema.parse({ nodeId: "node_1" }).framePolicy).toEqual({
      mode: "anywhere",
      allowedOrigins: [],
    });
  });

  it("normalizes exact origins and removes duplicates", () => {
    expect(
      CreateEmbedLinkInputSchema.parse({
        nodeId: "node_1",
        framePolicy: {
          mode: "origins",
          allowedOrigins: ["https://AGENT.example:443/", "https://agent.example"],
        },
      }).framePolicy,
    ).toEqual({ mode: "origins", allowedOrigins: ["https://agent.example"] });
  });

  it.each([
    "http://agent.example",
    "https://agent.example/path",
    "https://agent.example?token=secret",
    "https://*.agent.example",
    "https://user:pass@agent.example",
  ])("rejects a non-origin value: %s", (origin) => {
    expect(
      CreateEmbedLinkInputSchema.safeParse({
        nodeId: "node_1",
        framePolicy: { mode: "origins", allowedOrigins: [origin] },
      }).success,
    ).toBe(false);
  });

  it("allows loopback HTTP only for local cross-origin tests", () => {
    expect(
      CreateEmbedLinkInputSchema.parse({
        nodeId: "node_1",
        framePolicy: {
          mode: "origins",
          allowedOrigins: ["http://127.0.0.1:4173/", "http://localhost:4174"],
        },
      }).framePolicy.allowedOrigins,
    ).toEqual(["http://127.0.0.1:4173", "http://localhost:4174"]);
  });

  it("requires origins only for origins mode", () => {
    expect(
      CreateEmbedLinkInputSchema.safeParse({
        nodeId: "node_1",
        framePolicy: { mode: "origins", allowedOrigins: [] },
      }).success,
    ).toBe(false);
    expect(
      CreateEmbedLinkInputSchema.safeParse({
        nodeId: "node_1",
        framePolicy: { mode: "top-level-only", allowedOrigins: ["https://agent.example"] },
      }).success,
    ).toBe(false);
    expect(
      EmbedFramePolicyVOSchema.safeParse({ mode: "origins", allowedOrigins: [] }).success,
    ).toBe(false);
  });
});
