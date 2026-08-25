import { describe, expect, it } from "vitest";
import { classifyError, EXIT_CODES, errorEnvelope } from "./errors";

/** An oRPC failure as the SDK actually throws it — see `ORPCError`. */
const orpc = (status: number, code: string, message: string, issues?: unknown) =>
  Object.assign(new Error(message), { code, status, ...(issues ? { data: { issues } } : {}) });

describe("classifyError", () => {
  it.each([
    [401, "UNAUTHORIZED", "UNAUTHORIZED", EXIT_CODES.UNAUTHORIZED, false],
    [403, "FORBIDDEN", "FORBIDDEN", EXIT_CODES.FORBIDDEN, false],
    [404, "NOT_FOUND", "NOT_FOUND", EXIT_CODES.NOT_FOUND, false],
    [400, "BAD_REQUEST", "VALIDATION", EXIT_CODES.VALIDATION, false],
    [422, "UNPROCESSABLE_CONTENT", "VALIDATION", EXIT_CODES.VALIDATION, false],
    [409, "CONFLICT", "CONFLICT", EXIT_CODES.CONFLICT, false],
    [429, "TOO_MANY_REQUESTS", "RATE_LIMITED", EXIT_CODES.RATE_LIMITED, true],
    [500, "INTERNAL_SERVER_ERROR", "SERVER_ERROR", EXIT_CODES.SERVER_ERROR, true],
    [503, "INTERNAL_SERVER_ERROR", "SERVER_ERROR", EXIT_CODES.SERVER_ERROR, true],
  ])("maps HTTP %i to %s", (status, orpcCode, expected, exitCode, retryable) => {
    const classified = classifyError(orpc(status, orpcCode, "boom"));
    expect(classified.code).toBe(expected);
    expect(classified.status).toBe(status);
    expect(classified.exitCode).toBe(exitCode);
    expect(classified.retryable).toBe(retryable);
  });

  it("classifies a transport failure as retryable NETWORK with no status", () => {
    const classified = classifyError(new TypeError("fetch failed"));
    expect(classified.code).toBe("NETWORK");
    expect(classified.status).toBeUndefined();
    expect(classified.retryable).toBe(true);
    expect(classified.exitCode).toBe(EXIT_CODES.NETWORK);
  });

  it("reads the status back out of a rawFetch message, which carries no `.status`", () => {
    // `rawFetch` (health / openapi / `api` passthrough) throws a plain Error.
    const classified = classifyError(new Error("HTTP 404 Not Found: {}"));
    expect(classified.code).toBe("NOT_FOUND");
    expect(classified.status).toBe(404);
  });

  it("falls back to exit 1 for anything it cannot classify, so `!= 0` scripts are unaffected", () => {
    const classified = classifyError(new Error("something else entirely"));
    expect(classified.code).toBe("ERROR");
    expect(classified.exitCode).toBe(1);
    expect(classified.retryable).toBe(false);
  });

  it("flattens validation issues into path + message", () => {
    const classified = classifyError(
      orpc(400, "BAD_REQUEST", "Input validation failed", [
        { path: ["limit"], message: "Too big: expected number to be <=100" },
      ]),
    );
    expect(classified.issues).toEqual([
      { path: "limit", message: "Too big: expected number to be <=100" },
    ]);
  });
});

describe("errorEnvelope", () => {
  it("is the shape a caller parses instead of the prose", () => {
    expect(errorEnvelope(classifyError(orpc(404, "NOT_FOUND", "Node not found: nod_x")))).toEqual({
      ok: false,
      code: "NOT_FOUND",
      status: 404,
      message: "Node not found: nod_x",
      retryable: false,
    });
  });

  it("omits `status` entirely when the request never reached a server", () => {
    const envelope = errorEnvelope(classifyError(new TypeError("fetch failed")));
    expect(envelope).not.toHaveProperty("status");
    expect(envelope.retryable).toBe(true);
  });
});
