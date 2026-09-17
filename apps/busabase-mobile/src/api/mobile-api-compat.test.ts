import { describe, expect, it } from "vitest";
import {
  createMobileCompatibilityFetch,
  isMissingRouteError,
  normalizeLegacyCommitPayloads,
} from "./mobile-api-compat";

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

describe("isMissingRouteError", () => {
  it.each([
    ["the oRPC code", { code: "NOT_FOUND", message: "Not Found" }],
    ["a bare 404 status", { status: 404, message: "" }],
  ])("reads %s as a server that predates the route", (_label, caught) => {
    expect(isMissingRouteError(caught)).toBe(true);
  });

  it.each([
    ["a refusal the server meant", { code: "FORBIDDEN", status: 403 }],
    ["a transport failure", new Error("Network request failed")],
    ["a validation error", { code: "BAD_REQUEST", status: 400 }],
    ["a gateway timeout", { code: "TIMEOUT", status: 504 }],
    ["a bare string", "NOT_FOUND"],
  ])("does not read %s as a missing route", (_label, caught) => {
    expect(isMissingRouteError(caught)).toBe(false);
  });

  it("does not mistake a real install failure that merely says 404", () => {
    // Observed against a running server: installing a repo that does not exist
    // answers BAD_REQUEST/400 with a message reading "GitHub repo or ref not
    // found: acme/thing (HTTP 404)". Matching on wording would send the caller
    // to replay it on the legacy route.
    expect(
      isMissingRouteError({
        code: "BAD_REQUEST",
        status: 400,
        message: "GitHub repo or ref not found: busabase/nope (HTTP 404).",
      }),
    ).toBe(false);
  });
});
