/**
 * Seed demos for the multi-language runtime.
 *
 * The gallery is how both humans and agents learn what an AirApp may be, so a
 * capability with no example here is one nobody discovers — for years every
 * demo was Node/npm, which is exactly why "an AirApp is a Node app" became
 * folklore. These three cover the paths that actually differ:
 *
 *  1. Python, no manifest at all — inference from `requirements.txt`, plus the
 *     runtime defaults (`pip install -r …`, `uvicorn main:app --port $PORT`).
 *  2. Python, fully explicit manifest — custom install/start/port, a quoted
 *     argument (which the old `command.split(" ")` argv handling would have
 *     shredded), and zero third-party dependencies so it runs with no network.
 *  3. Node, pinned engine — `preferredEngine`, advisory: honoured where
 *     available, falling back rather than making the app unrunnable.
 */

import type { AirAppDemoDef } from "./demo-content";

const PYTHON_PAGE_CSS = `:root { color-scheme: light; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  background: radial-gradient(circle at top left, #38bdf8, #1d4ed8 55%, #0f172a);
  color: #0f172a;
}
.card {
  background: rgba(255,255,255,0.94); border-radius: 18px; padding: 2.5rem 3rem;
  box-shadow: 0 24px 60px rgba(15,23,42,0.35); max-width: 34rem; line-height: 1.6;
}
h1 { margin: 0 0 0.5rem; font-size: 1.6rem; }
code { background: #e2e8f0; border-radius: 5px; padding: 0.1rem 0.4rem; font-size: 0.9em; }
dt { font-weight: 600; margin-top: 0.75rem; }
dd { margin: 0.15rem 0 0; color: #334155; }
`;

// ── 1. Python, inferred ─────────────────────────────────────────────────────

const PYTHON_REQUIREMENTS = `fastapi\nuvicorn\n`;

const PYTHON_MAIN_PY = `"""
A FastAPI AirApp with no airapp.json at all.

Busabase infers the runtime from requirements.txt and applies the Python
defaults: \`pip install -r requirements.txt\`, then
\`uvicorn main:app --host 0.0.0.0 --port $PORT\`. The module-level name \`app\`
below is what that default start command expects — that convention is the
reason a Python AirApp needs no configuration to run.

The inference decision is printed into the Logs tab before anything installs,
so a wrong guess is visible rather than mysterious.
"""

import os
import platform
import sys

from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

# Set by Busabase when it is the one running this process. Absence is itself
# meaningful: nobody hosted us, so we are a standalone \`uvicorn\` run.
RUNTIME = os.environ.get("BUSABASE_AIRAPP_RUNTIME")

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Python AirApp</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="card">
      <h1>Running on Python</h1>
      <p>
        No <code>airapp.json</code>, no configuration. Busabase saw
        <code>requirements.txt</code>, inferred the <code>python</code> runtime,
        and started this server with its defaults.
      </p>
      <dl>
        <dt>Python</dt><dd>{python}</dd>
        <dt>Platform</dt><dd>{platform}</dd>
        <dt>Port</dt><dd>{port}</dd>
        <dt>BUSABASE_AIRAPP_RUNTIME</dt><dd>{runtime}</dd>
      </dl>
      <p>{hosted}</p>
    </div>
  </body>
</html>
"""


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return PAGE.format(
        python=sys.version.split()[0],
        platform=platform.platform(),
        port=os.environ.get("PORT", "unset"),
        runtime=RUNTIME or "unset (standalone)",
        hosted=(
            "Busabase is hosting this process, so a relative fetch of "
            "<code>/api/v1/…</code> reaches the workspace API as you."
            if RUNTIME
            else "Started outside Busabase — this app would need its own credentials."
        ),
    )


@app.get("/style.css")
def style() -> object:
    from fastapi.responses import Response

    return Response(content=STYLE, media_type="text/css")


STYLE = """${PYTHON_PAGE_CSS}"""
`;

export const AIRAPP_DEMO_PYTHON_INFERRED: AirAppDemoDef = {
  slug: "demo-python-inferred",
  name: "Python (inferred)",
  description:
    "A FastAPI app with no airapp.json. Busabase infers the Python runtime from requirements.txt and starts it with the runtime defaults — the zero-configuration path for a non-Node AirApp.",
  files: [
    { path: "requirements.txt", content: PYTHON_REQUIREMENTS },
    { path: "main.py", content: PYTHON_MAIN_PY },
  ],
};

// ── 2. Python, explicit manifest, no dependencies ───────────────────────────

const PYTHON_STDLIB_MANIFEST = `${JSON.stringify(
  {
    runtime: "python",
    // A quoted argument on purpose: this is the shape that the previous
    // `command.split(" ")` argv handling turned into several broken tokens.
    install: "python3 -c \"print('no third-party dependencies to install')\"",
    start: "python3 server.py --port $PORT",
    port: 8137,
  },
  null,
  2,
)}\n`;

const PYTHON_STDLIB_SERVER = `"""
A Python AirApp that declares everything explicitly in airapp.json.

Three things this demonstrates that the inferred demo cannot:

  * a custom install command — this app has no dependencies, and says so,
    rather than being forced through a pip install it does not need;
  * a custom start command with \`$PORT\` — uvicorn/argparse-style tools read a
    flag, not the PORT environment variable, so the placeholder is substituted
    into the command line itself;
  * a declared port — Busabase probes it directly instead of trying to parse a
    "server started" line out of whatever this app happens to print.
"""

import argparse
import http.server
import os

CSS = """${PYTHON_PAGE_CSS}"""

PAGE = """<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Explicit Python AirApp</title>
    <style>%s</style>
  </head>
  <body>
    <div class="card">
      <h1>Explicit is also supported</h1>
      <p>
        This app's <code>airapp.json</code> declares its own install command,
        start command and port. Nothing here was guessed.
      </p>
      <dl>
        <dt>Serving port</dt><dd>%s</dd>
        <dt>Dependencies</dt><dd>none — Python standard library only</dd>
        <dt>BUSABASE_AIRAPP_RUNTIME</dt><dd>%s</dd>
      </dl>
    </div>
  </body>
</html>
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8137)
    args = parser.parse_args()
    runtime = os.environ.get("BUSABASE_AIRAPP_RUNTIME", "unset (standalone)")
    body = (PAGE % (CSS, args.port, runtime)).encode("utf-8")

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802 - stdlib-mandated name
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_args: object) -> None:
            return

    server = http.server.HTTPServer(("0.0.0.0", args.port), Handler)
    print(f"listening on port {args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
`;

export const AIRAPP_DEMO_PYTHON_EXPLICIT: AirAppDemoDef = {
  slug: "demo-python-explicit",
  name: "Python (explicit manifest)",
  description:
    "A dependency-free Python app whose airapp.json declares its own install command, a start command using the $PORT placeholder, and a fixed port. Runs with no network access at all.",
  files: [
    { path: "airapp.json", content: PYTHON_STDLIB_MANIFEST },
    { path: "server.py", content: PYTHON_STDLIB_SERVER },
  ],
};

// ── 3. Node, with a pinned engine ───────────────────────────────────────────

const PINNED_MANIFEST = `${JSON.stringify(
  {
    runtime: "node",
    // Advisory. On a deployment without this engine the app still runs on
    // whatever else is eligible — a pin that could make an app unrunnable
    // somewhere else would be a worse default than no pin at all.
    preferredEngine: "local",
  },
  null,
  2,
)}\n`;

const PINNED_PACKAGE_JSON = `${JSON.stringify(
  {
    name: "demo-node-pinned-local",
    private: true,
    type: "module",
    scripts: { dev: "node server.js", start: "node server.js" },
  },
  null,
  2,
)}\n`;

const PINNED_SERVER_JS = `import http from "node:http";
import os from "node:os";

/**
 * A Node AirApp that asks for the Local engine by name.
 *
 * Nodepod is a Node API surface reimplemented inside a browser Web Worker, so
 * anything needing a real OS process or a native binary cannot run there. An
 * app that knows it needs the real thing can say so in airapp.json instead of
 * failing at install time and leaving the reviewer to guess which engine to
 * switch to.
 */
const port = Number(process.env.PORT || 3000);
const runtime = process.env.BUSABASE_AIRAPP_RUNTIME ?? "unset (standalone)";

const page = \`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>Pinned engine</title>
<style>${PYTHON_PAGE_CSS.replace(/`/g, "\\`")}</style>
</head><body><div class="card">
<h1>This app asked for the Local engine</h1>
<p>Its <code>airapp.json</code> sets <code>preferredEngine: "local"</code>.
The preference is advisory — where that engine is unavailable, Busabase falls
back to whatever else can run the app rather than refusing to start it.</p>
<dl>
<dt>Engine reported by Busabase</dt><dd>\${runtime}</dd>
<dt>Real OS hostname</dt><dd>\${os.hostname()}</dd>
<dt>Real process id</dt><dd>\${process.pid}</dd>
<dt>Port</dt><dd>\${port}</dd>
</dl>
<p>A hostname and pid from the actual host are things the in-browser engine
cannot report — which is the whole reason for pinning.</p>
</div></body></html>\`;

http
  .createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(page);
  })
  .listen(port, () => console.log(\`listening on port \${port}\`));
`;

export const AIRAPP_DEMO_NODE_PINNED_LOCAL: AirAppDemoDef = {
  slug: "demo-node-pinned-local",
  name: "Node (pinned to Local)",
  description:
    "A Node app whose airapp.json pins preferredEngine to the Local engine, and proves it by reporting a real OS hostname and pid. The pin is advisory: elsewhere it falls back rather than failing.",
  files: [
    { path: "airapp.json", content: PINNED_MANIFEST },
    { path: "package.json", content: PINNED_PACKAGE_JSON },
    { path: "server.js", content: PINNED_SERVER_JS },
  ],
};
