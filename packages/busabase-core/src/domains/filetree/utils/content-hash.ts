/** Older uploads persisted bare SHA-256 digests; expose the same baseline format everywhere. */
export const normalizeContentHash = (hash: string | null): string | null =>
  hash !== null && /^[a-f0-9]{64}$/.test(hash) ? `sha256:${hash}` : hash;
