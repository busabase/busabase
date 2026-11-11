import { describe, expect, it } from "vitest";
import { mapWithConcurrency, splitRecordRequests } from "./install-bounds";

describe("record request bytes", () => {
  it("accounts for multibyte content, JSON escapes, commas and the request envelope", () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
      key: `row-${index}`,
      fields: { title: '报告\n"' },
    }));
    const envelopeBytes = Buffer.byteLength(JSON.stringify({ records: [], message: "导入" }));
    const one = Buffer.byteLength(JSON.stringify(entries[0].fields));
    const batches = splitRecordRequests(entries, envelopeBytes, "reports", {
      targetBytes: envelopeBytes + one * 2,
      maxBytes: 1000,
    });
    // Two records need an additional comma: fitting two character counts would
    // send a larger actual UTF-8 request than the advertised boundary.
    expect(batches.map((batch) => batch.length)).toEqual([1, 1, 1]);
    expect(batches.flat()).toEqual(entries);
  });

  it("keeps a large but supported record alone instead of dropping or splitting its fields", () => {
    const entries = [
      { key: "small", fields: { title: "one" } },
      { key: "large", fields: { title: "x".repeat(300) } },
      { key: "last", fields: { title: "two" } },
    ];
    const batches = splitRecordRequests(entries, 20, "reports", {
      targetBytes: 100,
      maxBytes: 400,
    });
    expect(batches.map((batch) => batch.map((entry) => entry.key))).toEqual([
      ["small"],
      ["large"],
      ["last"],
    ]);
  });

  it("names an over-limit record and Base without sending an incomplete payload", () => {
    expect(() =>
      splitRecordRequests(
        [{ key: "huge-report", fields: { title: "x".repeat(300) } }],
        100,
        "reports",
        { targetBytes: 100, maxBytes: 400 },
      ),
    ).toThrow(/huge-report.*reports.*412 bytes.*400-byte/);
  });
});

describe("bounded uploads", () => {
  it("bounds the complete async operation and preserves package file order", async () => {
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const running = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
      return value * 10;
    });
    expect(releases).toHaveLength(2);
    releases.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(releases).toHaveLength(2);
    while (active > 0) {
      releases.shift()?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(await running).toEqual([0, 10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it("drains in-flight uploads before propagating failure and stops scheduling more", async () => {
    let releaseSibling: (() => void) | undefined;
    const started: number[] = [];
    let settled = false;
    const running = mapWithConcurrency([0, 1, 2], 2, async (value) => {
      started.push(value);
      if (value === 0) throw new Error("upload refused");
      await new Promise<void>((resolve) => {
        releaseSibling = resolve;
      });
      return value;
    });
    const observed = running.catch((error) => {
      settled = true;
      return error.message;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(started).toEqual([0, 1]);
    releaseSibling?.();
    expect(await observed).toBe("upload refused");
    expect(started).toEqual([0, 1]);
  });
});
