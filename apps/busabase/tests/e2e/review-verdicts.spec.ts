import { type APIRequestContext, cmsPostFields, expect, json, test, unique } from "./_fixtures";

// The existing suite covers the Approve and "Request changes" verdicts. The
// remaining reviewer exit is CLOSE (abandon): a change request can be closed from
// the open (in_review) state and from the approved state, and closing must never
// merge a canonical record. Closed CRs render with the "Closed" status label
// (changeRequestStatusLabel maps rejected/abandoned → "Closed").
//
// Setup writes go over the REST API (as review-experience.spec.ts does) to avoid
// the single-connection PGLite dev DB 500ing on browser writes that overlap the
// SPA's background refetches; the UI drives only the close action.

interface BaseVO {
  id: string;
  slug: string;
}

interface ChangeRequestVO {
  id: string;
  status: string;
}

// The dashboard SPA is heavy in `next dev`; real-DB detail pages can take a while
// to hydrate. Match the timeout headroom the other browser-driven specs rely on.
const NAV = { waitUntil: "commit" as const, timeout: 60_000 };
const RENDER_TIMEOUT = 45_000;
test.setTimeout(120_000);

const getBlogBase = async (request: APIRequestContext) => {
  const bases = await json<BaseVO[]>(await request.get("/api/v1/bases"));
  const blog = bases.find((base) => base.slug === "blog");
  if (!blog) {
    throw new Error("Blog base not found — is the DB seeded (pnpm db:seed:all)?");
  }
  return blog;
};

const createChangeRequest = async (request: APIRequestContext, baseId: string, title: string) =>
  json<ChangeRequestVO>(
    await request.post(`/api/v1/bases/${baseId}/change-requests`, {
      data: {
        fields: cmsPostFields({ title, body: "Body for a close-verdict test." }),
        message: "Create close-verdict test record",
        submittedBy: "e2e-agent",
      },
    }),
  );

test("closing an open change request abandons it without merging", async ({ page, request }) => {
  const blog = await getBlogBase(request);
  const title = unique("E2E close open CR");
  const created = await createChangeRequest(request, blog.id, title);

  await page.goto(`/dashboard/local/inbox/${created.id}`, NAV);
  await expect(page.getByText("Waiting for your review")).toBeVisible({ timeout: RENDER_TIMEOUT });

  await page.getByRole("button", { name: "Close change request" }).click();

  // Stays on the CR (no merge redirect), and the status flips to Closed.
  await expect(page).toHaveURL(new RegExp(`/dashboard/local/inbox/${created.id}$`));
  await expect(page.getByText("Closed").first()).toBeVisible();
  // The review controls are gone — a closed CR is no longer actionable.
  await expect(page.getByRole("radio", { name: "Approve" })).toHaveCount(0);

  // The API agrees the CR is terminally closed and produced no canonical record.
  const reloaded = await json<ChangeRequestVO>(
    await request.get(`/api/v1/change-requests/${created.id}`),
  );
  expect(["rejected", "abandoned"]).toContain(reloaded.status);
});

test("closing an approved change request abandons it instead of merging", async ({
  page,
  request,
}) => {
  const blog = await getBlogBase(request);
  const title = unique("E2E close approved CR");
  const created = await createChangeRequest(request, blog.id, title);

  // Approve over the API so the composer is in its "ready to merge" state.
  await json<ChangeRequestVO>(
    await request.post(`/api/v1/change-requests/${created.id}/reviews`, {
      data: { verdict: "approved" },
    }),
  );

  await page.goto(`/dashboard/local/inbox/${created.id}`, NAV);
  await expect(page.getByText("Approved · ready to merge")).toBeVisible({
    timeout: RENDER_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: "Merge into Base" })).toBeVisible();

  // Choose the abandon exit rather than merging.
  await page.getByRole("button", { name: "Close change request" }).click();

  await expect(page).toHaveURL(new RegExp(`/dashboard/local/inbox/${created.id}$`));
  await expect(page.getByText("Closed").first()).toBeVisible();
  // Never merged — no canonical-record redirect happened.
  await expect(page).not.toHaveURL(/\/dashboard\/local\/base\/blog\/rec/);

  const reloaded = await json<ChangeRequestVO>(
    await request.get(`/api/v1/change-requests/${created.id}`),
  );
  expect(["rejected", "abandoned"]).toContain(reloaded.status);
});
