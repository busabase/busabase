/** Bound the SDK's SSE decoder to complete frames and reject malformed UTF-8. */
const SNAPSHOT_PATH = "/dump/export/snapshot";
export const MAX_SNAPSHOT_FRAME_BYTES = 256 * 1024 * 1024;

export class SnapshotUtf8Error extends Error {
  constructor(cause: unknown) {
    super("SQL snapshot contains invalid UTF-8; no archive was published.", { cause });
    this.name = "SnapshotUtf8Error";
  }
}

export function withStrictSnapshotTransport(
  fetcher: typeof fetch,
  maxFrameBytes = MAX_SNAPSHOT_FRAME_BYTES,
): typeof fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input : input.url,
    );
    if (!url.pathname.endsWith(SNAPSHOT_PATH) || !response.ok || !response.body) return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let segments: Uint8Array[] = [];
    let bytes = 0;
    let lineBytes = 0;
    let skipLeadingLf = false;
    let terminalFrame: Uint8Array | undefined;
    const frames: Uint8Array[] = [];
    const append = (part: Uint8Array) => {
      if (!part.length) return;
      bytes += part.length;
      if (bytes > maxFrameBytes)
        throw new Error(
          `SQL snapshot SSE frame exceeds ${maxFrameBytes} bytes; reduce its page size.`,
        );
      segments.push(part);
    };
    const finishFrame = () => {
      const frame = new Uint8Array(bytes);
      let offset = 0;
      for (const part of segments) {
        frame.set(part, offset);
        offset += part.length;
      }
      segments = [];
      bytes = 0;
      if (terminalFrame) {
        if (frame.some((byte) => ![9, 10, 13, 32].includes(byte)))
          throw new Error("SQL snapshot has non-empty data after the terminal SSE frame.");
        return;
      }
      const buffer = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      let line = 0;
      let eventName: string | undefined;
      let hasData = false;
      while (line < buffer.length) {
        const newline = buffer.indexOf(10, line);
        const end = newline === -1 ? buffer.length : newline;
        const field = buffer.subarray(line, Math.min(line + 5, end)).toString("ascii");
        if (field === "data:" || (end - line === 4 && field === "data")) hasData = true;
        if (buffer.subarray(line, Math.min(line + 6, end)).toString("ascii") === "event:") {
          eventName = buffer
            .subarray(line + 6, end)
            .toString("utf8")
            .replace(/^\s/, "");
        }
        line = end + 1;
      }
      if (hasData && eventName !== undefined && !["message", "error", "done"].includes(eventName))
        throw new Error(`SQL snapshot used an unsupported SSE data event: ${eventName}`);
      if (eventName === "done") {
        terminalFrame = frame;
        return;
      }
      if (hasData && eventName === undefined) {
        // SSE defaults to message; make that explicit for the SDK decoder.
        const prefix = new TextEncoder().encode("event: message\n");
        const explicit = new Uint8Array(prefix.length + frame.length);
        explicit.set(prefix);
        explicit.set(frame, prefix.length);
        frames.push(explicit);
      } else frames.push(frame);
    };
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (frames.length === 0) {
            const { value, done } = await reader.read();
            if (done) {
              try {
                decoder.decode();
              } catch (error) {
                throw new SnapshotUtf8Error(error);
              }
              if (bytes || lineBytes)
                throw new Error("SQL snapshot stream ended inside an SSE frame.");
              if (terminalFrame) controller.enqueue(terminalFrame);
              controller.close();
              return;
            }
            try {
              decoder.decode(value, { stream: true });
            } catch (error) {
              throw new SnapshotUtf8Error(error);
            }
            const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
            if (chunk.length === 0) continue;
            let cursor = 0;
            if (skipLeadingLf && chunk[0] === 10) cursor = 1;
            skipLeadingLf = false;
            while (cursor < chunk.length) {
              const lf = chunk.indexOf(10, cursor),
                cr = chunk.indexOf(13, cursor);
              const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
              if (end < 0) {
                append(value.subarray(cursor));
                lineBytes += chunk.length - cursor;
                break;
              }
              append(value.subarray(cursor, end));
              lineBytes += end - cursor;
              append(Uint8Array.of(10));
              if (lineBytes === 0) finishFrame();
              lineBytes = 0;
              cursor = end + 1;
              if (chunk[end] === 13) {
                if (cursor < chunk.length && chunk[cursor] === 10) cursor++;
                else if (cursor === chunk.length) skipLeadingLf = true;
              }
            }
          }
          controller.enqueue(frames.shift() as Uint8Array);
        } catch (error) {
          await reader.cancel(error).catch(() => {});
          controller.error(error);
        }
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    });
    return new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}
