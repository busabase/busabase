import "@testing-library/jest-dom/vitest";

// jsdom has no real object URL implementation. kui's PromptInput calls
// URL.createObjectURL for every staged attachment, then (on submit) fetches
// that same URL back to convert it to a data URL. A registry backing both
// calls gives tests a genuinely working round trip instead of a stub that
// only silences the "not a function" crash while leaving the conversion
// permanently failing (kui falls back to the unconverted blob URL on a
// failed fetch, which would make every attachment-send test either mock
// fetch itself or accept a same, unrealistic blob: URL instead of the real
// data: URL the app actually receives in a browser).
const blobUrlRegistry = new Map<string, Blob>();
let blobUrlCounter = 0;

if (typeof URL.createObjectURL !== "function") {
  URL.createObjectURL = (blob: Blob) => {
    const url = `blob:mock-${blobUrlCounter++}`;
    blobUrlRegistry.set(url, blob);
    return url;
  };
}
if (typeof URL.revokeObjectURL !== "function") {
  URL.revokeObjectURL = (url: string) => {
    blobUrlRegistry.delete(url);
  };
}

const realFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : (input as Request | URL).toString();
  const blob = blobUrlRegistry.get(url);
  if (blob) return new Response(blob);
  if (!realFetch) throw new Error(`No real fetch available and no mock blob registered for ${url}`);
  return realFetch(input, init);
}) as typeof fetch;
