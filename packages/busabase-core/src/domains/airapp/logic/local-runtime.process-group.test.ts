/**
 * Proof that ending a run reaps the process that is actually serving the app.
 *
 * The defect this guards is specific and was invisible to every other kind of
 * test: what serves an AirApp is a **grandchild**. `npm run dev` spawns
 * `node server.js`, and npm does not forward signals to it, so killing the
 * direct child left a real OS process listening on a real port after every tab
 * close and every dev-server restart. The run stream ended cleanly, no error
 * was logged, and nothing in the product looked wrong.
 *
 * So this asserts on the only thing that can tell the difference: whether
 * something is still bound to the port once the run is over. The fixture uses
 * `sh -c "... ; true"` deliberately — a lone command lets `sh` optimise itself
 * away with `exec`, which would make the server a *direct* child and quietly
 * turn this into a test of nothing.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../logic/node-acl", () => ({
  assertNodePermission: vi.fn(async () => undefined),
}));

const hasPython = spawnSync("python3", ["--version"]).status === 0;

const PORT = 8247;

const SERVER_PY = `import argparse, http.server

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=${PORT})
args = parser.parse_args()


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        body = b"<h1>alive</h1>"
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        return


# Bind BEFORE announcing. Printing first is a real bug an app can have — the
# host believes the server is up while the socket is still unbound — and it
# would make this test race its own fixture.
server = http.server.HTTPServer(("127.0.0.1", args.port), Handler)
print(f"listening on port {args.port}", flush=True)
server.serve_forever()
`;

const MANIFEST = JSON.stringify({
  runtime: "python",
  install: 'python3 -c "pass"',
  // `; true` keeps `sh` alive as a real parent instead of exec'ing into python.
  start: `sh -c "python3 server.py --port $PORT; true"`,
  port: PORT,
});

const isPortOpen = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    const settle = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
    socket.setTimeout(1_000, () => settle(false));
  });

const waitForPortClosed = async (port: number, timeoutMs: number): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortOpen(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
};

let workdirRoot: string;
let previousWorkdir: string | undefined;

beforeAll(async () => {
  workdirRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airapp-pgroup-"));
  previousWorkdir = process.env.SANDAGENT_WORKDIR;
  process.env.SANDAGENT_WORKDIR = workdirRoot;
});

afterAll(async () => {
  if (previousWorkdir === undefined) delete process.env.SANDAGENT_WORKDIR;
  else process.env.SANDAGENT_WORKDIR = previousWorkdir;
  await fs.rm(workdirRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe.skipIf(!hasPython)("runAirAppLocal — process group teardown", () => {
  it("leaves nothing listening once the run is aborted", async () => {
    const { runAirAppLocal } = await import("./local-runtime");

    expect(await isPortOpen(PORT), `port ${PORT} was already in use`).toBe(false);

    const controller = new AbortController();
    const events: AirAppRuntimeEvent[] = [];

    // Checked INSIDE the loop: leaving it ends the run, so "is it serving?"
    // asked afterwards would be racing the very teardown under test.
    let wasServing = false;

    for await (const event of runAirAppLocal(
      {
        nodeId: "pgroup-node",
        files: { "airapp.json": MANIFEST, "server.py": SERVER_PY },
        engine: "local",
        owner: "test-owner",
      },
      controller.signal,
    )) {
      events.push(event);
      if (event.type === "error") break;
      if (event.type === "ready") {
        wasServing = await isPortOpen(PORT);
        break;
      }
    }

    expect(events.find((event) => event.type === "error")).toBeUndefined();
    // The grandchild really was serving — otherwise the teardown assertion
    // below would pass for the wrong reason.
    expect(wasServing, "the fixture app never started serving").toBe(true);

    controller.abort();

    expect(
      await waitForPortClosed(PORT, 10_000),
      "the app process outlived its run — the direct child was killed but its grandchild was not",
    ).toBe(true);
  }, 120_000);
});
