import { describe, expect, it } from "vitest";
import {
  CliHttpError,
  CliOutcomeError,
  classifyError,
  EXIT_CODES,
  errorEnvelope,
  formatErrorMessage,
  isRouteMissing,
} from "./errors";

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
      serverCode: "NOT_FOUND",
      retryable: false,
      safeToRetry: false,
    });
  });

  it("omits `status` entirely when the request never reached a server", () => {
    const envelope = errorEnvelope(classifyError(new TypeError("fetch failed")));
    expect(envelope).not.toHaveProperty("status");
    expect(envelope.retryable).toBe(true);
  });
});

describe("safe diagnostics and retry guidance", () => {
  const finding = { path: "tests/fixture.mjs", ruleName: "generic-api-key-assignment" };
  const scannerBody = {
    error: "secret source must not appear",
    code: "SECRET_DETECTED",
    data: {
      findings: [{ ...finding, matchedValue: "secret-value", source: "secret-source" }],
      issues: [{ path: ["credential"], message: "secret-issue" }],
      source: "secret-extra",
    },
  };

  it.each(["raw", "typed"])("strips terminal and bidirectional path controls for %s", (kind) => {
    const body = {
      ...scannerBody,
      data: {
        findings: [
          {
            path: "src/\u0000\u001f\u007f\u009f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069config.ts",
            ruleName: finding.ruleName,
          },
        ],
      },
    };
    const error =
      kind === "raw"
        ? new CliHttpError(422, "Unprocessable Entity", JSON.stringify(body))
        : Object.assign(new Error(body.error), {
            status: 422,
            code: body.code,
            data: body.data,
          });
    const result = errorEnvelope(classifyError(error));
    expect(result.findings).toEqual([{ path: "src/config.ts", ruleName: finding.ruleName }]);
    expect(formatErrorMessage(error)).toContain("src/config.ts");
    expect(JSON.stringify(result) + formatErrorMessage(error)).not.toMatch(
      /[\u202a-\u202e\u2066-\u2069]/,
    );
  });

  it.each(["raw", "typed"])("preserves only safe scanner fields for %s", (kind) => {
    const error =
      kind === "raw"
        ? new CliHttpError(422, "Unprocessable Entity", JSON.stringify(scannerBody))
        : Object.assign(new Error(scannerBody.error), {
            status: 422,
            code: scannerBody.code,
            data: scannerBody.data,
          });
    const envelope = errorEnvelope(
      classifyError(error, { request: { method: "POST", status: 422, requestId: "request-123" } }),
    );
    expect(envelope).toMatchObject({
      code: "VALIDATION",
      status: 422,
      serverCode: "SECRET_DETECTED",
      findings: [finding],
      requestId: "request-123",
      retryable: false,
      safeToRetry: false,
      writeOutcome: "rejected",
    });
    expect(envelope).not.toHaveProperty("issues");
    const rendered = JSON.stringify(envelope) + formatErrorMessage(error);
    for (const forbidden of [
      "secret source",
      "secret-value",
      "secret-source",
      "secret-issue",
      "secret-extra",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
    expect(envelope.message).toContain(finding.path);
    expect(envelope.message).toContain(finding.ruleName);
  });

  it("does not print unknown JSON error bodies or malformed finding objects", () => {
    const error = new CliHttpError(
      422,
      "",
      JSON.stringify({
        data: { findings: [{ path: {}, ruleName: "not a rule", matchedValue: "secret" }] },
        secret: "private",
      }),
    );
    const result = errorEnvelope(classifyError(error));
    expect(result.message).toBe("HTTP 422 : Request failed");
    expect(result).not.toHaveProperty("findings");
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it.each([
    ['{"message":"Bad gateway upstream timed out"}'],
    ['{"detail":"quota exceeded"}'],
    ["[1,2]"],
    ['{"error":{"msg":"x"}}'],
    ["<html>502</html>"],
  ])("keeps a non-envelope error body readable: %s", (body) => {
    expect(new CliHttpError(502, "Bad Gateway", body).message).toBe(
      `HTTP 502 Bad Gateway: ${body}`,
    );
  });

  it("bounds a very long raw error body", () => {
    const message = new CliHttpError(502, "Bad Gateway", "x".repeat(5_000)).message;
    expect(message.length).toBeLessThan(600);
    expect(message.endsWith("…")).toBe(true);
  });

  it("does not label a local Node error code as a server code", () => {
    const error = Object.assign(new Error("File not found"), { code: "ENOENT" });
    expect(classifyError(error)).not.toHaveProperty("serverCode");
  });

  it("does not attach an earlier successful response trace to a later local failure", () => {
    const result = classifyError(new Error("Browser-relative upload URL"), {
      request: { method: "POST", status: 200, requestId: "successful-upload-url" },
    });
    expect(result).not.toHaveProperty("requestId");
  });

  it("does not attach a trace when an unobserved failure has a different HTTP status", () => {
    const result = classifyError(orpc(503, "UNAVAILABLE", "Storage failed"), {
      request: { method: "POST", status: 200, requestId: "successful-upload-url" },
    });
    expect(result).not.toHaveProperty("requestId");
  });

  it("does not attribute concurrent sibling failures using the last request", () => {
    const result = classifyError(orpc(503, "SERVICE_UNAVAILABLE", "Upload failed"), {
      request: {
        method: "POST",
        status: 503,
        requestId: "different-sibling",
        ambiguous: true,
      },
    });
    expect(result).toMatchObject({
      code: "SERVER_ERROR",
      status: 503,
      retryable: true,
      safeToRetry: false,
    });
    expect(result).not.toHaveProperty("requestId");
    expect(result).not.toHaveProperty("writeOutcome");
  });

  it.each([
    ["POST", 400, false, "rejected"],
    ["PATCH", 409, false, "rejected"],
    ["POST", 422, false, "rejected"],
    ["POST", 429, true, "rejected"],
    ["POST", 500, false, "unknown"],
    ["POST", 408, false, "unknown"],
    ["GET", 500, true, undefined],
  ])(
    "%s %i distinguishes a transient error from a safe retry",
    (method, status, safeToRetry, writeOutcome) => {
      const result = classifyError(orpc(status as number, "ERROR", "failed"), {
        request: { method: method as string },
      });
      expect(result.safeToRetry).toBe(safeToRetry);
      expect(result.writeOutcome).toBe(writeOutcome);
    },
  );

  it("does not suggest repeating a write whose connection dropped", () => {
    const failure = new TypeError("fetch failed");
    const write = classifyError(failure, { request: { method: "POST" } });
    expect(write).toMatchObject({ retryable: true, safeToRetry: false, writeOutcome: "unknown" });
    const read = classifyError(failure, { request: { method: "GET" } });
    expect(read).toMatchObject({ retryable: true, safeToRetry: true });
    expect(read).not.toHaveProperty("writeOutcome");
  });

  it("does not invite replaying a command after its write succeeded but readback failed", () => {
    const result = classifyError(new TypeError("fetch failed"), {
      request: { method: "GET", priorWrite: true },
    });
    expect(result).toMatchObject({ retryable: true, safeToRetry: false });
    expect(result).not.toHaveProperty("writeOutcome");
  });

  it("only marks a write not_sent when its intended method is known", () => {
    expect(classifyError(new Error("Invalid JSON"), { intendedMethod: "PATCH" })).toMatchObject({
      writeOutcome: "not_sent",
      safeToRetry: false,
    });
    expect(classifyError(new Error("Invalid JSON"))).not.toHaveProperty("writeOutcome");
  });

  it.each(["TIMEOUT", "REVIEW_REJECTED"] as const)(
    "does not turn %s after submission into a failed write",
    (code) => {
      const result = classifyError(new CliOutcomeError(code, "Review is not merged"), {
        request: { method: "POST", status: 200 },
        intendedMethod: "POST",
      });
      expect(result).not.toHaveProperty("writeOutcome");
      expect(result.safeToRetry).toBe(false);
    },
  );
});

describe("isRouteMissing", () => {
  const error = (fields: Record<string, unknown>) => Object.assign(new Error("x"), fields);

  it("recognises the router fallback the SDK decodes without a code", () => {
    expect(isRouteMissing(error({ status: 404, code: "HTTP_404" }))).toBe(true);
  });

  it("recognises a 404 whose body was not a Busabase error envelope", () => {
    expect(
      isRouteMissing(error({ status: 404, code: "NOT_FOUND", data: { body: "Not Found" } })),
    ).toBe(true);
  });

  it("never mistakes a procedure's own NOT_FOUND for a missing route", () => {
    expect(isRouteMissing(error({ status: 404, code: "NOT_FOUND" }))).toBe(false);
    expect(
      isRouteMissing(
        error({
          status: 404,
          code: "NOT_FOUND",
          data: { body: { error: "x", code: "NOT_FOUND" } },
        }),
      ),
    ).toBe(false);
    expect(isRouteMissing(error({ status: 403, code: "HTTP_403" }))).toBe(false);
    expect(isRouteMissing("boom")).toBe(false);
  });
});
