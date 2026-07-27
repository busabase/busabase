import { ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { encodeBusabaseOpenApiError } from "../src/openapi/error-envelope";

/**
 * Both servers (`apps/busabase` and `apps/busabase-cloud`) mount the same
 * contract, so an SDK or agent talking to either one has to see the same error
 * shape. They had drifted — each app carried its own copy of this encoder, and
 * the open-source one returned a self-shaped body verbatim, dropping `code`.
 *
 * These are shape assertions on the shared function. The end-to-end proof that
 * a real HTTP response carries the shape lives in
 * `apps/busabase-cloud/tests/openapi-error-envelope.test.ts`.
 */
describe("busabase /api/v1 error envelope", () => {
  it("carries code and data alongside the message", () => {
    const error = new ORPCError("BAD_REQUEST", {
      message: "Input validation failed",
      data: { issues: [{ path: ["slug"], message: "Required" }] },
    });

    expect(encodeBusabaseOpenApiError(error)).toEqual({
      error: "Input validation failed",
      code: "BAD_REQUEST",
      data: { issues: [{ path: ["slug"], message: "Required" }] },
    });
  });

  it("keeps code when a handler shaped its own error body", () => {
    // This is the regression. A handler that sets `data.error` takes the
    // self-shaped-body branch; returning that body verbatim is what used to
    // strip the code, degrading every such error to a bare `HTTP_<status>` for
    // SDK consumers branching on the documented codes.
    const encoded = encodeBusabaseOpenApiError(
      new ORPCError("FORBIDDEN", {
        message: "Not a member of the requested space",
        data: { error: "Not a member of the requested space (x-busabase-space)" },
      }),
    );

    expect(encoded).toMatchObject({
      code: "FORBIDDEN",
      error: "Not a member of the requested space (x-busabase-space)",
    });
  });

  it("lets the handler's own fields win over the merged code", () => {
    // Merging can only add information, never overwrite what the handler chose.
    const encoded = encodeBusabaseOpenApiError({
      code: "INTERNAL_SERVER_ERROR",
      message: "ignored",
      data: { error: "Upstream refused", code: "UPSTREAM_REFUSED" },
    });

    expect(encoded).toEqual({ error: "Upstream refused", code: "UPSTREAM_REFUSED" });
  });

  it("falls back to a generic message when the error carries none", () => {
    expect(encodeBusabaseOpenApiError({ code: "INTERNAL_SERVER_ERROR" })).toEqual({
      error: "Internal server error",
      code: "INTERNAL_SERVER_ERROR",
      data: undefined,
    });
  });
});
