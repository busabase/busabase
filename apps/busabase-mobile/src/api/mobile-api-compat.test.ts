import { describe, expect, it } from "vitest";
import { createMobileCompatibilityFetch, normalizeLegacyCommitPayloads } from "./mobile-api-compat";

const legacyCommit = {
  id: "cmt_legacy",
  operation: "record_create",
  message: "Create record",
  author: "agent",
  parentCommitId: null,
  fields: { title: "Legacy response" },
};

describe("normalizeLegacyCommitPayloads", () => {
  it("adds payload to legacy commits nested in an RPC envelope", () => {
    expect(
      normalizeLegacyCommitPayloads({ json: { operations: [{ headCommit: legacyCommit }] } }),
    ).toMatchObject({
      json: {
        operations: [
          {
            headCommit: {
              fields: { title: "Legacy response" },
              payload: { title: "Legacy response" },
            },
          },
        ],
      },
    });
  });

  it("does not reinterpret Base field collections or overwrite current commits", () => {
    const currentCommit = { ...legacyCommit, payload: { title: "Current response" } };
    const value = {
      base: { id: "base_1", fields: [{ slug: "title" }] },
      headCommit: currentCommit,
    };
    expect(normalizeLegacyCommitPayloads(value)).toEqual(value);
  });

  it("drops stale body headers when rebuilding a JSON response", async () => {
    const compatibilityFetch = createMobileCompatibilityFetch(async () =>
      Promise.resolve(
        new Response(JSON.stringify({ headCommit: legacyCommit }), {
          headers: {
            "content-encoding": "gzip",
            "content-length": "12",
            "content-type": "application/json",
            "x-request-id": "req_1",
          },
        }),
      ),
    );

    const response = await compatibilityFetch(
      new Request("https://example.com/api/rpc"),
      {},
      { context: {} },
      [],
      undefined,
    );

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-request-id")).toBe("req_1");
    await expect(response.json()).resolves.toMatchObject({
      headCommit: { payload: { title: "Legacy response" } },
    });
  });
});
