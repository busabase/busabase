import { describe, expect, it } from "vitest";
import { busabaseContractRoutes } from "./busabase";
import {
  CreateEmbedLinkInputSchema,
  EmbedFramePolicyVOSchema,
  EmbedNodeTypeSchema,
  ListEmbedLinksPagedInputSchema,
} from "./embed-link-schemas";

describe("embed link expiry", () => {
  it.each(["node", "change-request", "record-detail"] as const)(
    "supports multi-day %s links through seven days",
    (type) => {
      for (const days of [3, 4, 5, 7]) {
        const expiresInMinutes = days * 24 * 60;
        const input = { type, typeId: "target_1", expiresInMinutes };
        expect(CreateEmbedLinkInputSchema.parse(input).expiresInMinutes).toBe(expiresInMinutes);
        expect(
          busabaseContractRoutes.embedLinks.create["~orpc"].inputSchema?.parse(input)
            .expiresInMinutes,
        ).toBe(expiresInMinutes);
      }
    },
  );

  it.each(["node", "change-request", "record-detail"] as const)(
    "keeps the existing default and shorter durations for %s links",
    (type) => {
      expect(CreateEmbedLinkInputSchema.parse({ type, typeId: "target_1" }).expiresInMinutes).toBe(
        15,
      );
      for (const expiresInMinutes of [1, 60, 1440]) {
        expect(
          CreateEmbedLinkInputSchema.parse({ type, typeId: "target_1", expiresInMinutes })
            .expiresInMinutes,
        ).toBe(expiresInMinutes);
      }
    },
  );

  it.each(["node", "change-request", "record-detail"] as const)(
    "rejects invalid and over-seven-day durations for %s links",
    (type) => {
      for (const expiresInMinutes of [0, -1, 1.5, 7200.5, 10081, 30 * 24 * 60]) {
        const input = { type, typeId: "target_1", expiresInMinutes };
        expect(CreateEmbedLinkInputSchema.safeParse(input).success).toBe(false);
        expect(
          busabaseContractRoutes.embedLinks.create["~orpc"].inputSchema?.safeParse(input).success,
        ).toBe(false);
      }
    },
  );
});

describe("embed frame policy input", () => {
  it("publishes embed-link CRUD and audit routes on the shared Desktop and tunnel contract", () => {
    expect(busabaseContractRoutes.embedLinks.create["~orpc"].route).toMatchObject({
      method: "POST",
      path: "/embed-links",
    });
    expect(busabaseContractRoutes.embedLinks.list["~orpc"].route).toMatchObject({
      method: "GET",
      path: "/embed-links",
    });
    expect(busabaseContractRoutes.embedLinks.listPaged["~orpc"].route).toMatchObject({
      method: "GET",
      path: "/embed-links/paged",
    });
    expect(busabaseContractRoutes.embedLinks.revoke["~orpc"].route).toMatchObject({
      method: "DELETE",
      path: "/embed-links/{id}",
    });
  });

  it("accepts only a CR id for the narrow preview route", () => {
    const procedure = busabaseContractRoutes.changeRequests.createPreviewLink["~orpc"];
    expect(procedure.route).toMatchObject({
      method: "POST",
      path: "/change-requests/{changeRequestId}/preview-link",
    });
    const input = procedure.inputSchema;
    expect(input?.safeParse({ changeRequestId: "crq_1" }).success).toBe(true);
    for (const extra of [
      { type: "node", typeId: "nod_1" },
      { expiresInMinutes: 1440 },
      { framePolicy: { mode: "anywhere", allowedOrigins: [] } },
    ]) {
      expect(input?.safeParse({ changeRequestId: "crq_1", ...extra }).success).toBe(false);
    }
  });

  it("defaults the audit page to active links and keeps its limit bounded", () => {
    expect(ListEmbedLinksPagedInputSchema.parse({})).toEqual({ status: "active", limit: 50 });
    expect(ListEmbedLinksPagedInputSchema.parse({ status: "all", limit: "100" })).toEqual({
      status: "all",
      limit: 100,
    });
    expect(ListEmbedLinksPagedInputSchema.safeParse({ status: "all", limit: 101 }).success).toBe(
      false,
    );
  });

  it("accepts AirApps as embeddable nodes", () => {
    expect(EmbedNodeTypeSchema.parse("airapp")).toBe("airapp");
  });
  it("defaults to embedding anywhere", () => {
    expect(
      CreateEmbedLinkInputSchema.parse({ type: "node", typeId: "node_1" }).framePolicy,
    ).toEqual({
      mode: "anywhere",
      allowedOrigins: [],
    });
  });

  it.each(["node", "change-request", "record-detail"] as const)(
    "accepts the %s embed target",
    (type) => {
      expect(CreateEmbedLinkInputSchema.parse({ type, typeId: "target_1" })).toMatchObject({
        type,
        typeId: "target_1",
      });
    },
  );

  it("requires both parts of the polymorphic target", () => {
    expect(CreateEmbedLinkInputSchema.safeParse({ type: "node" }).success).toBe(false);
    expect(CreateEmbedLinkInputSchema.safeParse({ typeId: "node_1" }).success).toBe(false);
  });

  it("normalizes exact origins and removes duplicates", () => {
    expect(
      CreateEmbedLinkInputSchema.parse({
        type: "node",
        typeId: "node_1",
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
        type: "node",
        typeId: "node_1",
        framePolicy: { mode: "origins", allowedOrigins: [origin] },
      }).success,
    ).toBe(false);
  });

  it("allows loopback HTTP only for local cross-origin tests", () => {
    expect(
      CreateEmbedLinkInputSchema.parse({
        type: "node",
        typeId: "node_1",
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
        type: "node",
        typeId: "node_1",
        framePolicy: { mode: "origins", allowedOrigins: [] },
      }).success,
    ).toBe(false);
    expect(
      CreateEmbedLinkInputSchema.safeParse({
        type: "node",
        typeId: "node_1",
        framePolicy: { mode: "top-level-only", allowedOrigins: ["https://agent.example"] },
      }).success,
    ).toBe(false);
    expect(
      EmbedFramePolicyVOSchema.safeParse({ mode: "origins", allowedOrigins: [] }).success,
    ).toBe(false);
  });
});
