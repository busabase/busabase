import "server-only";

import type {
  createAirAppChangeRequestInputSchema,
  createAirAppInputSchema,
} from "busabase-contract/domains/airapp/contract";
import type { AirAppVO, ChangeRequestVO } from "busabase-contract/types";
import type { z } from "zod";
import { registerMaterializer } from "../../logic/materialize";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  type FileTreeKindConfig,
  getFileTreeNode,
  listFileTreeFiles,
  listFileTreeNodes,
  makeMaterializer,
  readFileTreeFile,
} from "../filetree/handlers";

const AIRAPP_PACKAGE_JSON = (slug: string, description: string) =>
  `${JSON.stringify(
    {
      name: slug,
      private: true,
      version: "0.1.0",
      type: "module",
      scripts: {
        dev: "node server.js",
      },
      description: description || undefined,
      dependencies: {
        hono: "^4.12.29",
        "@hono/node-server": "^2.0.8",
      },
    },
    null,
    2,
  )}\n`;

// A plain Hono + `node server.js` server, not a Vite/bundler dev server:
// Nodepod (the in-browser runtime this runs under, see runners/nodepod-runner.ts)
// could not boot a Vite dev server inside its virtual filesystem — `npm run dev`
// failed with `Cannot destructure property 'createServer' of '(intermediate
// value)' as it is undefined`, reproducible even with COOP/COEP cross-origin
// isolation headers enabled, pointing at a deeper Nodepod↔Vite incompatibility
// rather than a missing-SharedArrayBuffer config issue. A bare `node:http`
// server was verified to install and run correctly under Nodepod, so this
// seed avoids bundler tooling entirely until that incompatibility is
// understood (see the airapp changelog's Follow-up Tasks).
const AIRAPP_SERVER_JS = `import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

const app = new Hono();

const asset = (path, contentType) => (c) =>
  c.body(readFileSync(path, "utf-8"), 200, { "Content-Type": contentType });

app.get("/", asset("index.html", "text/html; charset=utf-8"));
app.get("/style.css", asset("style.css", "text/css"));
app.get("/client.js", asset("client.js", "application/javascript"));

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(\`AirApp server listening on port \${info.port}\`);
});
`;

const AIRAPP_INDEX_HTML = (name: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp</span>
      <h1>${name}</h1>
      <p id="description"></p>
      <button id="counter" type="button">Clicked <span id="count">0</span> times</button>
    </main>
    <script src="/client.js"></script>
  </body>
</html>
`;

const AIRAPP_STYLE_CSS = `:root {
  color-scheme: light;
}

body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: radial-gradient(circle at top left, #6366f1, #4338ca 55%, #1e1b4b);
  color: #1e1b4b;
}

.card {
  width: min(90vw, 30rem);
  padding: 2.5rem;
  border-radius: 1rem;
  background: #ffffff;
  box-shadow: 0 20px 45px -15px rgba(30, 27, 75, 0.45);
  text-align: center;
}

.badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  background: #eef2ff;
  color: #4338ca;
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
  background: #4338ca;
  color: white;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.15s ease;
}

button:hover {
  background: #3730a3;
}

button:active {
  transform: scale(0.97);
}
`;

const AIRAPP_CLIENT_JS = (
  description: string,
) => `document.getElementById("description").textContent =
  ${JSON.stringify(description || "A new Busabase AirApp. Edit server.js, index.html, style.css, and client.js, then click Run to see changes.")};

let count = 0;
const countEl = document.getElementById("count");
document.getElementById("counter").addEventListener("click", () => {
  count += 1;
  countEl.textContent = String(count);
});
`;

/**
 * File-tree kind config for the "airapp" node type — mirrors drive/skill's
 * `*FileTreeConfig` shape, but the seed files produce a working minimal
 * Hono HTTP server + static HTML/CSS/JS project instead of a doc/README:
 * `npm install && npm run dev` works immediately after node creation, no
 * extra setup.
 */
export const airappFileTreeConfig = {
  type: "airapp",
  label: "AirApp",
  entryFile: "package.json",
  seedFiles: ({ slug, name, description }) => [
    { path: "package.json", content: AIRAPP_PACKAGE_JSON(slug, description) },
    { path: "server.js", content: AIRAPP_SERVER_JS },
    { path: "index.html", content: AIRAPP_INDEX_HTML(name) },
    { path: "style.css", content: AIRAPP_STYLE_CSS },
    { path: "client.js", content: AIRAPP_CLIENT_JS(description) },
  ],
} satisfies FileTreeKindConfig;

export const createAirApp = (input: z.input<typeof createAirAppInputSchema>) =>
  createFileTreeNode(airappFileTreeConfig, input) as Promise<AirAppVO | ChangeRequestVO>;

export const getAirApp = (nodeIdOrSlug: string): Promise<AirAppVO> =>
  getFileTreeNode(airappFileTreeConfig, nodeIdOrSlug) as Promise<AirAppVO>;

export const listAirApps = () => listFileTreeNodes(airappFileTreeConfig) as Promise<AirAppVO[]>;

export const listAirAppFiles = (nodeIdOrSlug: string) =>
  listFileTreeFiles(airappFileTreeConfig, nodeIdOrSlug);

export const readAirAppFile = (nodeIdOrSlug: string, filePath: string) =>
  readFileTreeFile(airappFileTreeConfig, nodeIdOrSlug, filePath);

export const createAirAppChangeRequest = (
  nodeIdOrSlug: string,
  input: z.input<typeof createAirAppChangeRequestInputSchema>,
) => createFileTreeChangeRequest(airappFileTreeConfig, nodeIdOrSlug, input);

export const materializeAirAppNode = makeMaterializer(airappFileTreeConfig);

registerMaterializer("airapp", materializeAirAppNode);
