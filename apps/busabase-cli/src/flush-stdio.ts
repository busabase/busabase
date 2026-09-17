/**
 * Wait for stdout/stderr to reach the other side before the process is torn down.
 *
 * `process.exit()` discards whatever is still buffered. That is harmless when stdout
 * is a file or a TTY — Node writes those synchronously — but a PIPE is asynchronous,
 * so exiting immediately after a large `console.log` delivers only what happened to
 * fit in the pipe buffer and drops the rest, with a zero exit code either way.
 *
 * The symptom is brutal to diagnose because it depends on the caller, not the command:
 *
 *     busabase-cli skills read-file … --output json > body.json   # 41970 bytes
 *     busabase-cli skills read-file … --output json | jq .content #  8192 bytes
 *
 * and 8192 is one pipe buffer, so the JSON simply stops mid-string. Anyone piping a
 * large skill or record body into a parser gets a parse error that reads like a server
 * problem. It has been misattributed to stale CLI versions before; the version is
 * irrelevant, the destination is everything.
 *
 * Writing an empty chunk with a callback is the portable way to ask "is everything I
 * queued delivered?" — the callback fires after the stream has flushed what preceded
 * it. A stream that is already drained resolves without queueing anything.
 */
const flush = (stream: NodeJS.WriteStream): Promise<void> =>
  new Promise((resolve) => {
    if (stream.writableLength === 0) {
      resolve();
      return;
    }
    stream.write("", () => resolve());
  });

export const flushStdio = async (): Promise<void> => {
  await flush(process.stdout);
  await flush(process.stderr);
};
