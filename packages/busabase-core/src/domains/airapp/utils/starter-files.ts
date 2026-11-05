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

// A small Hono process serves the same public assets in Node preview and the
// site engine, without requiring a build step or uploading Node dependencies.
const AIRAPP_SERVER_JS = `import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { readFileSync } from "node:fs";

const app = new Hono();

const asset = (path, contentType) => (c) =>
  c.body(readFileSync(path, "utf-8"), 200, { "Content-Type": contentType });

app.get("/", asset("public/index.html", "text/html; charset=utf-8"));
app.get("/style.css", asset("public/style.css", "text/css"));
app.get("/client.js", asset("public/client.js", "application/javascript"));

serve({ fetch: app.fetch, port: Number(process.env.PORT || 3000) }, (info) => {
  console.log(\`AirApp server listening on port \${info.port}\`);
});
`;

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );

const AIRAPP_INDEX_HTML = (name: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(name)}</title>
    <link rel="stylesheet" href="/style.css" />
  </head>
  <body>
    <main class="card">
      <span class="badge">AirApp</span>
      <h1>${escapeHtml(name)}</h1>
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
  ${JSON.stringify(description || "A new Busabase AirApp. Edit public/index.html, public/style.css, and public/client.js, then click Run to see changes.")};

let count = 0;
const countEl = document.getElementById("count");
document.getElementById("counter").addEventListener("click", () => {
  count += 1;
  countEl.textContent = String(count);
});
`;

/** Default new AirApp: shared static assets for Node preview and the site engine. */
export const createAirAppStarterFiles = ({
  slug,
  name,
  description,
}: {
  slug: string;
  name: string;
  description: string;
}) => [
  { path: "package.json", content: AIRAPP_PACKAGE_JSON(slug, description) },
  { path: "server.js", content: AIRAPP_SERVER_JS },
  {
    // No `runtime` here on purpose. A declared runtime beats inference, and in
    // "merge" mode a caller's own files are layered on top of this starter, so a
    // declared "node" would turn a Python app that only brings `requirements.txt`
    // into a Node app. Left undeclared, this starter still resolves to node
    // (its `package.json`) and every other project keeps the runtime it implies.
    path: "airapp.json",
    content: `${JSON.stringify({ site: { assets: "public", notFoundHandling: "404-page", access: "read" } }, null, 2)}\n`,
  },
  { path: "public/index.html", content: AIRAPP_INDEX_HTML(name) },
  { path: "public/style.css", content: AIRAPP_STYLE_CSS },
  { path: "public/client.js", content: AIRAPP_CLIENT_JS(description) },
];
