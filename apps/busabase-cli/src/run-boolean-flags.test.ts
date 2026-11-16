import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./run.js";

/** A boolean body field has an "off" form, not just "on". */
describe("boolean body flags", () => {
  let server: Server;
  let baseUrl: string;
  const bodies: unknown[] = [];

  beforeEach(async () => {
    bodies.length = 0;
    server = createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
      });
      req.on("end", () => {
        bodies.push(raw ? JSON.parse(raw) : null);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ appId: "nod_app", enabled: false, appName: null }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const putSettings = (flag: string) =>
    runCli([
      "app-users",
      "put-settings",
      "--app-id",
      "nod_app",
      flag,
      "--base-url",
      baseUrl,
      "--api-key",
      "test_key",
      "--space-id",
      "spc_test",
      "--output",
      "json",
      "--retries",
      "0",
    ]);

  it("--no-enabled sends enabled: false (turning app sign-in off)", async () => {
    expect(await putSettings("--no-enabled")).toBe(0);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ enabled: false });
  });

  it("--enabled still sends enabled: true", async () => {
    expect(await putSettings("--enabled")).toBe(0);
    expect(bodies[0]).toMatchObject({ enabled: true });
  });
});
