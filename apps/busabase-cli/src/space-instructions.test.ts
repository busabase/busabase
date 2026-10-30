import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./run";

describe("space instructions CLI", () => {
  it("reads the selected workspace over HTTP and fetches the newest version on a later task", async () => {
    let version = 0;
    const calls: Array<{ method?: string; path?: string; space?: string }> = [];
    const server = createServer((request, response) => {
      calls.push({
        method: request.method,
        path: request.url,
        space: request.headers["x-busabase-space"] as string | undefined,
      });
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          spaceId: "spc_acme",
          body: version ? "## Values\nUse evidence before making claims." : "",
          version,
          updatedAt: version ? "2026-10-28T00:00:00.000Z" : null,
        }),
      );
    });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const args = [
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--api-key",
        "integration-fixture-key",
        "--space-id",
        "spc_acme",
        "--output",
        "json",
        "space-instructions",
        "get",
      ];
      expect(await runCli(args)).toBe(0);
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
        body: "",
        version: 0,
      });
      version = 1;
      expect(await runCli(args)).toBe(0);
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject({
        spaceId: "spc_acme",
        body: "## Values\nUse evidence before making claims.",
        version: 1,
      });
      expect(calls).toEqual([
        { method: "GET", path: "/api/v1/space-instructions", space: "spc_acme" },
        { method: "GET", path: "/api/v1/space-instructions", space: "spc_acme" },
      ]);
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("saves an exact Markdown file, preserves stale edits, and clears with an empty body", async () => {
    const directory = await mkdtemp(join(tmpdir(), "busabase-instructions-cli-"));
    const file = join(directory, "instructions.md");
    const markdown = "\n## 愿景\n让小团队掌握工作。\n\n## Design style\nClear and calm.\n";
    await writeFile(file, markdown);
    let stored = { body: "", version: 0 };
    const writes: unknown[] = [];
    const server = createServer(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.method === "PUT") {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const input = JSON.parse(Buffer.concat(chunks).toString()) as {
          body: string;
          expectedVersion: number;
        };
        writes.push(input);
        if (input.expectedVersion !== stored.version) {
          response.statusCode = 409;
          response.end(JSON.stringify({ code: "CONFLICT", error: "Instructions changed." }));
          return;
        }
        stored = { body: input.body, version: stored.version + 1 };
      }
      response.end(
        JSON.stringify({ spaceId: "spc_acme", ...stored, updatedAt: "2026-10-28T00:00:00.000Z" }),
      );
    });
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const address = server.address() as AddressInfo;
      const args = [
        "--base-url",
        `http://127.0.0.1:${address.port}`,
        "--api-key",
        "integration-fixture-key",
        "--space-id",
        "spc_acme",
        "--output",
        "json",
        "space-instructions",
      ];
      expect(await runCli([...args, "update", "--file", file, "--expected-version", "0"])).toBe(0);
      expect(stored).toEqual({ body: markdown, version: 1 });
      expect(writes[0]).toEqual({ body: markdown, expectedVersion: 0 });
      expect(await runCli([...args, "get"])).toBe(0);
      expect(JSON.parse(String(stdout.mock.calls.at(-1)?.[0]))).toMatchObject(stored);
      expect(
        await runCli([...args, "update", "--body", "stale", "--expected-version", "0"]),
      ).not.toBe(0);
      expect(stored).toEqual({ body: markdown, version: 1 });
      const callsBeforeDryRun = writes.length;
      expect(
        await runCli([
          ...args,
          "update",
          "--body",
          "dry-run",
          "--expected-version",
          "1",
          "--dry-run",
        ]),
      ).toBe(0);
      expect(writes).toHaveLength(callsBeforeDryRun);
      expect(await runCli([...args, "update", "--body", "", "--expected-version", "1"])).toBe(0);
      expect(stored).toEqual({ body: "", version: 2 });
      expect(writes.at(-1)).toEqual({ body: "", expectedVersion: 1 });
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects missing or competing text sources before making a request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected request"));
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const args = [
      "--base-url",
      "http://127.0.0.1:1",
      "--api-key",
      "fixture-key",
      "space-instructions",
      "update",
    ];
    try {
      expect(await runCli([...args, "--expected-version", "0"])).not.toBe(0);
      expect(
        await runCli([
          ...args,
          "--body",
          "inline",
          "--file",
          "instructions.md",
          "--expected-version",
          "0",
        ]),
      ).not.toBe(0);
      expect(await runCli([...args, "--body", "inline", "--expected-version", "-1"])).not.toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });
});
