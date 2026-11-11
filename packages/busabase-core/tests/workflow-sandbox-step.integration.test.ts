/**
 * A Function step's code on a real Sandock: provisioning, the JavaScript and
 * Python runners, packages, the code's own errors, a failed install, and the
 * time limit. Runs only when a Sandock is reachable, for example a local one:
 *
 *   SANDBOX_PROVIDER=DOCKER PORT=3170 pnpm --filter sandock-server dev
 *   BUSABASE_TEST_SANDOCK_URL=http://localhost:3170 pnpm exec vitest run tests/workflow-sandbox-step.integration.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const sandockUrl = process.env.BUSABASE_TEST_SANDOCK_URL;
const { pollSandboxFunction, startSandboxFunction, stopSandboxFunction } = await import(
  "../src/domains/workflow/logic/sandbox-step"
);
type Call = Parameters<typeof startSandboxFunction>[0];

const started: string[] = [];
const previous = { key: process.env.SANDOCK_API_KEY, url: process.env.SANDOCK_BASE_URL };

beforeAll(() => {
  process.env.SANDOCK_API_KEY = process.env.SANDOCK_API_KEY || "local";
  process.env.SANDOCK_BASE_URL = sandockUrl;
});

afterAll(async () => {
  for (const id of started) await stopSandboxFunction(id);
  process.env.SANDOCK_API_KEY = previous.key;
  process.env.SANDOCK_BASE_URL = previous.url;
});

const call = (overrides: Partial<Call>): Call =>
  ({
    stepId: "step",
    code: "return null",
    language: "javascript",
    packages: "",
    input: { payload: { text: "hello" } },
    timeoutMs: 120_000,
    ...overrides,
  }) as Call;

/** Start, then poll the way the scheduler does until the code is done. */
const runToEnd = async (overrides: Partial<Call>, maxMs = 240_000) => {
  const { sandboxId } = await startSandboxFunction(call(overrides));
  started.push(sandboxId);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const polled = await pollSandboxFunction(sandboxId);
    if (polled.done) {
      await stopSandboxFunction(sandboxId);
      return polled;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("the code did not finish in time");
};

describe.skipIf(!sandockUrl)("sandbox code step on a real Sandock", () => {
  it("runs JavaScript with Node's crypto and an npm package, and returns its value", async () => {
    const polled = await runToEnd({
      packages: "dayjs@1.11.13",
      code: `const crypto = require("node:crypto");
const dayjs = require("dayjs");
console.log("signing", input.payload.text);
return {
  signature: crypto.createHmac("sha256", "secret").update(input.payload.text).digest("hex"),
  year: dayjs("2026-11-07").year(),
};`,
    });
    expect(polled).toEqual({
      done: true,
      ok: true,
      result: {
        signature: "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b",
        year: 2026,
      },
      logs: "signing hello",
    });
  }, 300_000);

  it("runs Python with a pip package, with a top-level return", async () => {
    const polled = await runToEnd({
      language: "python",
      packages: "six==1.16.0",
      code: `import six
text = input["payload"]["text"]
note = """two
lines"""
print("got", text)
return {"upper": text.upper(), "six": six.__version__, "note": note}`,
    });
    expect(polled).toEqual({
      done: true,
      ok: true,
      result: { upper: "HELLO", six: "1.16.0", note: "two\nlines" },
      logs: "got hello\n",
    });
  }, 300_000);

  it("reports the code's own error", async () => {
    const polled = await runToEnd({ code: `throw new Error("bad padding");` });
    expect(polled).toMatchObject({ done: true, ok: false, message: "bad padding" });
  }, 300_000);

  it("reports a package that does not install", async () => {
    const polled = await runToEnd({
      packages: "this-package-does-not-exist-busabase-test",
      code: "return 1",
    });
    expect(polled.done && !polled.ok && polled.message).toContain("Installing packages failed");
  }, 300_000);

  it("stops code that runs past its time", async () => {
    const polled = await runToEnd({ code: "while (true) {}", timeoutMs: 3_000 });
    expect(polled).toMatchObject({ done: true, ok: false, message: "The code ran out of time" });
  }, 300_000);
});
