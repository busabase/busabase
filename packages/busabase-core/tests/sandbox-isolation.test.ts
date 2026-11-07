/**
 * A function must not be able to stall the server it runs on. It runs on a
 * worker thread, so the main thread keeps serving while it computes, and at
 * its deadline the worker is terminated — a busy loop and a promise that never
 * settles both end there.
 */
import { describe, expect, it } from "vitest";
import { runFunction } from "../src/domains/webhook/logic/sandbox";

/** Run `fn` while counting how often a 50 ms timer on this thread gets to fire. */
const whileCountingTicks = async <T>(fn: () => Promise<T>) => {
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 50);
  const started = Date.now();
  try {
    const value = await fn();
    return { value, ticks, elapsed: Date.now() - started };
  } finally {
    clearInterval(timer);
  }
};

describe("function isolation", () => {
  it("keeps the main thread serving while a function spins, and stops it at the deadline", async () => {
    const { value, ticks, elapsed } = await whileCountingTicks(() =>
      runFunction("while (true) {}", {}, 1500),
    );
    expect(value.error).toBe("Function execution timed out after 1500ms");
    // About 30 ticks in 1.5 s; on the main thread it used to be 0.
    expect(ticks).toBeGreaterThan(15);
    expect(elapsed).toBeLessThan(4000);
  });

  it("stops a function waiting on a promise that never settles", async () => {
    const { value, elapsed } = await whileCountingTicks(() =>
      runFunction("await new Promise(() => {}); return 1;", {}, 1000),
    );
    expect(value.error).toBe("Function execution timed out after 1000ms");
    expect(elapsed).toBeLessThan(3000);
  });

  it("still returns results, logs, and errors as before", async () => {
    const ok = await runFunction(
      'console.log("hi", input.n); return { double: input.n * 2 };',
      { n: 21 },
      5000,
    );
    expect(ok).toEqual({ result: { double: 42 }, logs: "hi 21", error: null });

    const thrown = await runFunction('throw new Error("nope");', {}, 5000);
    expect(thrown.error).toBe("nope");

    const nothing = await runFunction("const x = 1;", {}, 5000);
    expect(nothing.error).toBeNull();
    expect(nothing.result).toBeUndefined();

    const syntax = await runFunction("return {", {}, 5000);
    expect(syntax.error).toBeTruthy();
  });

  it("runs several functions at once without one blocking the others", async () => {
    const started = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => runFunction(`return ${index};`, {}, 5000)),
    );
    expect(results.map((result) => result.result)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
