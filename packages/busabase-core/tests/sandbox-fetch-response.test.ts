/**
 * Code in a function (a workflow step or a webhook rule) is written against the
 * standard fetch, so the sandbox's answer must support `json()`, `text()`, and
 * `headers.get()` — and keep the plain `status` / `ok` / `body` fields older
 * functions read.
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runFunction } from "../src/domains/webhook/logic/sandbox";

let base = "";
const server = createServer((req, res) => {
  if (req.url === "/long") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ text: "x".repeat(40_000) }));
    return;
  }
  res.writeHead(200, { "content-type": "application/json", "x-request-id": "req-1" });
  res.end(JSON.stringify({ reply: "hello", path: req.url }));
});
const previousAllow = process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = `127.0.0.1:${port}`;
});

afterAll(async () => {
  process.env.BUSABASE_WEBHOOK_TEST_ALLOW_TARGETS = previousAllow;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("fetch inside a function", () => {
  it("answers like the standard fetch: json(), text(), and headers.get()", async () => {
    const ran = await runFunction(
      `const res = await fetch("${base}/agent");
       const data = await res.json();
       const again = await res.text();
       return {
         reply: data.reply,
         sameText: again === JSON.stringify(data),
         requestId: res.headers.get("X-Request-Id"),
         missing: res.headers.get("nope"),
         ok: res.ok,
         status: res.status,
       };`,
      {},
      10_000,
    );
    expect(ran.error).toBeNull();
    expect(ran.result).toEqual({
      reply: "hello",
      sameText: true,
      requestId: "req-1",
      missing: null,
      ok: true,
      status: 200,
    });
  });

  it("keeps the plain fields older functions read", async () => {
    const ran = await runFunction(
      `const res = await fetch("${base}/legacy");
       return { status: res.status, path: JSON.parse(res.body).path, keys: Object.keys(res.headers).includes("get") };`,
      {},
      10_000,
    );
    expect(ran.error).toBeNull();
    expect(ran.result).toEqual({ status: 200, path: "/legacy", keys: false });
  });

  it("says so when an answer was too long to parse, instead of a bare JSON error", async () => {
    const ran = await runFunction(
      `const res = await fetch("${base}/long"); return await res.json();`,
      {},
      10_000,
    );
    expect(ran.error).toContain("longer than 32000 characters");
  });
});
