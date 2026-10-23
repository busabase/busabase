import { vi } from "vitest";

/** Just enough CacheStorage for the AirApp dependency cache: one cache, keyed by URL. */
export const createFakeCacheStorage = () => {
  const entries = new Map<string, ArrayBuffer>();
  const cache = {
    match: vi.fn(async (key: string) => {
      const body = entries.get(key);
      return body ? new Response(body.slice(0)) : undefined;
    }),
    put: vi.fn(async (key: string, response: Response) => {
      entries.set(key, await response.arrayBuffer());
    }),
    delete: vi.fn(async (key: string) => entries.delete(key)),
  };
  return { entries, cache, storage: { open: vi.fn(async () => cache) } };
};
