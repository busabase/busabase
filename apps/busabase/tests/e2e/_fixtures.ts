import {
  type APIRequestContext,
  type APIResponse,
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";
import type { ChangeRequestVO, RecordVO, ViewVO } from "busabase-contract/types";

// Why this file exists:
// busabase's `/dashboard/local/*` is a force-dynamic catch-all page (`app/dashboard/[spaceId]/
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

export const dragSortableTo = async (page: Page, source: Locator, target: Locator) => {
  const sourceBox = await source.boundingBox();
  if (!sourceBox) {
    throw new Error("Sortable source must be visible before dragging");
  }

  const sourcePoint = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  };
  const sourceRow = source.locator("xpath=ancestor::*[@data-view-field-slug][1]");
  const sourceSlug = await sourceRow.getAttribute("data-view-field-slug");
  const targetSlug = await target.getAttribute("data-view-field-slug");
  const initialOrder = await sourceRow.evaluate((row) =>
    Array.from(row.parentElement?.children ?? [])
      .map((child) => child.getAttribute("data-view-field-slug"))
      .filter((slug): slug is string => slug !== null),
  );
  if (!sourceSlug || !targetSlug) {
    throw new Error("Sortable source and target must expose field slugs");
  }
  const sourceStartedBeforeTarget =
    initialOrder.indexOf(sourceSlug) < initialOrder.indexOf(targetSlug);
  await page.mouse.move(sourcePoint.x, sourcePoint.y);
  await page.mouse.down();
  await page.mouse.move(sourcePoint.x, sourcePoint.y - 10, { steps: 4 });
  await expect(sourceRow).toHaveAttribute("data-dragging", "true");

  const targetBox = await target.boundingBox();
  if (!targetBox) {
    await page.mouse.up();
    throw new Error("Sortable target must remain visible while dragging");
  }
  await page.mouse.move(sourcePoint.x, targetBox.y + targetBox.height / 2, {
    steps: 16,
  });
  await expect(target).toHaveAttribute("data-reorder-target", "true");
  await page.mouse.up();
  await expect(sourceRow).not.toHaveAttribute("data-dragging", "true");
  await expect(target).not.toHaveAttribute("data-reorder-target", "true");
  await expect(page.getByTestId("view-field-drag-overlay")).toBeHidden();
  await expect
    .poll(async () => {
      const order = await sourceRow.evaluate((row) =>
        Array.from(row.parentElement?.children ?? [])
          .map((child) => child.getAttribute("data-view-field-slug"))
          .filter((slug): slug is string => slug !== null),
      );
      const sourceIndex = order.indexOf(sourceSlug);
      const targetIndex = order.indexOf(targetSlug);
      return sourceStartedBeforeTarget
        ? sourceIndex === targetIndex + 1
        : sourceIndex === targetIndex - 1;
    })
    .toBe(true);
};

// Shared API helper: throw on a non-2xx response (surfacing its status + body) so a
// failed request fails fast, otherwise return the parsed JSON. `ok`/`status` are
// APIResponse METHODS — call them, don't read them as properties.
export const json = async <T>(response: APIResponse): Promise<T> => {
  if (!response.ok()) {
    throw new Error(`${response.status()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
};

type ChangeRequestFailure = { changeRequestId: string; ok: false; error: string };

export const reviewOne = async (
  request: APIRequestContext,
  changeRequestId: string,
  verdict: "approved" | "rejected",
  reason?: string,
): Promise<ChangeRequestVO> => {
  const response = await json<{
    results: Array<
      { changeRequestId: string; ok: true; changeRequest: ChangeRequestVO } | ChangeRequestFailure
    >;
  }>(
    await request.post("/api/v1/change-requests/reviews", {
      data: { changeRequestIds: [changeRequestId], verdict, ...(reason ? { reason } : {}) },
    }),
  );
  const result = response.results[0];
  if (!result?.ok) throw new Error(result?.error ?? "Change request review returned no result");
  return result.changeRequest;
};

export const mergeOne = async (
  request: APIRequestContext,
  changeRequestId: string,
): Promise<{ changeRequest: ChangeRequestVO; record: RecordVO | null; view: ViewVO | null }> => {
  const response = await json<{
    results: Array<
      | {
          changeRequestId: string;
          ok: true;
          changeRequest: ChangeRequestVO;
          record: RecordVO | null;
          view: ViewVO | null;
        }
      | ChangeRequestFailure
    >;
  }>(
    await request.post("/api/v1/change-requests/merge", {
      data: { changeRequestIds: [changeRequestId] },
    }),
  );
  const result = response.results[0];
  if (!result?.ok) throw new Error(result?.error ?? "Change request merge returned no result");
  return {
    changeRequest: result.changeRequest,
    record: result.record,
    view: result.view,
  };
};

// Unique-ish suffix for titles created by the write specs, so records/CRs from
// repeated runs don't collide in the shared dev DB.
export const unique = (prefix: string) =>
  `${prefix} ${Date.now()} ${Math.floor(Math.random() * 1000)}`;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const cmsPostFields = ({ body, title }: { body: string; title: string }) => {
  const slug = slugify(title);
  return {
    body,
    locale: "en",
    path: `/blog/${slug}`,
    "schema-version": 1,
    slug,
    status: "draft",
    title,
  };
};

export const openSettingsDialog = async (page: Page) => {
  const trigger = page.getByRole("button", { name: /Local Busabase.*Local/ });
  const settingsButton = page.getByRole("button", { exact: true, name: "Settings" });

  await expect
    .poll(
      async () => {
        if (!(await settingsButton.isVisible())) await trigger.click();
        return settingsButton.isVisible();
      },
      { message: "Settings button should appear after dashboard hydration" },
    )
    .toBe(true);
  await settingsButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
};
