import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./run";
import { SPACE_WELCOME_UNSUPPORTED } from "./space-welcome-command";

const withServer = async (
  handler: RequestListener,
  run: (baseArgs: string[]) => Promise<void>,
): Promise<{ stdout: string[]; stderr: string[] }> => {
  const server = createServer(handler);
  const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
  const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address() as AddressInfo;
    await run([
      "--base-url",
      `http://127.0.0.1:${address.port}`,
      "--api-key",
      "integration-fixture-key",
      "--space-id",
      "spc_acme",
      "--output",
      "json",
      "space-welcome",
    ]);
    return {
      stdout: stdout.mock.calls.map((call) => String(call[0])),
      stderr: stderr.mock.calls.map((call) => String(call[0])),
    };
  } finally {
    stdout.mockRestore();
    stderr.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

describe("space welcome CLI", () => {
  it("reads, sets and clears the welcome page for the selected space with version checks", async () => {
    let stored: { nodeId: string | null; version: number } = { nodeId: null, version: 0 };
    const requests: Array<{ method?: string; path?: string; space?: string; body?: unknown }> = [];
    const output = await withServer(
      async (request, response) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
        requests.push({
          method: request.method,
          path: request.url,
          space: request.headers["x-busabase-space"] as string | undefined,
          ...(body ? { body } : {}),
        });
        response.setHeader("content-type", "application/json");
        if (request.method === "PUT") {
          if (body.expectedVersion !== stored.version) {
            response.statusCode = 409;
            response.end(JSON.stringify({ code: "CONFLICT", error: "Welcome page changed." }));
            return;
          }
          stored = { nodeId: body.nodeId, version: stored.version + 1 };
        }
        response.end(
          JSON.stringify({ spaceId: "spc_acme", ...stored, updatedAt: "2026-10-30T00:00:00.000Z" }),
        );
      },
      async (args) => {
        expect(await runCli([...args, "get"])).toBe(0);
        expect(
          await runCli([...args, "set", "--node", "nod_guide", "--expected-version", "0"]),
        ).toBe(0);
        expect(stored).toEqual({ nodeId: "nod_guide", version: 1 });
        // A stale version is refused without overwriting the other manager's choice.
        expect(
          await runCli([...args, "set", "--node", "nod_other", "--expected-version", "0"]),
        ).toBe(6);
        expect(stored).toEqual({ nodeId: "nod_guide", version: 1 });
        // A dry run sends nothing.
        const sentBeforeDryRun = requests.length;
        expect(
          await runCli([...args, "set", "--clear", "--expected-version", "1", "--dry-run"]),
        ).toBe(0);
        expect(requests).toHaveLength(sentBeforeDryRun);
        // `update` is the contract's own name for the same command.
        expect(await runCli([...args, "update", "--clear", "--expected-version", "1"])).toBe(0);
        expect(stored).toEqual({ nodeId: null, version: 2 });
      },
    );
    expect(requests).toEqual([
      { method: "GET", path: "/api/v1/space-welcome", space: "spc_acme" },
      {
        method: "PUT",
        path: "/api/v1/space-welcome",
        space: "spc_acme",
        body: { nodeId: "nod_guide", expectedVersion: 0 },
      },
      {
        method: "PUT",
        path: "/api/v1/space-welcome",
        space: "spc_acme",
        body: { nodeId: "nod_other", expectedVersion: 0 },
      },
      {
        method: "PUT",
        path: "/api/v1/space-welcome",
        space: "spc_acme",
        body: { nodeId: null, expectedVersion: 1 },
      },
    ]);
    expect(JSON.parse(output.stdout[0] ?? "{}")).toMatchObject({ nodeId: null, version: 0 });
  });

  it("tells the user to upgrade an old server that has no welcome route, once, without retrying", async () => {
    let hits = 0;
    const output = await withServer(
      (_request, response) => {
        hits += 1;
        // What an older server's router answers for a route it does not have.
        response.statusCode = 404;
        response.setHeader("content-type", "text/plain");
        response.end("Not Found");
      },
      async (args) => {
        expect(await runCli([...args, "get"])).toBe(4);
        expect(
          await runCli([...args, "set", "--node", "nod_guide", "--expected-version", "0"]),
        ).toBe(4);
      },
    );
    expect(hits).toBe(2);
    expect(output.stderr.join("\n")).toContain(SPACE_WELCOME_UNSUPPORTED);
    expect(output.stdout.join("\n")).toContain("does not support the space welcome page yet");
  });

  it("rejects a missing or doubled target before making a request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = ["--base-url", "http://127.0.0.1:1", "--api-key", "fixture-key", "space-welcome"];
    try {
      expect(await runCli([...args, "set", "--expected-version", "0"])).not.toBe(0);
      expect(
        await runCli([...args, "set", "--node", "nod_1", "--clear", "--expected-version", "0"]),
      ).not.toBe(0);
      expect(await runCli([...args, "set", "--node", "  ", "--expected-version", "0"])).not.toBe(0);
      expect(await runCli([...args, "set", "--clear", "--expected-version", "-1"])).not.toBe(0);
      expect(await runCli([...args, "set", "--node", "nod_1"])).not.toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
