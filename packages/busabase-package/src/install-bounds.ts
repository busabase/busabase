/** Keep file uploads and record requests below the limits of a normal HTTP host. */
export const FILE_UPLOAD_CONCURRENCY = 8;
export const RECORD_BATCH_TARGET_BYTES = 8 * 1024 * 1024;
export const RECORD_REQUEST_MAX_BYTES = 64 * 1024 * 1024;

/**
 * Preserve input order and wait for in-flight work before rejecting. A failed
 * upload must not leave its siblings running after the install rolls back.
 */
export const mapWithConcurrency = async <Input, Output>(
  items: readonly Input[],
  limit: number,
  run: (item: Input) => Promise<Output>,
): Promise<Output[]> => {
  const result = new Array<Output>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (!failed && next < items.length) {
        const index = next++;
        try {
          result[index] = await run(items[index]);
        } catch (error) {
          failed = true;
          failure ??= error;
        }
      }
    }),
  );
  if (failed) throw failure;
  return result;
};

export interface RecordRequestEntry {
  key: string;
  fields: Record<string, unknown>;
}

/**
 * JSON arrays have one comma between entries. `envelopeBytes` includes the
 * empty records array and the largest metadata envelope the caller will use.
 * Count bytes, not JavaScript characters: Chinese text and JSON escapes matter.
 */
export const splitRecordRequests = <Entry extends RecordRequestEntry>(
  entries: readonly Entry[],
  envelopeBytes: number,
  label: string,
  limits = {
    targetBytes: RECORD_BATCH_TARGET_BYTES,
    maxBytes: RECORD_REQUEST_MAX_BYTES,
  },
): Entry[][] => {
  const batches: Entry[][] = [];
  let batch: Entry[] = [];
  let bytes = envelopeBytes;
  for (const entry of entries) {
    const entryBytes = Buffer.byteLength(JSON.stringify(entry.fields), "utf8");
    if (entryBytes + envelopeBytes > limits.maxBytes) {
      throw new Error(
        `Record "${entry.key}" in Base "${label}" needs ${entryBytes + envelopeBytes} bytes in one request, above the ${limits.maxBytes}-byte install limit. Split its large field content before installing. Nothing from this record was sent.`,
      );
    }
    const addedBytes = entryBytes + (batch.length > 0 ? 1 : 0);
    if (batch.length > 0 && bytes + addedBytes > limits.targetBytes) {
      batches.push(batch);
      batch = [];
      bytes = envelopeBytes;
    }
    batch.push(entry);
    bytes += entryBytes + (batch.length > 1 ? 1 : 0);
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
};
