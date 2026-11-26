import type { ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  buildEmbedMetadata,
  changeRequestEmbedTitle,
  EMBED_TRANSPARENT_ICON,
  recordEmbedTitle,
} from "./metadata";

const record = (
  payload: Record<string, unknown>,
  fields = [{ slug: "customer", type: "text", position: 0 }],
) =>
  ({
    id: "rec_internal_identifier",
    base: { name: "Deliveries", fields },
    headCommit: { payload },
  }) as unknown as RecordVO;
const changeRequest = (
  message: string,
  payload: Record<string, unknown> = { customer: "客户 A" },
) => {
  const operation = {
    operation: "record_update",
    headCommit: { message, payload },
    baseFields: null,
  };
  return {
    id: "cr_internal_identifier",
    operationCount: 1,
    primaryOperation: operation,
    operations: [operation],
    base: { name: "Deliveries", fields: [{ slug: "customer", type: "text", position: 0 }] },
    node: null,
  } as unknown as ChangeRequestVO;
};

describe("content-only Embed metadata", () => {
  it("sets an absolute human title and removes inherited product social metadata", () => {
    expect(buildEmbedMetadata("  客户   交付\n说明  ")).toMatchObject({
      title: { absolute: "客户 交付 说明" },
      description: "客户 交付 说明",
      applicationName: "",
      robots: { index: false, follow: false },
      openGraph: null,
      twitter: null,
    });
  });
  it("uses a valid transparent SVG for all favicon variants", () => {
    const icon = buildEmbedMetadata("Document").icons;
    expect(icon.icon.url).toBe(EMBED_TRANSPARENT_ICON);
    expect(icon.shortcut).toBe(EMBED_TRANSPARENT_ICON);
    expect(icon.apple).toBe(EMBED_TRANSPARENT_ICON);
    expect(icon.icon.type).toBe("image/svg+xml");
    const svg = decodeURIComponent(EMBED_TRANSPARENT_ICON.split(",", 2)[1]);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toMatch(/^<svg\s[^>]+\/>$/);
    expect(svg).not.toMatch(/<path|<image|<script/);
  });
  it("keeps unavailable pages brandless too", () => {
    expect(buildEmbedMetadata(null)).toMatchObject({
      title: { absolute: "Content unavailable" },
      description: "",
      applicationName: "",
    });
  });
  it("reads the current primary field rather than guessing title/name keys", () => {
    expect(
      recordEmbedTitle(
        record({ title: "Wrong field", customer: "客户 A" }, [
          { slug: "title", type: "text", position: 8 },
          { slug: "customer", type: "text", position: 0 },
        ]),
      ),
    ).toBe("客户 A");
  });
  it("uses a human fallback for empty records without exposing their identifier", () => {
    expect(recordEmbedTitle(record({ customer: " " }))).toBe("Record");
    expect(recordEmbedTitle(record({}, []))).toBe("Record");
  });
  it("retains valid non-text primary values such as zero", () => {
    expect(
      recordEmbedTitle(
        record({ customer: 0 }, [{ slug: "customer", type: "number", position: 0 }]),
      ),
    ).toBe("0");
  });
  it("prefers the author's explanation for change requests", () => {
    expect(changeRequestEmbedTitle(changeRequest("Update delivery date"))).toBe(
      "Update delivery date",
    );
  });
  it("uses the display subject when the commit message is boilerplate", () => {
    const cr = changeRequest("Initial change request");
    expect(changeRequestEmbedTitle(cr)).toContain("客户 A");
    cr.primaryOperation = null;
    expect(changeRequestEmbedTitle(cr)).toContain("客户 A");
  });
  it("falls back to a human node/base title, never operation or commit ids", () => {
    const cr = changeRequest("Initial change request", {});
    expect(changeRequestEmbedTitle(cr)).toBe("Deliveries");
    cr.base = null;
    expect(changeRequestEmbedTitle(cr)).toBe("Change request");
  });
  it("describes multi-operation changes without leaking identifiers", () => {
    const cr = changeRequest("Initial change request");
    cr.operationCount = 3;
    expect(changeRequestEmbedTitle(cr)).toBe("3 operation change request");
  });
});
