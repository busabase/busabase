/**
 * Shared catalog of AirApp demo projects — the single source of truth for
 * every AirApp demo's file content. Two very different consumers need the
 * same content and must not fork it:
 *
 *   - `apps/busabase/scripts/demo/14-airapps.ts` — an integration/smoke test
 *     that creates all of these via the real REST API (`POST /airapps`).
 *   - `packages/busabase-core/src/demo/scenarios/node-types.en.ts` — a
 *     lower-level seed path (direct DB writes, no HTTP) consumed by
 *     `pnpm db:seed:all` and demo mode. It only seeds the two fast,
 *     dependency-light demos (Hono API, SQLite) — the Vite-based ones are
 *     intentionally left out of that fast baseline seed (slower installs,
 *     and two of the five are deliberately-broken negative examples).
 *
 * What each demo shows about the Run panel (Nodepod-backed, see
 * `packages/busabase-core/src/domains/airapp/`) — 4 working, 2 kept as live,
 * runnable negative examples rather than deleted, so a Run click shows the
 * real upstream failure instead of it only being documented in prose:
 *
 *   1. "Hono API Demo"          — pure Hono + @hono/node-server. Works.
 *   2. "Vite + React Demo"      — works, pinned to `vite@7.3.1` (the exact
 *      version Nodepod's own repo, github.com/R1ck404/Nodepod
 *      examples/issue-44-react-dev-server, labels "known good" —
 *      `vite@^5.4.10`/`4.5.5` crash with `Cannot destructure property
 *      'createServer'` before the dev server even binds a port). Drops
 *      `@vitejs/plugin-react` entirely and uses Vite's built-in
 *      esbuild-based JSX transform instead, avoiding Babel altogether.
 *      Trade-off: no Fast Refresh — edits full-reload instead of preserving
 *      component state.
 *   3. "Hono + Vite Dev Server" — works, same vite@7.3.1 pin. No React/Babel
 *      involved (Hono mounted as Vite middleware via `configureServer`,
 *      plain HTML/JS frontend), so this one was only ever blocked by the
 *      vite@5 `createServer` crash, not the Babel issue below.
 *   4. "Vite + React (Babel, known broken)" — identical app to #2, but with
 *      `@vitejs/plugin-react` (Babel-based Fast Refresh) left in. Every file
 *      request 500s with `[BABEL] .length is not a valid Plugin property` —
 *      reproduced byte-for-byte against Nodepod's own "known good" example,
 *      not a config difference on our end.
 *   5. "Vite + React (SWC, known broken)" — same app again, with
 *      `@vitejs/plugin-react-swc` instead (SWC-based Fast Refresh, no
 *      Babel). Fails differently: `Failed to load native binding` —
 *      `@swc/core` ships a platform-native binary, same class of problem as
 *      the original esbuild crash, just a different native tool Nodepod
 *      doesn't polyfill.
 *   6. "SQLite Demo"            — works. Adapted from Nodepod's own
 *      `examples/sqlite-test`: real `node:sqlite` (Node's built-in module,
 *      no external dependency) backing a small list UI, proving an AirApp
 *      can hold real queryable state, not just serve static responses.
 *   7. "HyperFrames Preview (known broken)" — HeyGen's open-source
 *      HTML-to-MP4 video framework (github.com/heygen-com/hyperframes).
 *      `npm install` genuinely succeeds (no native-binary blocker — its full
 *      render pipeline needs Puppeteer + FFmpeg, architecturally incompatible
 *      with Nodepod, but `npm install` alone doesn't invoke either), but
 *      `hyperframes preview` (the lightweight, Puppeteer/FFmpeg-free preview
 *      command) crashes immediately with `TypeError: require is not a
 *      function` inside Nodepod's Node runtime — reproduced identically with
 *      and without `"type": "module"` in package.json, so it isn't a
 *      CJS/ESM config mistake on our end.
 *
 * Deliberately not ported: most of Nodepod's other `examples/*` are their
 * own internal regression-test harnesses (multi-boot races, native-WASI
 * probes, reload-routing edge cases, etc.) rather than product-shaped demos
 * — not a good fit for an end-user-facing AirApp gallery. Also checked
 * Nodepod's official examples for a Next.js one — `examples/next-reload-debug`
 * looks Next.js-named but is actually an internal reload-behavior debug
 * harness (a single static `index.html`, nothing Next.js-related); no real
 * Next.js example exists upstream to adapt. Next.js's default compiler is
 * SWC (already known-broken here, see #5) and its Babel fallback is also
 * already known-broken (see #4), so a from-scratch Next.js demo would very
 * likely just reproduce one of those two failures rather than reveal
 * anything new — not added for now.
 *
 * See the airapp changelogs under `apps/busabase/content/changelog/` for the
 * full investigation behind #2, #4, and #5, including how #2's working
 * config was found.
 */

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

// ── 1. Hono API Demo (works today) ────────────────────────────────────────

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

serve({ fetch: app.fetch, port: 3000 }, (info) => {
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

// ── 2. Vite + React Demo (works — no Babel) ─────────────────────────────────

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

// ── 3. Hono + Vite Dev Server ───────────────────────────────────────────────

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

// ── 4. Vite + React (Babel — known broken) ──────────────────────────────────

// Same vite@7.3.1 + React app as demo #2, but with `@vitejs/plugin-react`
// (Babel-based Fast Refresh) left in instead of dropped. Kept as a seeded,
// runnable negative example — clicking Run reproduces the exact failure
// documented in the airapp changelog: every file request 500s with
// `[BABEL] .length is not a valid Plugin property`. Useful as a live
// regression check once Nodepod fixes this upstream (Run should start
// succeeding instead of erroring), and as a reference for anyone tempted to
// add `@vitejs/plugin-react` back for Fast Refresh.
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
      <h1>Vite + React (Babel, known broken)</h1>
      <p>If you're reading this, Nodepod's Babel plugin-loading bug is fixed — file an update on the airapp changelog.</p>
      <button type="button" onClick={() => setCount((c) => c + 1)}>
        count is {count}
      </button>
    </main>
  );
}
`;

export const AIRAPP_DEMO_VITE_REACT_BABEL_BROKEN: AirAppDemoDef = {
  slug: "demo-vite-react-babel",
  name: "Vite + React (Babel, known broken)",
  description:
    "⚠️ Known broken: @vitejs/plugin-react uses Babel internally, which has a bug in Nodepod (`[BABEL] .length is not a valid Plugin property`). Kept as a live regression check — see 'Vite + React Demo' for the working config (drop the plugin, use esbuild's JSX transform instead).",
  files: [
    { path: "package.json", content: VITE_BABEL_PACKAGE_JSON },
    { path: "vite.config.js", content: VITE_BABEL_CONFIG_JS },
    { path: "index.html", content: VITE_INDEX_HTML },
    { path: "src/main.jsx", content: VITE_MAIN_JSX },
    { path: "src/App.jsx", content: VITE_BABEL_APP_JSX },
  ],
};

// ── 5. Vite + React (SWC — known broken) ────────────────────────────────────

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

// ── 6. SQLite Demo (works) ──────────────────────────────────────────────────

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

serve({ fetch: app.fetch, port: 3000 }, (info) => {
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

// ── 7. HyperFrames Preview (known broken) ───────────────────────────────────

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

/** Full gallery, in the narrative order described in this file's docblock. */
export const ALL_AIRAPP_DEMOS: AirAppDemoDef[] = [
  AIRAPP_DEMO_HONO_API,
  AIRAPP_DEMO_VITE_REACT,
  AIRAPP_DEMO_HONO_VITE,
  AIRAPP_DEMO_VITE_REACT_BABEL_BROKEN,
  AIRAPP_DEMO_VITE_REACT_SWC_BROKEN,
  AIRAPP_DEMO_SQLITE,
  AIRAPP_DEMO_HYPERFRAMES_BROKEN,
];
