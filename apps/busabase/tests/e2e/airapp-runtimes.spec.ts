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
  test("runs a Python AirApp end to end, on the engine that can host it", async ({
    page,
    request,
  }) => {
    // A self-hosted server declares itself `SELF-HOSTED` at boot, so the host
    // engine is available with no configuration — which is what makes a Python
    // AirApp runnable here at all.
    const app = await createFromDemo(
      request,
      AIRAPP_DEMO_PYTHON_INFERRED.files,
      "e2e python inferred",
    );

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await openLogs(page);

    // 1. The runtime was inferred, and the app was told so. Inference nobody can
    //    see is indistinguishable from a bug when it guesses wrong.
    await expect(page.getByText(/inferred "python" from requirements\.txt/)).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });

    // 2. And the engine was NOT the stored default: auto-run would otherwise
    //    have started a Python app in the browser — a JavaScript-only runtime —
    //    and failed every time.
    await expect(page.getByText(/engine "local" selected for runtime "python"/)).toBeVisible();

    // 3. It really installed and started: uvicorn's own banner, which no Node
    //    log pattern would have matched.
    await expect(page.getByText(/Uvicorn running on/)).toBeVisible({
      timeout: RUN_READY_TIMEOUT,
    });

    // 4. And the preview serves the app's own markup through the same-origin
    //    reverse proxy — the assertion the logs cannot make, and the only one
    //    that catches a COEP-blocked frame (clean 200, nothing rendered).
    await page.getByRole("tab", { name: "App" }).click();
    await expect(preview(page)).toBeVisible({ timeout: RUN_READY_TIMEOUT });
    await expect(
      page
        .frameLocator('[data-dashboard-active-view] iframe[title="AirApp preview"]:visible')
        .getByRole("heading", { name: "Running on Python" }),
    ).toBeVisible({ timeout: RUN_READY_TIMEOUT });
  });

  test("accepts an airapp.json still pinned to a retired engine name", async ({
    page,
    request,
  }) => {
    // An `airapp.json` lives in someone else's repository. Busabase renamed
    // these values and cannot rewrite those files, so `nodepod` must still
    // resolve rather than fail the app over a rename it had no part in.
    const app = await createFromDemo(
      request,
      [{ path: "airapp.json", content: JSON.stringify({ preferredEngine: "nodepod" }, null, 2) }],
      "e2e legacy engine name",
    );

    await page.goto(`/dashboard/local/airapp/${app.slug}`);
    await openLogs(page);

    // No manifest error, and it runs.
    await expect(page.getByText(/preferredEngine/)).toHaveCount(0);
    await expect(page.getByText(/\$ npm install/)).toBeVisible({ timeout: RUN_READY_TIMEOUT });
    // And the log says the manifest was read. It used to say "no airapp.json"
    // here — a line the reader can check and find false, which is what sent
    // someone debugging a manifest that was in fact working.
    await expect(page.getByText(/airapp\.json declares no "runtime"/)).toBeVisible();
    await expect(page.getByText(/no airapp\.json/)).toHaveCount(0);
  });

  test("rejects the removed engine at authoring time, naming it specifically", async ({
    request,
  }) => {
    // Where this actually surfaces, verified rather than assumed: the write-time
    // validator refuses the manifest, so the author is told at the moment they
    // save it — not after navigating to a node that then fails to run. `srt` was
    // a real engine, not a typo, so being told only "must be one of browser,
    // local, remote" would leave them diffing two lists and none the wiser.
    const response = await request.post("/api/v1/file-trees", {
      data: {
        type: "airapp",
        autoMerge: true,
        slug: slugify(unique("e2e removed engine")),
        name: unique("e2e removed engine"),
        files: [
          { path: "airapp.json", content: JSON.stringify({ preferredEngine: "srt" }, null, 2) },
        ],
      },
    });

    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("AIRAPP_NOT_RUNNABLE");
    expect(body.data.reason).toContain("an engine that has been removed");
    expect(body.data.reason).toContain('Use "remote" for isolated execution');
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
