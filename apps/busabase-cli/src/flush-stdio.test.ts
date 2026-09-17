import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { flushStdio } from "./flush-stdio.js";

/**
 * A stream that acknowledges writes only when told to, standing in for a pipe whose
 * reader has not drained it yet. A real `process.stdout` on a pipe behaves this way;
 * on a file or TTY it does not, which is exactly why the bug only showed up for
 * callers who piped.
 */
/** `vi.spyOn(process, "stdout")` is typed as the real descriptor, so a stand-in has to
 * carry the same literal `fd` the runtime one does. */
type StdStream<Fd extends 1 | 2> = NodeJS.WriteStream & { fd: Fd };

const backedUpStream = <Fd extends 1 | 2>(fd: Fd) => {
  const pending: Array<() => void> = [];
  let released = false;
  const stream = new PassThrough() as unknown as StdStream<Fd> & {
    writableLength: number;
    release: () => void;
  };
  Object.defineProperty(stream, "fd", { value: fd, configurable: true });
  Object.defineProperty(stream, "writableLength", { value: 4096, configurable: true });
  stream.write = ((_chunk: unknown, cb?: () => void) => {
    // Acknowledge immediately once released, so a write that arrives AFTER the
    // release still completes — otherwise the second stream flushStdio reaches
    // would wait forever on a callback nobody is left to fire.
    if (typeof cb === "function") {
      if (released) cb();
      else pending.push(cb);
    }
    return true;
  }) as typeof stream.write;
  stream.release = () => {
    released = true;
    for (const cb of pending.splice(0)) cb();
  };
  return stream;
};

describe("flushStdio", () => {
  it("waits for a backed-up stream instead of returning immediately", async () => {
    const stdout = backedUpStream(1);
    const stderr = backedUpStream(2);
    vi.spyOn(process, "stdout", "get").mockReturnValue(stdout);
    vi.spyOn(process, "stderr", "get").mockReturnValue(stderr);

    let settled = false;
    const flushing = flushStdio().then(() => {
      settled = true;
    });

    // Nothing has drained yet, so exiting here is exactly what truncated the output.
    await Promise.resolve();
    expect(settled).toBe(false);

    stdout.release();
    stderr.release();
    await flushing;
    expect(settled).toBe(true);
    vi.restoreAllMocks();
  });

  it("returns without queueing anything when both streams are already drained", async () => {
    // The common case — a one-line result to a TTY. It must not add a turn of latency
    // or, worse, hang waiting for a callback on a stream with nothing to flush.
    const drained = <Fd extends 1 | 2>(fd: Fd) => {
      const stream = new PassThrough() as unknown as StdStream<Fd>;
      Object.defineProperty(stream, "fd", { value: fd, configurable: true });
      Object.defineProperty(stream, "writableLength", { value: 0, configurable: true });
      stream.write = (() => {
        throw new Error("must not write to an already-drained stream");
      }) as typeof stream.write;
      return stream;
    };
    vi.spyOn(process, "stdout", "get").mockReturnValue(drained(1));
    vi.spyOn(process, "stderr", "get").mockReturnValue(drained(2));
    await expect(flushStdio()).resolves.toBeUndefined();
    vi.restoreAllMocks();
  });
});
