import { type APIRequestContext, expect, json, test, unique } from "./_fixtures";

// Markdown has no video primitive, so a clip reaches a Doc as an image, as a raw
// <video> tag, or as an ordinary link — see packages/busabase-core/src/domains/doc/
// components/doc-video.ts, which draws a real player for all three without touching
// the stored Markdown.
//
// The sources below are same-origin paths that intentionally 404: this asserts the
// player is mounted and pointed at the right file, which is the part we own. Whether
// the bytes decode is the browser's job and would make the suite depend on the network.

interface DocNodeVO {
  node: { id: string; slug: string; name: string };
  body: string;
}

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createDoc = async (request: APIRequestContext, namePrefix: string, body: string) => {
  const name = unique(namePrefix);
  const slug = slugify(name);
  await json<DocNodeVO>(
    await request.post("/api/v1/docs", { data: { autoMerge: true, slug, name, body } }),
  );
  return slug;
};

test("a linked video plays inline, and ordinary links stay links", async ({ page, request }) => {
  const slug = await createDoc(
    request,
    "E2E doc video link",
    [
      "## Watch this",
      "",
      // The shape the migrated Buda kit Docs use.
      "> 🎥 **[Full demo](/e2e-media/demo.mp4)**",
      "",
      "A normal link: [Pricing](https://buda.im/pricing) should stay a link.",
    ].join("\n"),
  );

  await page.goto(`/dashboard/local/doc/${slug}`);

  const player = page.locator(".ProseMirror video.milkdown-video-block");
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute("src", "/e2e-media/demo.mp4");
  await expect(player).toHaveAttribute("controls", "");
  // The link stays in the document and reads as the player's caption.
  await expect(page.getByRole("link", { name: "Full demo" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pricing" })).toBeVisible();

  // Edit mode is the same editor with the same plugins — the player must survive it.
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Save Now" })).toBeVisible();
  await expect(page.locator(".ProseMirror video.milkdown-video-block")).toHaveCount(1);
});

test("image syntax and a raw <video> tag both play; an ordinary image stays an image", async ({
  page,
  request,
}) => {
  const slug = await createDoc(
    request,
    "E2E doc video nodes",
    [
      "![clip](/e2e-media/demo.mp4?v=1)",
      "",
      '<video src="/e2e-media/raw.mp4"></video>',
      "",
      "![a normal picture](/e2e-media/cover.png)",
    ].join("\n"),
  );

  await page.goto(`/dashboard/local/doc/${slug}`);

  const players = page.locator(".ProseMirror video.milkdown-video-block");
  await expect(players).toHaveCount(2);
  await expect(players.nth(0)).toHaveAttribute("src", "/e2e-media/demo.mp4?v=1");
  await expect(players.nth(1)).toHaveAttribute("src", "/e2e-media/raw.mp4");
  // No <video> markup leaked as text, and the png still renders through Crepe's view.
  await expect(page.locator(".ProseMirror")).not.toContainText("<video");
  await expect(page.locator('.ProseMirror img[src="/e2e-media/cover.png"]')).toHaveCount(1);
});

test("a YouTube link becomes a player; a channel link stays a link", async ({ page, request }) => {
  const slug = await createDoc(
    request,
    "E2E doc youtube link",
    [
      "Watch it: [The demo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
      "",
      "Subscribe: [our channel](https://www.youtube.com/@buda-ai)",
    ].join("\n"),
  );

  await page.goto(`/dashboard/local/doc/${slug}`);

  const frame = page.locator(".ProseMirror iframe.milkdown-video-embed");
  await expect(frame).toHaveCount(1);
  // The no-cookie host is YouTube's own privacy-enhanced player.
  await expect(frame).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  await expect(frame).toHaveAttribute("loading", "lazy");
  // A channel is not a video — turning it into a player would misread the link.
  await expect(page.getByRole("link", { name: "our channel" })).toBeVisible();
});

test("a doc with no video renders no player", async ({ page, request }) => {
  const slug = await createDoc(
    request,
    "E2E doc no video",
    "Just text and a [link](https://buda.im) and an ![image](/e2e-media/cover.png).\n",
  );

  await page.goto(`/dashboard/local/doc/${slug}`);

  await expect(page.locator(".ProseMirror")).toBeVisible();
  await expect(page.locator(".ProseMirror video")).toHaveCount(0);
  await expect(page.locator(".ProseMirror iframe")).toHaveCount(0);
});
