import { AIRAPP_DEMO_PYTHON_INFERRED } from "busabase-core/domains/airapp/demo-content-runtimes";
import { type APIRequestContext, expect, json, type Page, test, unique } from "./_fixtures";

/**
 * Browser coverage for the multi-language runtime.
 *
 * Everything below is only observable in a real browser: the engine is chosen
 * client-side before the runner is constructed, the Nodepod engine *is* the
 * browser, and the preview only proves anything once an iframe actually renders
 * the app's own markup. Unit tests of `resolveRunPlan` cannot see any of it.
 *
 * The Python case runs a real `python3 -m venv` + `pip install` server-side, so
 * it needs the host to have Python and needs PyPI reachable.
 */

interface AirAppNodeVO {
  node: { id: string; slug: string; name: string; type: string };
  files: Array<{ path: string; name: string }>;
}

test.setTimeout(300_000);
const RUN_READY_TIMEOUT = 180_000;

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createFromDemo = async (
  request: APIRequestContext,
  files: Array<{ path: string; content: string }>,
  namePrefix: string,
) => {
  const name = unique(namePrefix);
  const slug = slugify(name);
  const created = await json<AirAppNodeVO>(
    await request.post("/api/v1/file-trees", {
      data: { type: "airapp", autoMerge: true, slug, name, files },
    }),
  );
  return { name, slug, nodeId: created.node.id };
};

const preview = (page: Page) =>
  page.locator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible');

const openLogs = async (page: Page) => {
  await page.getByRole("tab", { name: "Logs" }).click();
};

test.describe("AirApp runtimes", () => {
  test("runs a Python AirApp end to end, choosing an engine that can host it", async ({
    page,
    request,
  }) => {
    const app = await createFromDemo(
      request,
      AIRAPP_DEMO_PYTHON_INFERRED.files,
      "e2e python inferred",
    );

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await openLogs(page);

    // 1. The runtime was inferred, and the app was told so. Without this line a
    //    wrong guess is indistinguishable from a bug.
    await expect(page.getByText(/inferred "python" from requirements\.txt/)).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });

    // 2. The engine was NOT the stored default. Auto-run means a Python app
    //    would otherwise have started on Nodepod — a browser JavaScript runtime
    //    — and failed every time.
    await expect(page.getByText(/engine "local" selected for runtime "python"/)).toBeVisible();

    // 3. It really installed and started: uvicorn's own banner, which no Node
    //    log pattern would have matched.
    await expect(page.getByText(/Uvicorn running on/)).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });

    // 4. The toolbar names the engine that is actually running, not the stale
    //    stored default.
    await expect(page.getByRole("combobox")).toContainText(/Local machine/i);

    // 5. And the preview serves the app's markup through the same-origin
    //    reverse proxy — the assertion the logs cannot make. This is also the
    //    only check that catches a COEP-blocked frame: the server returns a
    //    clean 200 and the iframe renders nothing.
    await page.getByRole("tab", { name: "App" }).click();
    const frame = preview(page);
    await expect(frame).toBeVisible({ timeout: RUN_READY_TIMEOUT });
    await expect(
      page
        .frameLocator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible')
        .getByRole("heading", { name: "Running on Python" }),
    ).toBeVisible({ timeout: RUN_READY_TIMEOUT });
  });

  test("leaves a plain Node AirApp on the in-browser engine", async ({ page, request }) => {
    // The regression this guards: a Node app with no airapp.json must keep
    // resolving to the same engine and the same commands as before any of this.
    const app = await createFromDemo(request, [], "e2e node default");

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await openLogs(page);

    await expect(page.getByText(/inferred "node" from package\.json/)).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });
    await expect(page.getByText(/\$ npm install/)).toBeVisible();
    // No engine note: the stored default was already the right engine, so
    // nothing was overridden.
    await expect(page.getByText(/engine ".*" selected for runtime/)).toHaveCount(0);

    await page.getByRole("tab", { name: "App" }).click();
    await expect(preview(page)).toBeVisible({ timeout: RUN_READY_TIMEOUT });
  });
});

test.describe("AirApp run lifecycle", () => {
  test("keeps a run alive across navigation and ends it only on Stop", async ({
    page,
    request,
  }) => {
    const app = await createFromDemo(request, [], "e2e lifecycle");

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await expect(preview(page)).toBeVisible({ timeout: RUN_READY_TIMEOUT });

    // Navigating away must not stop the app — that decision belongs to the
    // user, and throwing away a finished install because someone clicked
    // elsewhere is the behaviour this replaced.
    await page.goto("/dashboard/local/home");
    await expect(page.getByRole("link", { name: "Home" }).first()).toBeVisible();

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await expect(preview(page)).toBeVisible({ timeout: RUN_READY_TIMEOUT });

    // Stop is the explicit end. Afterwards the Run control is offered again,
    // which is how the panel says "nothing is running here".
    await page.getByRole("button", { name: "Stop" }).click();
    await expect(page.getByRole("button", { name: "Stop" })).toHaveCount(0, { timeout: 30_000 });
    await expect(preview(page)).toHaveCount(0, { timeout: 30_000 });
  });
});
