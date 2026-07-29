import { expect, openSettingsDialog, test } from "./_fixtures";

// Busabase Desktop embeds this app in an iframe inside a Tauri webview, and that
// webview implements no `window.open()` — it returns `null` on every call. Cloud
// Connect used to read that as "your browser blocked the sign-in popup" and dead-end.
// This spec reproduces that environment in Chromium (iframe + `window.open` → null,
// plus a stand-in for the shell's message handler) and pins the recovery: the
// authorize URL is handed to the shell for the OS browser instead of erroring out.

const HARNESS_PATH = "/__desktop-shell-harness";

const HARNESS_HTML = `<!doctype html>
<meta charset="utf-8" />
<title>Desktop shell harness</title>
<body style="margin:0">
<script>
  window.__openedExternally = [];
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.type !== "busabase-desktop:open-external") return;
    window.__openedExternally.push(data.url);
    event.source.postMessage(
      { type: "busabase-desktop:open-external:result", requestId: data.requestId, ok: true },
      "*",
    );
  });
</script>
<iframe
  id="app"
  src="/dashboard/local/inbox"
  style="width:100vw;height:100vh;border:0"
  sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
></iframe>
</body>`;

declare global {
  interface Window {
    __openedExternally?: string[];
  }
}

test("Cloud Connect hands sign-in to the OS browser when window.open is unavailable", async ({
  page,
}) => {
  await page.route(`**${HARNESS_PATH}`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HARNESS_HTML }),
  );
  // Emulate the Tauri webview in every frame, including the embedded app.
  await page.addInitScript(() => {
    window.open = () => null;
  });

  await page.goto(HARNESS_PATH);
  const app = page.frameLocator("#app");

  const trigger = app.getByRole("button", { name: /Local Busabase.*Local/ });
  const settingsButton = app.getByRole("button", { exact: true, name: "Settings" });
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

  await app.getByRole("button", { exact: true, name: "Cloud Connect" }).click();
  await app.getByRole("button", { name: "Connect to Busabase Cloud" }).click();

  // The user is told where sign-in went instead of being shown "popup blocked".
  await expect(app.getByText(/sign-in opened in your browser/i)).toBeVisible();
  await expect(app.getByText(/blocked the sign-in popup/i)).toHaveCount(0);

  const opened = await page.evaluate(() => window.__openedExternally ?? []);
  expect(opened).toHaveLength(1);
  expect(opened[0]).toContain("/api/oauth/authorize");
  expect(opened[0]).toContain("code_challenge=");
});

// Regression guard for the restructured `handleConnect`: an ordinary browser, where
// `window.open` works, must still get the popup and never see the desktop hint.
test("in an ordinary browser sign-in still opens the popup", async ({ context, page }) => {
  await context.route("https://busabase.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html; charset=utf-8",
      body: "<title>Stub authorize</title>",
    }),
  );

  await page.goto("/dashboard/local/inbox");
  await openSettingsDialog(page);
  await page.getByRole("button", { exact: true, name: "Cloud Connect" }).click();

  const [popup] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Connect to Busabase Cloud" }).click(),
  ]);
  await popup.waitForURL(/\/api\/oauth\/authorize/, { waitUntil: "commit" });

  await expect(page.getByText(/blocked the sign-in popup/i)).toHaveCount(0);
  await expect(page.getByText(/sign-in opened in your browser/i)).toHaveCount(0);
  await popup.close();
});
