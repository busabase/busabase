/**
 * Doc body size cap — a Doc's body is written unbounded today, and every
 * edit's full body is ALSO duplicated forever into `busabase_commits.fields`
 * (no pruning). This doesn't solve unbounded history growth over many edits,
 * only the pathological single-huge-Doc case: a hard byte cap on any one
 * write, checked in real UTF-8 byte length (not JS string `.length`, which
 * undercounts multi-byte CJK content).
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

// 300_000 bytes ≈ 100,000 CJK characters (3 bytes/char in UTF-8) — one char
// past the cap.
const oversizedCjkBody = "字".repeat(100_001);
const normalBody = "# A perfectly normal-sized Doc\n\nSome content.\n";

describe("Doc body size cap (byte-length, UTF-8-aware)", () => {
  it("rejects an oversized body on createDoc (autoMerge: true) with PAYLOAD_TOO_LARGE", async () => {
    await seedScenario("doc-body-cap-create");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await expect(
      raw.docs.create({ slug: "huge", name: "Huge", body: oversizedCjkBody, autoMerge: true }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversized body on updateDocBody with PAYLOAD_TOO_LARGE", async () => {
    await seedScenario("doc-body-cap-update");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "normal", name: "Normal", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");

    await expect(
      raw.docs.updateBody({ nodeId: doc.node.id, body: oversizedCjkBody }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects an oversized body on createDocChangeRequest (review-first path) before creating any CR", async () => {
    await seedScenario("doc-body-cap-cr");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({ slug: "reviewed", name: "Reviewed", autoMerge: true });
    if ("status" in doc) throw new Error("Expected materialized DocVO");

    await expect(
      raw.docs.createChangeRequest({ nodeId: doc.node.id, body: oversizedCjkBody }),
    ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });

    // Rejected before any CR was ever created — no pending review left behind.
    const changeRequests = await raw.changeRequests.list({});
    expect(
      changeRequests.some((cr) => cr.node?.id === doc.node.id && cr.status === "in_review"),
    ).toBe(false);
  });

  it("still accepts a normal-sized body on all three write paths", async () => {
    await seedScenario("doc-body-cap-normal");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const doc = await raw.docs.create({
      slug: "fine",
      name: "Fine",
      body: normalBody,
      autoMerge: true,
    });
    if ("status" in doc) throw new Error("Expected materialized DocVO");
    expect(doc.body).toBe(normalBody);

    const updated = await raw.docs.updateBody({ nodeId: doc.node.id, body: `${normalBody}more\n` });
    expect(updated.body).toBe(`${normalBody}more\n`);

    const cr = await raw.docs.createChangeRequest({ nodeId: doc.node.id, body: normalBody });
    expect(cr.status).toBe("in_review");
  });
});
