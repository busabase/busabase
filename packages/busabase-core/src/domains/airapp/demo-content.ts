/**
 * Shared catalog of AirApp demo projects — the single source of truth for
 * every AirApp demo's file content. Two very different consumers need the
 * same content and must not fork it:
 *
 *   - `apps/busabase/scripts/demo/14-airapps.ts` — an integration/smoke test
 *     that creates all of these via the real REST API (`POST /airapps`).
 *   - `packages/busabase-core/src/demo/scenarios/node-types.en.ts` — a
 *     lower-level seed path (direct DB writes, no HTTP) consumed by
 *     `pnpm db:seed:all` and demo mode. It only seeds the three fast,
 *     dependency-light demos (Pure HTML, Hono API, SQLite) — the Vite-based
 *     ones are intentionally left out of that fast baseline seed (slower
 *     installs, and two of the six are deliberately-broken negative
 *     examples).
 *
 * What each demo shows about the Run panel (Nodepod-backed, see
 * `packages/busabase-core/src/domains/airapp/`) — 6 working, 2 kept as live,
 * runnable negative examples rather than deleted, so a Run click shows the
 * real upstream failure instead of it only being documented in prose:
 *
 *   1. "Pure HTML Demo"         — no package.json dependencies, no framework,
 *      no bundler: index.html + CSS + a script tag, served by a five-line
 *      node:http static file server. Same "npm install && npm run dev" path
 *      every other demo uses — `npm install` with nothing to install is
 *      reported by Nodepod itself as `added 0 packages in 0.0s`, so there's
 *      no meaningful startup cost to keeping every AirApp on one execution
 *      model instead of special-casing dependency-free projects at the
 *      runner level. The lowest-friction AirApp starting point.
 *   2. "Hono API Demo"          — pure Hono + @hono/node-server. Works.
 *   3. "Vite + React Demo"      — works, pinned to `vite@7.3.1` (the exact
 *      version Nodepod's own repo, github.com/R1ck404/Nodepod
 *      examples/issue-44-react-dev-server, labels "known good" —
 *      `vite@^5.4.10`/`4.5.5` crash with `Cannot destructure property
 *      'createServer'` before the dev server even binds a port). Drops
 *      `@vitejs/plugin-react` entirely and uses Vite's built-in
 *      esbuild-based JSX transform instead, avoiding Babel altogether.
 *      Trade-off: no Fast Refresh — edits full-reload instead of preserving
 *      component state.
 *   4. "Hono + Vite Dev Server" — works, same vite@7.3.1 pin. No React/Babel
 *      involved (Hono mounted as Vite middleware via `configureServer`,
 *      plain HTML/JS frontend), so this one was only ever blocked by the
 *      vite@5 `createServer` crash, not the Babel issue below.
 *   5. "Vite + React with Fast Refresh" — identical app to #3, but with
 *      `@vitejs/plugin-react` (Babel-based Fast Refresh) left in. Originally
 *      seeded as a known-broken negative example (`[BABEL] .length is not a
 *      valid Plugin property`, reproduced byte-for-byte against Nodepod's own
 *      "known good" example) — re-verified working after bumping
 *      `@scelar/nodepod` 1.9.5 → 1.9.9 (real click-through test: the counter
 *      button works and Fast Refresh preserves state on edit). Prefer this
 *      one over #3 unless there's a specific reason to avoid Babel.
 *   6. "Vite + React (SWC, known broken)" — same app again, with
 *      `@vitejs/plugin-react-swc` instead (SWC-based Fast Refresh, no
 *      Babel). Fails differently: `Failed to load native binding` —
 *      `@swc/core` ships a platform-native binary, same class of problem as
 *      the original esbuild crash, just a different native tool Nodepod
 *      doesn't polyfill. Re-verified still broken (identical error) as of
 *      `@scelar/nodepod` 1.9.9.
 *   7. "SQLite Demo"            — works. Adapted from Nodepod's own
 *      `examples/sqlite-test`: real `node:sqlite` (Node's built-in module,
 *      no external dependency) backing a small list UI, proving an AirApp
 *      can hold real queryable state, not just serve static responses.
 *   8. "HyperFrames Preview (known broken)" — HeyGen's open-source
 *      HTML-to-MP4 video framework (github.com/heygen-com/hyperframes).
 *      `npm install` genuinely succeeds (no native-binary blocker — its full
 *      render pipeline needs Puppeteer + FFmpeg, architecturally incompatible
 *      with Nodepod, but `npm install` alone doesn't invoke either), but
 *      `hyperframes preview` (the lightweight, Puppeteer/FFmpeg-free preview
 *      command) crashes immediately with `TypeError: require is not a
 *      function` inside Nodepod's Node runtime — reproduced identically with
 *      and without `"type": "module"` in package.json, so it isn't a
 *      CJS/ESM config mistake on our end. Re-verified still broken (identical
 *      error) as of `@scelar/nodepod` 1.9.9.
 *
 * Deliberately not ported: most of Nodepod's other `examples/*` are their
 * own internal regression-test harnesses (multi-boot races, native-WASI
 * probes, reload-routing edge cases, etc.) rather than product-shaped demos
 * — not a good fit for an end-user-facing AirApp gallery. Also checked
 * Nodepod's official examples for a Next.js one — `examples/next-reload-debug`
 * looks Next.js-named but is actually an internal reload-behavior debug
 * harness (a single static `index.html`, nothing Next.js-related); no real
 * Next.js example exists upstream to adapt. Next.js's default compiler is
 * SWC (still known-broken here, see #6) — its Babel fallback (see #5) is no
 * longer known-broken as of Nodepod 1.9.6+, so a from-scratch Next.js-with-
 * Babel demo might now be worth revisiting, but hasn't been tried.
 *
 * See the airapp changelogs under `apps/busabase/content/changelog/` for the
 * full investigation behind #3, #5, and #6, including how #3's working
 * config was found and when #5 was confirmed fixed.
 *
 * #9-11 are a different category from #1-8 above: those prove out Nodepod
 * *capabilities* (a framework/runtime either works or it doesn't); these
 * three prove out the actual product pitch — an AirApp as a real, live tool,
 * not just a sandboxed toy.
 *
 * #9-10 read the workspace's own live data via the public REST API
 * (`GET /api/v1/bases`, `GET /api/v1/records/paged`) — read-only, no writes,
 * so there's no risk of an AirApp corrupting real Base data. Both are
 * zero-dependency (`node:http` + a static page, same execution model as #1)
 * so they also qualify for the fast baseline seed.
 *
 * Both fetch through the `/__busabase_api__/<real-path>` bridge (see
 * `changelog/20260715-airapp-busabase-api-bridge.md`), NOT a bare
 * `fetch("/api/v1/...")`. A first attempt at these two demos tried the bare
 * path and got a flat 404 from every request, including real busabase
 * routes — confirmed (via a purpose-built probe returning
 * `GUEST_SERVER_404_FOR:<path>` from the AirApp's *own* server) that
 * Nodepod's service worker claims the entire preview scope and routes every
 * same-origin fetch to the sandboxed guest process, with no passthrough to
 * the real network — same-origin alone doesn't get you there, same as that
 * changelog already found. The bridge prefix is what actually reaches the
 * real backend (with the viewer's session, since it's a genuine
 * `credentials: "include"` browser fetch outside the sandbox). Both demos'
 * `fetch()` calls run in the client-side `<script>` the guest server serves
 * (a real browser context, not the sandboxed Worker) — the only path
 * actually verified here; whether the bridge also intercepts a fetch made
 * server-side, inside the guest Node process itself, wasn't tested.
 *
 *   9. "Deal Pipeline Board"    — reads the standard demo dataset's `deals`
 *      Base (CRM folder) and renders it as a 4-column kanban (Prospecting /
 *      Proposal / Won / Lost) with a running amount total per column. Shows
 *      a friendly empty state (not an error) if the `deals` Base isn't
 *      present, e.g. a workspace seeded without the CRM folder.
 *  10. "Compliance Status Board" — reads `compliance-checklists` (Compliance
 *      folder), groups by status (Missing / In review / Complete), and
 *      flags any item whose `due_date` has passed and isn't Complete yet —
 *      the kind of "what needs attention today" view a compliance owner
 *      would actually want, not just a raw table.
 *  11. "Kelly Email" — a different flavor of "real, not synthetic": a real
 *      app-in-skill (an email review desk), not a live-data view over the
 *      seeded demo dataset, ported from the `kelly-email` local skill. See
 *      `demo-content-kelly-email.ts` for the full port rationale (esbuild
 *      bundling to work around a Nodepod TypeScript-stripper bug, why the
 *      bundle's file placement matters) — kept in its own file purely for
 *      size (~390KB of real app content vs. a few KB per demo here). Not
 *      zero-dependency (48 real npm packages), so unlike #9-10 it's not in
 *      the fast baseline seed.
 *  12. "Workspace Data Explorer" — the canonical SDK-RPC data reader. Same
 *      "real, live workspace data" pitch as #9-10, but where those two hit the
 *      raw REST API with bare `fetch("/__busabase_api__/api/v1/...")`, this one
 *      goes through `busabase-sdk`'s `createBusabaseRpcClient` (the fully-typed
 *      oRPC transport the dashboard's own frontend uses) to list the
 *      workspace's nodes (`nodes.list`) and drill into them: a Doc renders its
 *      body (`docs.get`), a Base renders its records as a table
 *      (`records.listPaged` by the base node's `baseId`), a File shows its
 *      asset metadata + a text preview (`files.get`), and anything else shows
 *      metadata. Auto-detects `/api/rpc/core` (busabase-cloud) vs `/api/rpc`
 *      (OSS busabase) by probing both. Like Kelly Email it has an esbuild build
 *      step (the SDK + its `@orpc/client` dep + the cloud contract's zod graph
 *      bundle to a ~418KB browser script, baked in at authoring time and served
 *      as a static `client.js`), so it's likewise NOT in the fast baseline
 *      seed. See `demo-content-data-explorer.ts`.
 */

import { AIRAPP_DEMO_DATA_EXPLORER } from "./demo-content-data-explorer";
import { AIRAPP_DEMO_KELLY_EMAIL } from "./demo-content-kelly-email";

export interface AirAppDemoFile {
  path: string;
  content: string;
}

export interface AirAppDemoDef {
  slug: string;
  name: string;
  description: string;
  files: AirAppDemoFile[];
}

const CARD_STYLE_CSS = (accent: string, accentDark: string) => `:root {
  color-scheme: light;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: radial-gradient(circle at top left, ${accent}, ${accentDark} 55%, #111827);
  color: #1e1b4b;
}

.card {
  width: min(90vw, 30rem);
  padding: 2.5rem;
  border-radius: 1rem;
  background: #ffffff;
  box-shadow: 0 20px 45px -15px rgba(17, 24, 39, 0.45);
  text-align: center;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: color-mix(in srgb, ${accent} 15%, white);
  color: ${accentDark};
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

h1 {
  margin: 1rem 0 0.5rem;
  font-size: 1.75rem;
}

p {
  margin: 0 0 1.5rem;
  line-height: 1.6;
  color: #4b5563;
}

button {
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  background: ${accentDark};
  color: white;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
}

ul {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  text-align: left;
}

li {
  padding: 0.5rem 0.75rem;
  border-radius: 0.375rem;
  background: #f9fafb;
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}

form {
  display: flex;
  gap: 0.5rem;
}

input {
  flex: 1;
  padding: 0.6rem 0.75rem;
  border-radius: 0.5rem;
  border: 1px solid #d1d5db;
  font-size: 0.9rem;
}
`;

// ── 1. Pure HTML Demo (works today, zero framework) ───────────────────────

const PURE_HTML_PACKAGE_JSON = JSON.stringify(
  {
    name: "pure-html-demo",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
  },
  null,
  2,
);

const PURE_HTML_SERVER_JS = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

// No framework, no bundler — five lines of node:http serving three static
// files by extension. This is the entire "backend."
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer((req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url;
  try {
    const body = readFileSync(\`.\${path}\`);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(Number(process.env.PORT) || 3000, function () {
  console.log(\`Pure HTML Demo listening on port \${this.address().port}\`);
});
`;

const PURE_HTML_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pure HTML Demo</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp · Pure HTML</span>
      <h1>Pure HTML Demo</h1>
      <p>No framework, no bundler, no dependencies in package.json — just
      index.html, CSS, and a script tag, served by a five-line node:http server.</p>
      <p>Count: <span id="count">0</span></p>
      <button id="increment" type="button">+1</button>
    </main>
    <script src="/client.js"></script>
  </body>
</html>
`;

const PURE_HTML_CLIENT_JS = `let count = 0;
const countEl = document.getElementById("count");

document.getElementById("increment").addEventListener("click", () => {
  count += 1;
  countEl.textContent = String(count);
});
`;

export const AIRAPP_DEMO_PURE_HTML: AirAppDemoDef = {
  slug: "demo-pure-html",
  name: "Pure HTML Demo",
  description:
    "Zero framework, zero build step — just index.html, CSS, and a script tag, served by a five-line node:http server. The lowest-friction AirApp starting point.",
  files: [
    { path: "package.json", content: PURE_HTML_PACKAGE_JSON },
    { path: "server.js", content: PURE_HTML_SERVER_JS },
    { path: "index.html", content: PURE_HTML_INDEX_HTML },
    { path: "style.css", content: CARD_STYLE_CSS("#f59e0b", "#b45309") },
    { path: "client.js", content: PURE_HTML_CLIENT_JS },
  ],
};

// ── 2. Hono API Demo (works today) ─────────────────────────────────────────

const HONO_PACKAGE_JSON = JSON.stringify(
  {
    name: "hono-api-demo",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
    dependencies: { hono: "^4.12.29", "@hono/node-server": "^2.0.8" },
  },
  null,
  2,
);

const HONO_SERVER_JS = `import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

const app = new Hono();

const asset = (path, contentType) => (c) =>
  c.body(readFileSync(path, "utf-8"), 200, { "Content-Type": contentType });

app.get("/", asset("index.html", "text/html; charset=utf-8"));
app.get("/style.css", asset("style.css", "text/css"));
app.get("/client.js", asset("client.js", "application/javascript"));

app.get("/api/greeting", (c) =>
  c.json({ message: "Hello from a real Hono server, running inside Nodepod." }),
);

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3000 }, (info) => {
  console.log(\`Hono API Demo listening on port \${info.port}\`);
});
`;

const HONO_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hono API Demo</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp · Hono</span>
      <h1>Hono API Demo</h1>
      <p id="greeting">Loading greeting from /api/greeting…</p>
      <button id="reload" type="button">Fetch again</button>
    </main>
    <script src="/client.js"></script>
  </body>
</html>
`;

const HONO_CLIENT_JS = `const greetingEl = document.getElementById("greeting");

async function loadGreeting() {
  greetingEl.textContent = "Loading greeting from /api/greeting…";
  const res = await fetch("/api/greeting");
  const data = await res.json();
  greetingEl.textContent = data.message;
}

document.getElementById("reload").addEventListener("click", loadGreeting);
loadGreeting();
`;

export const AIRAPP_DEMO_HONO_API: AirAppDemoDef = {
  slug: "demo-hono-api",
  name: "Hono API Demo",
  description: "A real Hono server + client fetch, runs today via the Run panel.",
  files: [
    { path: "package.json", content: HONO_PACKAGE_JSON },
    { path: "server.js", content: HONO_SERVER_JS },
    { path: "index.html", content: HONO_INDEX_HTML },
    { path: "style.css", content: CARD_STYLE_CSS("#10b981", "#047857") },
    { path: "client.js", content: HONO_CLIENT_JS },
  ],
};

// ── 3. Vite + React Demo (works — no Babel) ─────────────────────────────────

// `vite@^5.4.10` (and 4.5.5) crash inside Nodepod with `Cannot destructure
// property 'createServer'` before the dev server even binds a port. Pinning
// to `vite@7.3.1` (Nodepod's own repo, github.com/R1ck404/Nodepod
// examples/issue-44-react-dev-server, labels this their "known good"
// baseline) fixes that crash, but `@vitejs/plugin-react` uses Babel for Fast
// Refresh, and every file request 500s with `[BABEL] .length is not a valid
// Plugin property` inside Babel's own `validatePluginObject` — reproduced
// byte-for-byte against Nodepod's own reference example, not a config
// difference on our end. Dropping `@vitejs/plugin-react` entirely and using
// Vite's built-in esbuild-based JSX transform instead (`esbuild: { jsx:
// 'automatic' }`, no plugin) avoids Babel altogether and actually works:
// real 200s, real transformed JSX. Trade-off: no React Fast Refresh (edits
// full-reload instead of preserving component state) — esbuild's plain
// transform doesn't inject the Babel-based HMR boundary. Tried
// `@vitejs/plugin-react-swc` (SWC instead of Babel) too: fails with `Failed
// to load native binding` — a native-binary problem, same class of issue as
// the original esbuild crash, just for a different native tool.
const VITE_PACKAGE_JSON = JSON.stringify(
  {
    name: "vite-react-demo",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite" },
    dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" },
    devDependencies: {
      vite: "7.3.1",
    },
  },
  null,
  2,
);

const VITE_CONFIG_JS = `import { defineConfig } from 'vite';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
`;

const VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Vite + React Demo</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;

const VITE_MAIN_JSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const VITE_APP_JSX = `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Vite + React Demo</h1>
      <p>Real Vite dev server, running inside Nodepod (vite@7.3.1, esbuild JSX transform — no Fast Refresh).</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
    </main>
  );
}
`;

export const AIRAPP_DEMO_VITE_REACT: AirAppDemoDef = {
  slug: "demo-vite-react",
  name: "Vite + React Demo",
  description:
    "A real Vite dev server (vite@7.3.1, no Babel — react() plugin swapped for esbuild's built-in JSX transform). No Fast Refresh (edits full-reload).",
  files: [
    { path: "package.json", content: VITE_PACKAGE_JSON },
    { path: "vite.config.js", content: VITE_CONFIG_JS },
    { path: "index.html", content: VITE_INDEX_HTML },
    { path: "src/main.jsx", content: VITE_MAIN_JSX },
    { path: "src/App.jsx", content: VITE_APP_JSX },
  ],
};

// ── 4. Hono + Vite Dev Server ───────────────────────────────────────────────

const HONO_VITE_PACKAGE_JSON = JSON.stringify(
  {
    name: "hono-vite-demo",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "vite" },
    dependencies: { hono: "^4.12.29" },
    devDependencies: { vite: "7.3.1" },
  },
  null,
  2,
);

// Hono mounted as Vite dev-server middleware via `configureServer` — one
// process, Vite serves the frontend with HMR, Hono answers `/api/*`. A
// common real full-stack pattern. Pinned to vite@7.3.1 for the same reason
// as the Vite + React demo above.
const HONO_VITE_CONFIG_JS = `import { defineConfig } from "vite";
import { Hono } from "hono";

const api = new Hono();
api.get("/api/hello", (c) => c.json({ message: "Hello from Hono, mounted inside Vite's dev server." }));

export default defineConfig({
  plugins: [
    {
      name: "hono-api-middleware",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/")) return next();
          const response = await api.fetch(new Request(\`http://localhost\${req.url}\`, { method: req.method }));
          res.statusCode = response.status;
          res.end(await response.text());
        });
      },
    },
  ],
  server: { host: "0.0.0.0", port: 5173, strictPort: true },
});
`;

const HONO_VITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Hono + Vite Dev Server</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp · Hono + Vite</span>
      <h1>Hono + Vite Dev Server</h1>
      <p id="greeting">Loading greeting from /api/hello…</p>
    </main>
    <script type="module" src="/client.js"></script>
  </body>
</html>
`;

const HONO_VITE_CLIENT_JS = `const greetingEl = document.getElementById("greeting");
fetch("/api/hello")
  .then((res) => res.json())
  .then((data) => {
    greetingEl.textContent = data.message;
  });
`;

export const AIRAPP_DEMO_HONO_VITE: AirAppDemoDef = {
  slug: "demo-hono-vite",
  name: "Hono + Vite Dev Server",
  description:
    "Hono mounted as Vite middleware (vite@7.3.1) — one process, Vite serves the frontend, Hono answers /api/*.",
  files: [
    { path: "package.json", content: HONO_VITE_PACKAGE_JSON },
    { path: "vite.config.js", content: HONO_VITE_CONFIG_JS },
    { path: "index.html", content: HONO_VITE_INDEX_HTML },
    { path: "style.css", content: CARD_STYLE_CSS("#f59e0b", "#b45309") },
    { path: "client.js", content: HONO_VITE_CLIENT_JS },
  ],
};

// ── 5. Vite + React with Fast Refresh (Babel) ───────────────────────────────

// Same vite@7.3.1 + React app as demo #2, but with `@vitejs/plugin-react`
// (Babel-based Fast Refresh) left in instead of dropped. Originally seeded as
// a known-broken negative example — every file request 500'd with `[BABEL]
// .length is not a valid Plugin property` — but re-verified after bumping
// `@scelar/nodepod` from 1.9.5 to 1.9.9 (2026-07-13/14 releases) and the bug
// is genuinely fixed upstream: confirmed live, including clicking the
// counter button and watching Fast Refresh preserve component state on edit.
// Kept alongside demo #2 (the esbuild-transform version) since this one
// demonstrates real Fast Refresh, which #2 explicitly trades away.
const VITE_BABEL_PACKAGE_JSON = JSON.stringify(
  {
    name: "vite-react-babel-demo",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite" },
    dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" },
    devDependencies: {
      vite: "7.3.1",
      "@vitejs/plugin-react": "^4.5.0",
    },
  },
  null,
  2,
);

const VITE_BABEL_CONFIG_JS = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
`;

const VITE_BABEL_APP_JSX = `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Vite + React with Fast Refresh</h1>
      <p>Real Vite dev server, running inside Nodepod (vite@7.3.1, @vitejs/plugin-react — Babel-based Fast Refresh, edits preserve component state).</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
    </main>
  );
}
`;

export const AIRAPP_DEMO_VITE_REACT_BABEL: AirAppDemoDef = {
  slug: "demo-vite-react-babel",
  name: "Vite + React with Fast Refresh",
  description:
    "A real Vite dev server (vite@7.3.1) with @vitejs/plugin-react's Babel-based Fast Refresh — edits preserve component state, unlike 'Vite + React Demo'. Was a known-broken negative example until Nodepod fixed its Babel plugin-loading bug upstream (1.9.6+).",
  files: [
    { path: "package.json", content: VITE_BABEL_PACKAGE_JSON },
    { path: "vite.config.js", content: VITE_BABEL_CONFIG_JS },
    { path: "index.html", content: VITE_INDEX_HTML },
    { path: "src/main.jsx", content: VITE_MAIN_JSX },
    { path: "src/App.jsx", content: VITE_BABEL_APP_JSX },
  ],
};

// ── 6. Vite + React (SWC — known broken) ────────────────────────────────────

// Same app again, this time with `@vitejs/plugin-react-swc` (SWC-based Fast
// Refresh, no Babel at all) — an attempt to keep Fast Refresh without
// Babel's bug. Also kept as a seeded negative example: `@swc/core` ships a
// platform-native binary, same as esbuild originally did, and Nodepod
// doesn't polyfill it — clicking Run fails with `Failed to load native
// binding` instead of a working preview.
const VITE_SWC_PACKAGE_JSON = JSON.stringify(
  {
    name: "vite-react-swc-demo",
    private: true,
    version: "0.0.0",
    type: "module",
    scripts: { dev: "vite" },
    dependencies: { react: "^19.1.0", "react-dom": "^19.1.0" },
    devDependencies: {
      vite: "7.3.1",
      "@vitejs/plugin-react-swc": "^3.7.0",
    },
  },
  null,
  2,
);

const VITE_SWC_CONFIG_JS = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
`;

const VITE_SWC_APP_JSX = `import { useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem" }}>
      <h1>Vite + React (SWC, known broken)</h1>
      <p>If you're reading this, Nodepod now polyfills @swc/core's native binding — file an update on the airapp changelog.</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
    </main>
  );
}
`;

export const AIRAPP_DEMO_VITE_REACT_SWC_BROKEN: AirAppDemoDef = {
  slug: "demo-vite-react-swc",
  name: "Vite + React (SWC, known broken)",
  description:
    "⚠️ Known broken: @vitejs/plugin-react-swc needs @swc/core's native binary, which has no matching platform in Nodepod (`Failed to load native binding`). Same class of issue as the original esbuild crash, different tool.",
  files: [
    { path: "package.json", content: VITE_SWC_PACKAGE_JSON },
    { path: "vite.config.js", content: VITE_SWC_CONFIG_JS },
    { path: "index.html", content: VITE_INDEX_HTML },
    { path: "src/main.jsx", content: VITE_MAIN_JSX },
    { path: "src/App.jsx", content: VITE_SWC_APP_JSX },
  ],
};

// ── 7. SQLite Demo (works) ──────────────────────────────────────────────────

// Adapted from Nodepod's own examples/sqlite-test — real `node:sqlite`
// (Node's built-in SQLite module, no external dependency) running inside
// Nodepod's virtual filesystem. Demonstrates that an AirApp can hold real,
// queryable state, not just serve static responses: a Hono server opens an
// in-memory `DatabaseSync`, seeds a few rows, and exposes list/add endpoints
// a small form talks to.
const SQLITE_PACKAGE_JSON = JSON.stringify(
  {
    name: "sqlite-demo",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
    dependencies: { hono: "^4.12.29", "@hono/node-server": "^2.0.8" },
  },
  null,
  2,
);

const SQLITE_SERVER_JS = `import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL)");
const seed = db.prepare("INSERT INTO items (label) VALUES (?)");
for (const label of ["Read the AirApp changelog", "Click Run again", "Ship it"]) {
  seed.run(label);
}

const app = new Hono();

const asset = (path, contentType) => (c) =>
  c.body(readFileSync(path, "utf-8"), 200, { "Content-Type": contentType });

app.get("/", asset("index.html", "text/html; charset=utf-8"));
app.get("/style.css", asset("style.css", "text/css"));
app.get("/client.js", asset("client.js", "application/javascript"));

app.get("/api/items", (c) => {
  const rows = db.prepare("SELECT id, label FROM items ORDER BY id").all();
  return c.json(rows);
});

app.post("/api/items", async (c) => {
  const { label } = await c.req.json();
  if (!label || typeof label !== "string") {
    return c.json({ error: "label is required" }, 400);
  }
  db.prepare("INSERT INTO items (label) VALUES (?)").run(label);
  const rows = db.prepare("SELECT id, label FROM items ORDER BY id").all();
  return c.json(rows);
});

serve({ fetch: app.fetch, port: Number(process.env.PORT) || 3000 }, (info) => {
  console.log(\`SQLite Demo listening on port \${info.port}\`);
});
`;

const SQLITE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SQLite Demo</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp · node:sqlite</span>
      <h1>SQLite Demo</h1>
      <p>Real node:sqlite, running inside Nodepod — no external database.</p>
      <ul id="items"></ul>
      <form id="add-form">
        <input id="label-input" type="text" placeholder="New item…" required />
        <button type="submit">Add</button>
      </form>
    </main>
    <script src="/client.js"></script>
  </body>
</html>
`;

const SQLITE_CLIENT_JS = `const itemsEl = document.getElementById("items");
const formEl = document.getElementById("add-form");
const inputEl = document.getElementById("label-input");

function renderItems(items) {
  itemsEl.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item.label;
    itemsEl.appendChild(li);
  }
}

async function loadItems() {
  const res = await fetch("/api/items");
  renderItems(await res.json());
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  const label = inputEl.value.trim();
  if (!label) return;
  const res = await fetch("/api/items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  renderItems(await res.json());
  inputEl.value = "";
});

loadItems();
`;

export const AIRAPP_DEMO_SQLITE: AirAppDemoDef = {
  slug: "demo-sqlite",
  name: "SQLite Demo",
  description:
    "Real node:sqlite (Node's built-in SQLite module), running inside Nodepod — a list backed by real SQL, not just static JSON.",
  files: [
    { path: "package.json", content: SQLITE_PACKAGE_JSON },
    { path: "server.js", content: SQLITE_SERVER_JS },
    { path: "index.html", content: SQLITE_INDEX_HTML },
    { path: "style.css", content: CARD_STYLE_CSS("#8b5cf6", "#6d28d9") },
    { path: "client.js", content: SQLITE_CLIENT_JS },
  ],
};

// ── 8. HyperFrames Preview (known broken) ───────────────────────────────────

// HeyGen's open-source HTML-to-MP4 video framework
// (github.com/heygen-com/hyperframes). Spike-tested directly in Nodepod:
// `npm install hyperframes` genuinely succeeds (82 packages, no native-binary
// blocker — its full render pipeline needs Puppeteer + FFmpeg, but installing
// alone doesn't invoke either), but running the lightweight preview command
// crashes immediately inside Nodepod's Node runtime with `TypeError: require
// is not a function`, reproduced identically with and without `"type":
// "module"` in package.json — not a CJS/ESM config mistake on our end, a real
// Nodepod runtime limitation. Kept as a live regression check the same way
// the Babel/SWC Vite demos are: if Nodepod's `require` polyfill gets fixed,
// clicking Run here should start succeeding instead of erroring.
const HYPERFRAMES_PACKAGE_JSON = JSON.stringify(
  {
    name: "hyperframes-preview-demo",
    private: true,
    version: "0.1.0",
    scripts: { dev: "hyperframes preview" },
    dependencies: { hyperframes: "^0.7.54" },
  },
  null,
  2,
);

export const AIRAPP_DEMO_HYPERFRAMES_BROKEN: AirAppDemoDef = {
  slug: "demo-hyperframes",
  name: "HyperFrames Preview (known broken)",
  description:
    "⚠️ Known broken: HeyGen's HyperFrames CLI (github.com/heygen-com/hyperframes) installs cleanly, but `hyperframes preview` crashes inside Nodepod's Node runtime with `TypeError: require is not a function` — a real runtime limitation, not a config issue (reproduced with and without ESM). Its full render pipeline (Puppeteer + FFmpeg) wouldn't run in-browser anyway.",
  files: [{ path: "package.json", content: HYPERFRAMES_PACKAGE_JSON }],
};

// ── 9. Deal Pipeline Board (works today, reads live workspace data) ────────

const DEAL_PIPELINE_PACKAGE_JSON = JSON.stringify(
  {
    name: "deal-pipeline-board",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
  },
  null,
  2,
);

// Same five-line static-file server as the Pure HTML demo (#1) — the fetch
// to Busabase's own API happens client-side, see the module docblock for why.
const DEAL_PIPELINE_SERVER_JS = `import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer((req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url;
  try {
    const body = readFileSync(\`.\${path}\`);
    res.writeHead(200, {
      "Content-Type": contentTypes[extname(path)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(Number(process.env.PORT) || 3000, function () {
  console.log(\`Deal Pipeline Board listening on port \${this.address().port}\`);
});
`;

const BOARD_STYLE_CSS = `:root { color-scheme: light; }

body {
  margin: 0;
  min-height: 100vh;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

header {
  padding: 1.5rem 2rem 1rem;
  border-bottom: 1px solid #e2e8f0;
  background: white;
}

header .badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  background: #eef2ff;
  color: #4338ca;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

header h1 { margin: 0.5rem 0 0.25rem; font-size: 1.4rem; }
header p { margin: 0; color: #64748b; font-size: 0.85rem; }

#board {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(15rem, 1fr);
  gap: 1rem;
  padding: 1.5rem 2rem;
  align-items: start;
}

.column {
  background: #f1f5f9;
  border-radius: 0.75rem;
  padding: 0.75rem;
}

.column h2 {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin: 0.25rem 0.5rem 0.75rem;
  display: flex;
  justify-content: space-between;
  color: #475569;
}

.column .total { font-weight: 700; color: #0f172a; }

.item {
  background: white;
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  font-size: 0.85rem;
}

.item .name { font-weight: 600; margin-bottom: 0.25rem; }
.item .meta { color: #64748b; font-size: 0.78rem; }
.item.overdue { border-left: 3px solid #dc2626; }

#empty {
  margin: 2rem;
  padding: 1.5rem;
  border: 1px dashed #cbd5e1;
  border-radius: 0.75rem;
  color: #64748b;
  font-size: 0.9rem;
  max-width: 32rem;
}
`;

const DEAL_PIPELINE_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deal Pipeline Board</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Deal Pipeline Board</h1>
      <p>Reads this workspace's own "deals" Base via the Busabase REST API — not seeded, not synthetic.</p>
    </header>
    <div id="board"></div>
    <script src="client.js"></script>
  </body>
</html>
`;

const DEAL_PIPELINE_CLIENT_JS = `const STAGES = [
  { id: "prospecting", label: "Prospecting" },
  { id: "proposal", label: "Proposal" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

const board = document.getElementById("board");

function money(n) {
  return typeof n === "number" ? "$" + n.toLocaleString("en-US") : "—";
}

function showEmpty(message) {
  board.innerHTML = "";
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  board.replaceWith(div);
}

async function loadDeals() {
  const basesRes = await fetch("/__busabase_api__/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();
  const deals = bases.find((b) => b.slug === "deals");
  if (!deals) {
    showEmpty(
      'No "deals" Base found in this workspace (slug: deals). This demo reads a real Base live — seed the standard demo dataset (CRM folder) to see it populated.',
    );
    return;
  }

  const recordsRes = await fetch("/__busabase_api__/api/v1/records/paged?baseId=" + deals.id + "&limit=100");
  if (!recordsRes.ok) throw new Error("GET /api/v1/records/paged → " + recordsRes.status);
  const { records } = await recordsRes.json();

  for (const stage of STAGES) {
    const items = records.filter((r) => r.headCommit?.fields?.stage === stage.id);
    const total = items.reduce((sum, r) => sum + (Number(r.headCommit?.fields?.amount) || 0), 0);

    const column = document.createElement("div");
    column.className = "column";
    column.innerHTML =
      '<h2>' + stage.label + ' <span class="total">' + money(total) + "</span></h2>";

    for (const record of items) {
      const fields = record.headCommit?.fields ?? {};
      const item = document.createElement("div");
      item.className = "item";
      item.innerHTML =
        '<div class="name"></div><div class="meta"></div>';
      item.querySelector(".name").textContent = fields.name || "(untitled)";
      item.querySelector(".meta").textContent =
        [money(fields.amount), fields.owner, fields.close_date].filter(Boolean).join(" · ");
      column.appendChild(item);
    }
    board.appendChild(column);
  }
}

loadDeals().catch((err) => showEmpty("Couldn't load deals: " + err.message));
`;

export const AIRAPP_DEMO_DEAL_PIPELINE: AirAppDemoDef = {
  slug: "demo-deal-pipeline",
  name: "Deal Pipeline Board",
  description:
    'A live kanban over this workspace\'s own "deals" Base (CRM folder), read via the public REST API — not a synthetic demo. Zero npm dependencies.',
  files: [
    { path: "package.json", content: DEAL_PIPELINE_PACKAGE_JSON },
    { path: "server.js", content: DEAL_PIPELINE_SERVER_JS },
    { path: "index.html", content: DEAL_PIPELINE_INDEX_HTML },
    { path: "style.css", content: BOARD_STYLE_CSS },
    { path: "client.js", content: DEAL_PIPELINE_CLIENT_JS },
  ],
};

// ── 10. Compliance Status Board (works today, reads live workspace data) ───

const COMPLIANCE_BOARD_PACKAGE_JSON = JSON.stringify(
  {
    name: "compliance-status-board",
    private: true,
    version: "0.1.0",
    type: "module",
    scripts: { dev: "node server.js" },
  },
  null,
  2,
);

const COMPLIANCE_BOARD_SERVER_JS = DEAL_PIPELINE_SERVER_JS.replace(
  "Deal Pipeline Board",
  "Compliance Status Board",
);

const COMPLIANCE_BOARD_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Compliance Status Board</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <header>
      <span class="badge">AirApp · Live workspace data</span>
      <h1>Compliance Status Board</h1>
      <p>Reads this workspace's own "compliance-checklists" Base via the Busabase REST API and flags overdue items.</p>
    </header>
    <div id="board"></div>
    <script src="client.js"></script>
  </body>
</html>
`;

const COMPLIANCE_BOARD_CLIENT_JS = `const STATUSES = [
  { id: "missing", label: "Missing" },
  { id: "review", label: "In review" },
  { id: "complete", label: "Complete" },
];

const board = document.getElementById("board");

function showEmpty(message) {
  const div = document.createElement("div");
  div.id = "empty";
  div.textContent = message;
  board.replaceWith(div);
}

function isOverdue(fields) {
  if (fields.status === "complete" || !fields.due_date) return false;
  return new Date(fields.due_date).getTime() < Date.now();
}

async function loadChecklist() {
  const basesRes = await fetch("/__busabase_api__/api/v1/bases");
  if (!basesRes.ok) throw new Error("GET /api/v1/bases → " + basesRes.status);
  const bases = await basesRes.json();
  const checklist = bases.find((b) => b.slug === "compliance-checklists");
  if (!checklist) {
    showEmpty(
      'No "compliance-checklists" Base found in this workspace (slug: compliance-checklists). This demo reads a real Base live — seed the standard demo dataset (Compliance folder) to see it populated.',
    );
    return;
  }

  const recordsRes = await fetch("/__busabase_api__/api/v1/records/paged?baseId=" + checklist.id + "&limit=100");
  if (!recordsRes.ok) throw new Error("GET /api/v1/records/paged → " + recordsRes.status);
  const { records } = await recordsRes.json();

  for (const status of STATUSES) {
    const items = records.filter((r) => r.headCommit?.fields?.status === status.id);
    const overdueCount = items.filter((r) => isOverdue(r.headCommit?.fields ?? {})).length;

    const column = document.createElement("div");
    column.className = "column";
    column.innerHTML =
      '<h2>' +
      status.label +
      ' <span class="total">' +
      (overdueCount > 0 ? overdueCount + " overdue" : "") +
      "</span></h2>";

    for (const record of items) {
      const fields = record.headCommit?.fields ?? {};
      const item = document.createElement("div");
      item.className = "item" + (isOverdue(fields) ? " overdue" : "");
      item.innerHTML = '<div class="name"></div><div class="meta"></div>';
      item.querySelector(".name").textContent = fields.item || "(untitled)";
      item.querySelector(".meta").textContent =
        [fields.owner, fields.due_date].filter(Boolean).join(" · ");
      column.appendChild(item);
    }
    board.appendChild(column);
  }
}

loadChecklist().catch((err) => showEmpty("Couldn't load checklist: " + err.message));
`;

export const AIRAPP_DEMO_COMPLIANCE_BOARD: AirAppDemoDef = {
  slug: "demo-compliance-board",
  name: "Compliance Status Board",
  description:
    'A live status board over this workspace\'s own "compliance-checklists" Base (Compliance folder), flagging overdue items — read via the public REST API, not a synthetic demo. Zero npm dependencies.',
  files: [
    { path: "package.json", content: COMPLIANCE_BOARD_PACKAGE_JSON },
    { path: "server.js", content: COMPLIANCE_BOARD_SERVER_JS },
    { path: "index.html", content: COMPLIANCE_BOARD_INDEX_HTML },
    { path: "style.css", content: BOARD_STYLE_CSS },
    { path: "client.js", content: COMPLIANCE_BOARD_CLIENT_JS },
  ],
};

/** Full gallery, in the narrative order described in this file's docblock. */
export const ALL_AIRAPP_DEMOS: AirAppDemoDef[] = [
  AIRAPP_DEMO_PURE_HTML,
  AIRAPP_DEMO_HONO_API,
  AIRAPP_DEMO_VITE_REACT,
  AIRAPP_DEMO_HONO_VITE,
  AIRAPP_DEMO_VITE_REACT_BABEL,
  AIRAPP_DEMO_VITE_REACT_SWC_BROKEN,
  AIRAPP_DEMO_SQLITE,
  AIRAPP_DEMO_HYPERFRAMES_BROKEN,
  AIRAPP_DEMO_DEAL_PIPELINE,
  AIRAPP_DEMO_COMPLIANCE_BOARD,
  AIRAPP_DEMO_DATA_EXPLORER,
  AIRAPP_DEMO_KELLY_EMAIL,
];
