import { ErrorEvent, encodeEventMessage, getEventMeta } from "@orpc/standard-server";

const ENCODE_CHARS = 64 * 1024;

/**
 * The snapshot's existing SSE wire, encoded in bounded pieces. Node 24's
 * TextEncoderStream builds a character-by-character concatenation before it
 * encodes a chunk; a single escaped 133 MiB event exhausts the default heap.
 * TextEncoder.encode avoids that intermediate chain of character strings.
 */
export const snapshotEventStream = (
  iterator: AsyncIterator<unknown, unknown, void>,
  options: { keepAliveInterval?: number } = {},
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const keepAliveInterval = options.keepAliveInterval ?? 5000;
  let frame = encodeEventMessage({ comments: [""] });
  let offset = 0;
  let terminal = false;
  let cancelled = false;
  let pending: Promise<IteratorResult<unknown, unknown>> | undefined;

  const clearFrame = () => {
    frame = "";
    offset = 0;
  };
  const enqueuePiece = (controller: ReadableStreamDefaultController<Uint8Array>) => {
    let end = Math.min(offset + ENCODE_CHARS, frame.length);
    // TextEncoder handles unpaired surrogates normally, but a valid pair
    // split across slices must remain one code point on the wire.
    if (end < frame.length) {
      const last = frame.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
    }
    controller.enqueue(encoder.encode(frame.slice(offset, end)));
    offset = end;
    if (offset === frame.length) {
      clearFrame();
      if (terminal) controller.close();
    }
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (!frame) {
            pending ??= Promise.resolve(iterator.next());
            let timeout: ReturnType<typeof setTimeout> | undefined;
            const next = await Promise.race([
              pending.then((value) => ({ kind: "next" as const, value })),
              new Promise<{ kind: "keepAlive" }>((resolve) => {
                timeout = setTimeout(() => resolve({ kind: "keepAlive" }), keepAliveInterval);
              }),
            ]).finally(() => clearTimeout(timeout));
            if (cancelled) return;
            if (next.kind === "keepAlive") {
              frame = encodeEventMessage({ comments: [""] });
            } else {
              pending = undefined;
              const { done, value } = next.value;
              const meta = getEventMeta(value);
              terminal = done === true;
              if (done && value === undefined && meta === undefined) {
                controller.close();
                return;
              }
              frame = encodeEventMessage({
                ...meta,
                event: done ? "done" : "message",
                data: JSON.stringify(value),
              });
            }
          }
          enqueuePiece(controller);
        } catch (error) {
          pending = undefined;
          clearFrame();
          if (cancelled) return;
          if (error instanceof ErrorEvent) {
            frame = encodeEventMessage({
              ...getEventMeta(error),
              event: "error",
              data: JSON.stringify(error.data),
            });
            terminal = true;
            // Error envelopes are small; their bytes follow the same bounded
            // pull path as messages, including unusual metadata/content.
            enqueuePiece(controller);
            return;
          }
          controller.error(error);
        }
      },
      async cancel() {
        cancelled = true;
        clearFrame();
        pending = undefined;
        await iterator.return?.();
      },
    },
    // Do not prepare the next SQL event while downstream holds an encoded one.
    { highWaterMark: 0 },
  );
};
