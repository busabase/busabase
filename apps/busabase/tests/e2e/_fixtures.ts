import { type APIResponse, test as base } from "@playwright/test";

// Why this file exists:
// busabase's `/dashboard/*` is a force-dynamic catch-all page (`app/dashboard/
// [[...slug]]/page.tsx`) that renders a client SPA and *streams* its RSC response.
// The document therefore never fires the `load` (or `domcontentloaded`) event, so
// Playwright's `page.goto`, which defaults to `waitUntil: "load"`, hangs until the
// test times out — even though the content mounts within a second or two.
//
// We default every navigation to `waitUntil: "commit"` (resolves as soon as the
// response starts). The specs' existing web-first assertions
// (`expect(locator).toBeVisible()`) then wait for the streamed content to mount.
// Callers can still pass their own options to override per-call. This covers
// goto/reload/goBack/goForward — reload and goBack default to "load" too, so they
// would hang on the streamed dashboard just like goto.
export const test = base.extend({
  page: async ({ page }, use) => {
    const nativeGoto = page.goto.bind(page);
    page.goto = ((url: string, options?: Parameters<typeof nativeGoto>[1]) =>
      nativeGoto(url, { waitUntil: "commit", ...options })) as typeof page.goto;

    for (const method of ["reload", "goBack", "goForward"] as const) {
      const native = page[method].bind(page);
      page[method] = ((options?: Parameters<typeof native>[0]) =>
        native({ waitUntil: "commit", ...options })) as (typeof page)[typeof method];
    }

    await use(page);
  },
});

export type { APIRequestContext, APIResponse, Page } from "@playwright/test";
export { expect } from "@playwright/test";

// Shared API helper: throw on a non-2xx response (surfacing its status + body) so a
// failed request fails fast, otherwise return the parsed JSON. `ok`/`status` are
// APIResponse METHODS — call them, don't read them as properties.
export const json = async <T>(response: APIResponse): Promise<T> => {
  if (!response.ok()) {
    throw new Error(`${response.status()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
};

// Unique-ish suffix for titles created by the write specs, so records/CRs from
// repeated runs don't collide in the shared dev DB.
export const unique = (prefix: string) =>
  `${prefix} ${Date.now()} ${Math.floor(Math.random() * 1000)}`;
