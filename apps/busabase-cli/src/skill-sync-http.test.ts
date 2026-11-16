import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateNodeMetadataInputSchema } from "busabase-contract/contract/schemas";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { scanForSecrets } from "../../../packages/busabase-core/src/logic/upload-safety";
import { encodeBusabaseOpenApiError } from "../../../packages/busabase-core/src/openapi/error-envelope";
import { runCli } from "./run";

vi.mock("server-only", () => ({}));

type RequestRecord = { method: string; url: string; body: unknown };
type ReplyMode = "scanner" | "success" | "disconnect" | "server-error";

describe("Skill write diagnostics over real local HTTP", () => {
  let server: Server;
  let baseUrl: string;
  let isolatedHome: string;
  let mode: ReplyMode = "scanner";
  const requests: RequestRecord[] = [];
  const fixtureValue = ["synthetic", "onboarding", "credential"].join("-");
  const operations = [
    {
      kind: "create",
      path: "tests/fixture.mjs",
      content: `const fixture = { ACEMUSIC_API_KEY: '${fixtureValue}' };`,
    },
  ];

  beforeAll(async () => {
    isolatedHome = await mkdtemp(join(tmpdir(), "busabase-cli-http-"));
    vi.stubEnv("HOME", isolatedHome);
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("BUSABASE_")) vi.stubEnv(key, undefined);
    }
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: request.method ?? "GET", url: request.url ?? "", body });
      if (mode === "disconnect") {
        request.socket.destroy();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.setHeader("x-request-id", "isolated-http-request");
      if (mode === "server-error") {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "Service unavailable", code: "SERVICE_UNAVAILABLE" }));
        return;
      }
      if (mode === "scanner") {
        try {
          scanForSecrets(body.operations);
        } catch (error) {
          const rejection = error as {
            status: number;
            code: string;
            message: string;
            data: { findings: Array<{ path: string; ruleName: string }> };
          };
          response.statusCode = rejection.status;
          response.end(
            JSON.stringify(
              encodeBusabaseOpenApiError({
                ...rejection,
                message: rejection.message,
                data: {
                  ...rejection.data,
                  findings: rejection.data.findings.map((finding) => ({
                    ...finding,
                    match: fixtureValue,
                    source: operations[0].content,
                  })),
                  privateDebug: fixtureValue,
                },
              }),
            ),
          );
          return;
        }
      }
      if (request.method === "PATCH") {
        const parsed = updateNodeMetadataInputSchema.safeParse({ ...body, nodeId: "nod_isolated" });
        if (!parsed.success) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "Input validation failed", code: "BAD_REQUEST" }));
          return;
        }
      }
      response.end(JSON.stringify({ ok: true, metadata: body }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    requests.length = 0;
    mode = "scanner";
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    vi.unstubAllEnvs();
    await rm(isolatedHome, { recursive: true, force: true });
  });

  const invoke = async (args: string[]) => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const stderr = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const exitCode = await runCli([
        "--base-url",
        baseUrl,
        "--output",
        "json",
        "--retries",
        "0",
        ...args,
      ]);
      return {
        exitCode,
        stdout: stdout.mock.calls.map((call) => call.join(" ")).join("\n"),
        stderr: stderr.mock.calls.map((call) => call.join(" ")).join("\n"),
      };
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  };

  const rawWrite = () => [
    "api",
    "--method",
    "post",
    "--path",
    "/file-trees/nod_isolated/change-requests",
    "--body-json",
    JSON.stringify({ operations }),
  ];
  const typedWrite = () => [
    "skills",
    "create-change-request",
    "--node-id",
    "nod_isolated",
    "--operations-json",
    JSON.stringify(operations),
  ];

  it.each([
    ["raw", rawWrite],
    ["typed", typedWrite],
  ] as const)(
    "%s preserves real scanner diagnostics without exposing response extras",
    async (_label, args) => {
      const result = await invoke(args());
      expect(result.exitCode).toBe(5);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        code: "VALIDATION",
        status: 422,
        serverCode: "SECRET_DETECTED",
        findings: [{ path: "tests/fixture.mjs", ruleName: "generic-api-key-assignment" }],
        requestId: "isolated-http-request",
        retryable: false,
        safeToRetry: false,
        writeOutcome: "rejected",
      });
      expect(result.stderr).toContain("tests/fixture.mjs");
      expect(result.stderr).toContain("generic-api-key-assignment");
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(fixtureValue);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain("const fixture");
      expect(requests).toHaveLength(1);
    },
  );

  it("sends the metadata HTTP wrapper in raw PATCH", async () => {
    mode = "success";
    const metadata = { sourceSnapshotSha256: "snapshot", automaticSync: false };
    const result = await invoke([
      "api",
      "--method",
      "patch",
      "--path",
      "/nodes/nod_isolated/metadata",
      "--body-json",
      JSON.stringify({ metadata }),
    ]);
    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([
      { method: "PATCH", url: "/api/v1/nodes/nod_isolated/metadata", body: { metadata } },
    ]);
  });

  it("wraps a flat typed metadata flag into the same HTTP body", async () => {
    mode = "success";
    const result = await invoke([
      "nodes",
      "update-metadata",
      "--node-id",
      "nod_isolated",
      "--metadata-json",
      '{"automaticSync":false}',
    ]);
    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([
      {
        method: "PATCH",
        url: "/api/v1/nodes/nod_isolated/metadata",
        body: { metadata: { automaticSync: false } },
      },
    ]);
  });

  it("reports the real schema refusal when raw PATCH omits the metadata wrapper", async () => {
    mode = "success";
    const result = await invoke([
      "api",
      "--method",
      "patch",
      "--path",
      "/nodes/nod_isolated/metadata",
      "--body-json",
      '{"automaticSync":false}',
    ]);
    expect(result.exitCode).toBe(5);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 400,
      serverCode: "BAD_REQUEST",
      safeToRetry: false,
      writeOutcome: "rejected",
    });
  });

  it("suppresses PATCH in dry-run and preserves structured PATCH errors", async () => {
    const args = [
      "api",
      "--method",
      "patch",
      "--path",
      "/nodes/nod_isolated/metadata",
      "--body-json",
      '{"metadata":{"automaticSync":false}}',
    ];
    const preview = await invoke([...args, "--dry-run"]);
    expect(preview.exitCode).toBe(0);
    expect(JSON.parse(preview.stdout)).toMatchObject({
      serverValidated: false,
      wouldSend: { method: "PATCH", body: { metadata: { automaticSync: false } } },
    });
    expect(requests).toEqual([]);
    mode = "server-error";
    const failure = await invoke(args);
    expect(failure.exitCode).toBe(8);
    expect(JSON.parse(failure.stdout)).toMatchObject({
      status: 503,
      serverCode: "SERVICE_UNAVAILABLE",
      requestId: "isolated-http-request",
      safeToRetry: false,
      writeOutcome: "unknown",
    });
    expect(requests).toHaveLength(1);
  });

  it.each([
    ["raw", rawWrite],
    ["typed", typedWrite],
  ] as const)(
    "%s dry-run never reaches the server or claims server validation",
    async (_label, args) => {
      const result = await invoke([...args(), "--dry-run"]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        dryRun: true,
        serverValidated: false,
        wouldSend: { method: "POST" },
      });
      expect(requests).toEqual([]);
    },
  );

  it.each([
    { label: "raw", args: rawWrite, failure: "disconnect" },
    { label: "raw", args: rawWrite, failure: "server-error" },
    { label: "typed", args: typedWrite, failure: "disconnect" },
    { label: "typed", args: typedWrite, failure: "server-error" },
  ] as const)(
    "marks a $label write with $failure as unknown and unsafe to repeat",
    async ({ args, failure }) => {
      mode = failure;
      const result = await invoke(args());
      expect(result.exitCode).not.toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        retryable: true,
        safeToRetry: false,
        writeOutcome: "unknown",
      });
      expect(requests).toHaveLength(1);
      expect(result.stderr).toMatch(/unknown|reconcil|check/i);
    },
  );
});
