import { describe, expect, it } from "vitest";
import {
  ASSETS_ONLY_WORKER,
  computeSiteVersion,
  resolveSiteBundle,
  SITE_MAX_ASSET_BYTES,
  type SiteBundleInputFile,
  selectSiteSourcePaths,
} from "./site-bundle";

const manifest = (site: unknown, extra: Record<string, unknown> = {}): SiteBundleInputFile => ({
  path: "airapp.json",
  content: JSON.stringify({ ...extra, site }),
});
const index = { path: "public/index.html", content: "<h1>Toys</h1>" };
const worker = (content: string): SiteBundleInputFile => ({ path: "worker/index.js", content });
const fetchWorker = "export default { fetch() { return new Response('ok'); } };";

const blockerCodes = async (files: SiteBundleInputFile[]) => {
  const result = await resolveSiteBundle(files);
  return result.ok ? [] : result.blockers.map((blocker) => blocker.code);
};

describe("resolveSiteBundle", () => {
  it("bundles a static site behind a Worker that only serves assets", async () => {
    const result = await resolveSiteBundle([manifest({}), index]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.workerCode).toBe(ASSETS_ONLY_WORKER);
    expect(result.bundle.assets).toEqual([
      expect.objectContaining({
        path: "/index.html",
        contentType: "text/html; charset=utf-8",
        size: 13,
      }),
    ]);
  });

  it("uses the declared Worker entry and assets folder", async () => {
    const result = await resolveSiteBundle([
      manifest({ entry: "./worker/index.js", assets: "dist/", notFoundHandling: "none" }),
      worker(fetchWorker),
      { path: "dist/logo.png", content: new Uint8Array([1, 2, 3]) },
      { path: "public/ignored.html", content: "not in the assets folder" },
    ]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.workerCode).toBe(fetchWorker);
    expect(result.bundle.notFoundHandling).toBe("none");
    expect(result.bundle.assets.map((asset) => asset.path)).toEqual(["/logo.png"]);
    expect(result.bundle.assets[0]?.contentType).toBe("image/png");
  });

  it("refuses an ordinary AirApp that never declared itself a site", async () => {
    // Deploying its public/ folder would silently drop the app's server.
    expect(
      await blockerCodes([
        { path: "server.js", content: "import http from 'node:http';" },
        { path: "package.json", content: '{"scripts":{"dev":"node server.js"}}' },
        index,
      ]),
    ).toEqual(["not-a-site-app"]);
    expect(await blockerCodes([{ path: "airapp.json", content: "{}" }, index])).toEqual([
      "not-a-site-app",
    ]);
  });

  it("names Node-only imports and relative modules", async () => {
    const result = await resolveSiteBundle([
      manifest({ entry: "worker/index.js" }),
      worker(
        `import fs from "node:fs";\nimport { x } from "./helper.js";\nimport { Hono } from "hono";\nexport default { fetch() {} };`,
      ),
    ]);

    expect(result).toEqual({
      ok: false,
      blockers: [
        { code: "unsupported-import", path: "worker/index.js", specifier: "node:fs" },
        { code: "unsupported-import", path: "worker/index.js", specifier: "./helper.js" },
        { code: "unsupported-import", path: "worker/index.js", specifier: "hono" },
      ],
    });
  });

  it("does not mistake page text for an import", async () => {
    // The false positive that would block a real shop: a bundled Worker whose
    // HTML, comments and bundled source all contain the word.
    const code = `
      // import fs from "node:fs";
      /* require("node:fs") */
      const page = '<script type="module">import a from "./a.js"</script> import duties from "node:fs"';
      const faq = \`How do I import toys from "china"?\`;
      export default { fetch() { return new Response(page + faq); } };
    `;
    expect(await blockerCodes([manifest({ entry: "worker/index.js" }), worker(code)])).toEqual([]);
  });

  it("allows Cloudflare's own runtime modules", async () => {
    const code = `import { DurableObject } from "cloudflare:workers";\nexport default { fetch() {} };`;
    expect(await blockerCodes([manifest({ entry: "worker/index.js" }), worker(code)])).toEqual([]);
  });

  it("reports a computed dynamic import, which one uploaded module cannot satisfy", async () => {
    const code = "export default { fetch() { const m = 'x'; return import(m); } };";
    expect(await blockerCodes([manifest({ entry: "worker/index.js" }), worker(code)])).toEqual([
      "unsupported-import",
    ]);
  });

  it("requires a default export and valid syntax", async () => {
    expect(
      await blockerCodes([manifest({ entry: "worker/index.js" }), worker("export const a = 1;")]),
    ).toEqual(["entry-no-default-export"]);
    expect(
      await blockerCodes([manifest({ entry: "worker/index.js" }), worker("export default {")]),
    ).toEqual(["entry-syntax-error"]);
  });

  it("reports a missing or non-JavaScript entry", async () => {
    expect(await blockerCodes([manifest({ entry: "worker/index.js" }), index])).toEqual([
      "entry-missing",
    ]);
    expect(
      await blockerCodes([
        manifest({ entry: "worker/index.ts" }),
        { path: "worker/index.ts", content: fetchWorker },
      ]),
    ).toEqual(["entry-not-javascript"]);
  });

  it("needs an index page only when no Worker can answer the root", async () => {
    expect(await blockerCodes([manifest({})])).toEqual(["no-index-page"]);
    expect(
      await blockerCodes([manifest({ entry: "worker/index.js" }), worker(fetchWorker)]),
    ).toEqual([]);
  });

  it("refuses paths that leave the app's tree", async () => {
    expect(await blockerCodes([manifest({ entry: "../secrets.js" }), index])).toEqual([
      "unsafe-path",
    ]);
    expect(await blockerCodes([manifest({ assets: "public/../.." }), index])).toEqual([
      "unsafe-path",
    ]);
  });

  it("refuses a Python app and a malformed manifest", async () => {
    expect(await blockerCodes([manifest({}, { runtime: "python" }), index])).toEqual([
      "python-runtime",
    ]);
    expect(await blockerCodes([{ path: "airapp.json", content: "{" }, index])).toEqual([
      "invalid-manifest",
    ]);
    expect(await blockerCodes([manifest({ notFoundHandling: "maybe" }), index])).toEqual([
      "invalid-manifest",
    ]);
  });

  it("gives a site a read-only key unless it asks for more", async () => {
    const accessOf = async (site: Record<string, unknown>) => {
      const result = await resolveSiteBundle([manifest(site), index]);
      return result.ok ? result.bundle.access : result.blockers;
    };
    expect(await accessOf({})).toBe("read");
    expect(await accessOf({ access: "changeRequest" })).toBe("changeRequest");
    expect(await accessOf({ access: "write" })).toBe("write");
  });

  it("blocks an access level a site may not have, saying which ones it may", async () => {
    for (const access of ["manage", "admin", "", 1, null]) {
      expect(await resolveSiteBundle([manifest({ access }), index])).toEqual({
        ok: false,
        blockers: [
          {
            code: "invalid-manifest",
            detail: "`site.access` must be one of read, changeRequest, write",
          },
        ],
      });
    }
  });

  it("refuses an asset over Cloudflare's per-file limit", async () => {
    const big = { path: "public/big.mp4", content: new Uint8Array(25 * 1024 * 1024 + 1) };
    expect(await blockerCodes([manifest({}), index, big])).toEqual(["asset-too-large"]);
  });
});

describe("selectSiteSourcePaths", () => {
  const manifest = JSON.stringify({ site: { entry: "worker.js", assets: "dist" } });

  it("keeps the entry and the assets folder, and nothing that never deploys", () => {
    expect(
      selectSiteSourcePaths(manifest, [
        "airapp.json",
        "worker.js",
        "dist/index.html",
        "dist/a/b.css",
        "src/worker.ts",
        "distant/file.txt",
        "data/huge.csv",
      ]),
    ).toEqual(["worker.js", "dist/index.html", "dist/a/b.css"]);
  });

  it("selects nothing without a usable manifest", () => {
    expect(selectSiteSourcePaths(undefined, ["public/index.html"])).toEqual([]);
    expect(selectSiteSourcePaths("{not json", ["public/index.html"])).toEqual([]);
    expect(selectSiteSourcePaths("{}", ["public/index.html"])).toEqual([]);
  });
});

describe("computeSiteVersion", () => {
  const bundleOf = (files: { path: string; content: string }[]) =>
    resolveSiteBundle([
      { path: "airapp.json", content: JSON.stringify({ site: {} }) },
      ...files,
    ]).then((result) => {
      if (!result.ok) throw new Error(JSON.stringify(result.blockers));
      return result.bundle;
    });

  const home = { path: "public/index.html", content: "<h1>one</h1>" };

  it("is the same for the same content, whatever order files arrive in", async () => {
    const style = { path: "public/app.css", content: "body{}" };
    expect(await computeSiteVersion(await bundleOf([home, style]))).toBe(
      await computeSiteVersion(await bundleOf([style, home])),
    );
  });

  it("changes when a served file changes", async () => {
    expect(await computeSiteVersion(await bundleOf([home]))).not.toBe(
      await computeSiteVersion(
        await bundleOf([{ path: "public/index.html", content: "<h1>two</h1>" }]),
      ),
    );
  });

  it("changes when a file only moves", async () => {
    const style = { path: "public/a.css", content: "x" };
    const moved = { path: "public/b.css", content: "x" };
    expect(await computeSiteVersion(await bundleOf([home, style]))).not.toBe(
      await computeSiteVersion(await bundleOf([home, moved])),
    );
  });

  it("changes when what the site's key may do changes", async () => {
    const accessed = (access: string) =>
      resolveSiteBundle([
        { path: "airapp.json", content: JSON.stringify({ site: { access } }) },
        home,
      ]).then((result) => {
        if (!result.ok) throw new Error(JSON.stringify(result.blockers));
        return computeSiteVersion(result.bundle);
      });
    expect(await accessed("read")).toBe(await computeSiteVersion(await bundleOf([home])));
    expect(await accessed("write")).not.toBe(await accessed("read"));
  });

  it("does not change for a file that never deploys", async () => {
    expect(await computeSiteVersion(await bundleOf([home]))).toBe(
      await computeSiteVersion(await bundleOf([home, { path: "README.md", content: "anything" }])),
    );
  });

  it("does not confuse a binary asset's bytes across versions", async () => {
    const withBytes = (byte: number) =>
      resolveSiteBundle([
        { path: "airapp.json", content: JSON.stringify({ site: {} }) },
        home,
        { path: "public/logo.png", content: new Uint8Array([byte]) },
      ]).then((result) => {
        if (!result.ok) throw new Error("blocked");
        return computeSiteVersion(result.bundle);
      });
    expect(await withBytes(1)).not.toBe(await withBytes(2));
  });
});

describe("an asset too large to have been read", () => {
  it("is still blocked, by the size the caller knows", async () => {
    const result = await resolveSiteBundle([
      { path: "airapp.json", content: JSON.stringify({ site: {} }) },
      { path: "public/index.html", content: "<h1>hi</h1>" },
      { path: "public/video.mp4", content: new Uint8Array(0), knownSize: SITE_MAX_ASSET_BYTES + 1 },
    ]);
    expect(result).toEqual({
      ok: false,
      blockers: [
        { code: "asset-too-large", path: "public/video.mp4", size: SITE_MAX_ASSET_BYTES + 1 },
      ],
    });
  });
});
