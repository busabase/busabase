import { expect, json, test } from "./_fixtures";

// Demo mode is purely server-side: `?demo=…` on a request (or the `bb_demo`
// cookie the middleware writes from a `?demo` dashboard load) routes to the
// stateless demo router, which reads the shared seed and never writes the db.

interface ChangeRequestVO {
  id: string;
  status: string;
  baseId: string | null;
}

interface RecordVO {
  base: { slug: string };
}

interface MergeResultVO {
  changeRequest: { status: string };
  record: { id: string } | null;
}

test("?demo=1 serves the full seeded review queue from the shared seed", async ({ request }) => {
  const changeRequests = await json<ChangeRequestVO[]>(
    await request.get("/api/v1/change-requests?demo=1"),
  );
  const ids = changeRequests.map((cr) => cr.id);
  // The six seeded change requests (same source the real DB seed uses).
  expect(ids).toEqual(
    expect.arrayContaining([
      "crq_seed",
      "crq_seed_blog_update",
      "crq_seed_social_batch",
      "crq_seed_newsletter_approved",
      "crq_seed_newsletter_html_brief",
      "crq_seed_view_ready",
    ]),
  );
});

test("?demo={use-case} focuses the seed on the CMS blog bases", async ({ request }) => {
  const bases = await json<{ id: string; slug: string }[]>(
    await request.get("/api/v1/bases?demo=blog"),
  );
  expect(bases.map((base) => base.slug)).toEqual([
    "blog",
    "nextjs-fumadocs-demo-cms-categories",
    "nextjs-fumadocs-demo-cms-tags",
  ]);

  const changeRequests = await json<ChangeRequestVO[]>(
    await request.get("/api/v1/change-requests?demo=blog"),
  );
  expect(changeRequests.length).toBeGreaterThan(0);
  // Base-scoped CRs must all belong to the blog base — that's the actual
  // "excludes other bases" guarantee. Doc-level CRs (baseId: null, e.g. the
  // seeded Agent Operating Guide update) are deliberately NOT use-case-scoped
  // — they're general knowledge-base content the demo shows regardless of
  // which base-focused scenario is selected (confirmed: the same doc CR
  // appears identically under every ?demo={use-case}), so they're excluded
  // from this check rather than asserted to have blog's baseId.
  const baseScoped = changeRequests.filter((cr) => cr.baseId !== null);
  expect(baseScoped.length).toBeGreaterThan(0);
  const postsBase = bases.find((base) => base.slug === "blog");
  expect(postsBase).toBeDefined();
  expect(baseScoped.every((cr) => cr.baseId === postsBase?.id)).toBe(true);

  const records = await json<RecordVO[]>(await request.get("/api/v1/records?demo=blog"));
  expect(
    records.every((record) =>
      ["blog", "nextjs-fumadocs-demo-cms-categories", "nextjs-fumadocs-demo-cms-tags"].includes(
        record.base.slug,
      ),
    ),
  ).toBe(true);
});

test("demo writes are synthetic and never persist (refresh resets)", async ({ request }) => {
  const merge = await json<MergeResultVO>(
    await request.post("/api/v1/change-requests/crq_seed_newsletter_approved/merge?demo=1"),
  );
  expect(merge.changeRequest.status).toBe("merged");
  expect(merge.record).not.toBeNull();

  // Re-reading shows the seeded state again — the merge did not persist.
  const reloaded = await json<ChangeRequestVO>(
    await request.get("/api/v1/change-requests/crq_seed_newsletter_approved?demo=1"),
  );
  expect(reloaded.status).toBe("approved");
});

test("dashboard renders the demo review queue from ?demo=1", async ({ page }) => {
  // proxy.ts turns the document's `?demo` into the `x-demo-mode` header the
  // server render reads — purely server-side, no client code or cookie.
  await page.goto("/dashboard/local/inbox?demo=1");
  await expect(page.getByText("Local Busabase", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Local", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Trusted Intelligent Database", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /For review \d+/ })).toBeVisible();
});

test("demo use-case persists across SPA navigation (?demo=blog)", async ({ page }) => {
  // SPALink (wouter) preserves the active demo value on click, so the Referer
  // keeps `?demo=blog` and the demo router keeps serving the focused use-case.
  await page.goto("/dashboard/local/inbox?demo=blog");
  const activity = page.getByRole("link", { name: "Activity" });
  await expect(activity).toBeVisible();
  await activity.click();
  await expect(page).toHaveURL(/\/dashboard\/local\/activity\?demo=blog$/);
});
