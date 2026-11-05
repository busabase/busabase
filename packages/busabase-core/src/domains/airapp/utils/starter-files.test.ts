import { once } from "node:events";
import { createServer } from "node:http";
import { compileFunction, constants } from "node:vm";
import { describe, expect, it } from "vitest";
import { resolveRunPlan } from "./airapp-runtime-descriptor";
import { resolveSiteBundle } from "./site-bundle";
import { createAirAppStarterFiles } from "./starter-files";

const files = () =>
  createAirAppStarterFiles({
    slug: "hello-airapp",
    name: "Hello AirApp",
    description: "A tiny AirApp.",
  });

describe("new AirApp starter", () => {
  it("renders the user-supplied name as text in the published page", () => {
    const source = createAirAppStarterFiles({
      slug: "safe",
      name: '<script>alert("x")</script>',
      description: "",
    });
    const page = source.find((file) => file.path === "public/index.html")?.content;
    expect(page).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(page).not.toContain('<script>alert("x")</script>');
  });

  it("keeps Node preview runnable while publishing only the explicit browser assets", async () => {
    const source = files();
    const result = await resolveSiteBundle(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.blockers));
    expect(result.bundle.access).toBe("read");
    expect(result.bundle.assets.map((asset) => asset.path).sort()).toEqual([
      "/client.js",
      "/index.html",
      "/style.css",
    ]);
    expect(result.bundle.workerCode).not.toMatch(/node:|hono|server\.js/);
    const plan = resolveRunPlan(
      Object.fromEntries(source.map(({ path, content }) => [path, content])),
    );
    expect(plan.runtime).toBe("node");
    expect(plan.start).toBe("npm run dev");
    const server = source.find((file) => file.path === "server.js")?.content;
    expect(server).toContain('asset("public/index.html",');
    expect(server).toContain('asset("public/style.css",');
    expect(server).toContain('asset("public/client.js",');
  });

  it("leaves the runtime to inference so files layered on the starter keep theirs", () => {
    const starter = Object.fromEntries(files().map(({ path, content }) => [path, content]));
    expect(JSON.parse(starter["airapp.json"] as string)).not.toHaveProperty("runtime");

    // The starter alone is still a Node app, now by inference rather than declaration.
    expect(resolveRunPlan(starter)).toMatchObject({ runtime: "node", source: "inferred" });

    // "merge" mode keeps the starter's files that the caller did not provide, so a
    // Python app that brings only `requirements.txt` sits beside package.json and
    // airapp.json. It must still run as Python.
    const layered = { ...starter, "requirements.txt": "fastapi\n", "main.py": "print(1)\n" };
    expect(resolveRunPlan(layered)).toMatchObject({ runtime: "python", source: "inferred" });
  });

  it("serves the generated site's page, stylesheet and interactive script over HTTP", async () => {
    const result = await resolveSiteBundle(files());
    if (!result.ok) throw new Error(JSON.stringify(result.blockers));
    // Load precisely the module that site deployment uploads, without transforming it.
    const loadModule = compileFunction("return import(url)", ["url"], {
      importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
    }) as (url: string) => Promise<{
      default: {
        fetch(
          request: Request,
          env: { ASSETS: { fetch(request: Request): Promise<Response> } },
        ): Promise<Response>;
      };
    }>;
    const worker = (
      await loadModule(`data:text/javascript,${encodeURIComponent(result.bundle.workerCode)}`)
    ).default;
    const env = {
      ASSETS: {
        async fetch(request: Request) {
          const path = new URL(request.url).pathname;
          const asset = result.bundle.assets.find(
            (item) => item.path === (path === "/" ? "/index.html" : path),
          );
          return asset
            ? new Response(new TextDecoder().decode(asset.content), {
                headers: { "Content-Type": asset.contentType },
              })
            : new Response("Not Found", { status: 404 });
        },
      },
    };
    const server = createServer(async (request, response) => {
      const result = await worker.fetch(new Request(`http://localhost${request.url}`), env);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing server port");
    const origin = `http://127.0.0.1:${address.port}`;
    try {
      const page = await fetch(origin);
      expect(page.status).toBe(200);
      expect(page.headers.get("content-type")).toContain("text/html");
      expect(await page.text()).toContain("<h1>Hello AirApp</h1>");
      const style = await fetch(`${origin}/style.css`);
      expect(style.status).toBe(200);
      expect(style.headers.get("content-type")).toContain("text/css");
      const script = await fetch(`${origin}/client.js`);
      expect(script.status).toBe(200);
      expect(await script.text()).toContain('addEventListener("click"');
      expect((await fetch(`${origin}/server.js`)).status).toBe(404);
      expect((await fetch(`${origin}/package.json`)).status).toBe(404);
      expect((await fetch(`${origin}/missing`)).status).toBe(404);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
