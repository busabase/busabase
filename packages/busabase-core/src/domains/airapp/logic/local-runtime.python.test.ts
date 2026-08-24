/**
 * End-to-end proof that a non-Node AirApp actually runs.
 *
 * Deliberately exercises the real generator with a real OS process rather than
 * asserting on the plan in isolation: every interesting failure in this feature
 * lives in the seams — a quoted argument shredded by argv splitting, a `$PORT`
 * that never reached the command line, a server that starts but is never
 * noticed because its banner doesn't look like Node's. None of those are
 * visible to a unit test of `resolveRunPlan`.
 *
 * Uses the shipped `demo-python-explicit` seed as its fixture, so the demo the
 * gallery offers is the same code this asserts on. That demo depends on nothing
 * outside the Python standard library, so this test needs no network.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AirAppRuntimeEvent } from "busabase-contract/domains/airapp/contract";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AIRAPP_DEMO_PYTHON_EXPLICIT, AIRAPP_DEMO_PYTHON_INFERRED } from "../demo-content-runtimes";

vi.mock("../../../logic/node-acl", () => ({
  assertNodePermission: vi.fn(async () => undefined),
}));

const hasPython = spawnSync("python3", ["--version"]).status === 0;

let workdirRoot: string;
let previousWorkdir: string | undefined;

beforeAll(async () => {
  workdirRoot = await fs.mkdtemp(path.join(os.tmpdir(), "airapp-python-"));
  previousWorkdir = process.env.SANDAGENT_WORKDIR;
  process.env.SANDAGENT_WORKDIR = workdirRoot;
});

afterAll(async () => {
  if (previousWorkdir === undefined) delete process.env.SANDAGENT_WORKDIR;
  else process.env.SANDAGENT_WORKDIR = previousWorkdir;
  await fs.rm(workdirRoot, { recursive: true, force: true }).catch(() => undefined);
});

describe.skipIf(!hasPython)("runAirAppLocal — Python AirApp", () => {
  it("installs, starts and serves the demo-python-explicit seed", async () => {
    const { runAirAppLocal } = await import("./local-runtime");

    const files: Record<string, string> = {};
    for (const file of AIRAPP_DEMO_PYTHON_EXPLICIT.files) files[file.path] = file.content;

    const controller = new AbortController();
    const events: AirAppRuntimeEvent[] = [];
    let ready: string | null = null;

    try {
      // Everything that needs the app *running* happens inside the loop.
      // Leaving it tears the run down — that is the whole point of the process
      // group reap — so an assertion placed after the loop would be testing a
      // corpse, and used to pass only because the process leaked.
      let served: { status: number; body: string } | null = null;

      for await (const event of runAirAppLocal(
        { nodeId: "python-node", files, engine: "local", owner: "test-owner" },
        controller.signal,
      )) {
        events.push(event);
        if (event.type === "ready") {
          ready = event.previewUrl;
          const response = await fetch("http://127.0.0.1:8137/");
          served = { status: response.status, body: await response.text() };
          break;
        }
        if (event.type === "error") break;
      }

      const log = events
        .filter((event): event is { type: "log"; line: string } => event.type === "log")
        .map((event) => event.line)
        .join("");

      // No error path was taken.
      expect(events.find((event) => event.type === "error")).toBeUndefined();

      // The manifest was honoured, and said so.
      expect(log).toContain('runtime "python" declared in airapp.json');

      // The quoted argument survived argv construction — under the previous
      // `command.split(" ")` this printed nothing and the install failed.
      expect(log).toContain("no third-party dependencies to install");

      // `$PORT` was substituted into the command line, not just the environment.
      expect(log).toContain("python3 server.py --port 8137");
      expect(log).not.toContain("$PORT");

      // Install completed and the preview became available on the declared port.
      expect(events.some((event) => event.type === "installed")).toBe(true);
      expect(ready).toBe("/api/airapp-preview/python-node/");

      // And the thing actually serves — the assertion the log lines cannot make.
      expect(served?.status).toBe(200);
      expect(served?.body).toContain("Explicit is also supported");
    } finally {
      controller.abort();
    }
  }, 90_000);
});

/**
 * The dependency-installing half, behind a flag because it needs PyPI.
 *
 * Worth having despite that: this is the only test that exercises the
 * virtualenv, and the virtualenv exists because a plain `pip install` is
 * *refused* on any PEP 668 host — Debian, Ubuntu, Fedora and Homebrew Python
 * all are. That failure is invisible to every test that stops at the RunPlan.
 *
 * Run with: AIRAPP_E2E_NETWORK=1 vitest run …
 */
describe.skipIf(!hasPython || !process.env.AIRAPP_E2E_NETWORK)(
  "runAirAppLocal — Python AirApp with dependencies",
  () => {
    it("installs into a per-run virtualenv and serves the inferred demo", async () => {
      const { runAirAppLocal } = await import("./local-runtime");

      const files: Record<string, string> = {};
      for (const file of AIRAPP_DEMO_PYTHON_INFERRED.files) files[file.path] = file.content;

      const controller = new AbortController();
      const events: AirAppRuntimeEvent[] = [];
      let served: { status: number; body: string } | null = null;

      try {
        for await (const event of runAirAppLocal(
          { nodeId: "python-venv-node", files, engine: "local", owner: "test-owner" },
          controller.signal,
        )) {
          events.push(event);
          if (event.type === "error") break;
          if (event.type === "ready") {
            // uvicorn announced its own port; no port was declared, so the
            // banner is the only place it exists.
            const log = events
              .filter((entry): entry is { type: "log"; line: string } => entry.type === "log")
              .map((entry) => entry.line)
              .join("");
            const match = /Uvicorn running on https?:\/\/[^\s:]+:(\d+)/i.exec(log);
            expect(match, "expected uvicorn to announce its port").not.toBeNull();
            const response = await fetch(`http://127.0.0.1:${Number(match?.[1])}/`);
            served = { status: response.status, body: await response.text() };
            break;
          }
        }

        const log = events
          .filter((event): event is { type: "log"; line: string } => event.type === "log")
          .map((event) => event.line)
          .join("");

        expect(events.find((event) => event.type === "error")).toBeUndefined();
        // Inference, not a manifest — this demo deliberately ships none.
        expect(log).toContain('inferred "python" from requirements.txt');
        // The venv is what makes this work on a PEP 668 host at all.
        expect(log).not.toContain("externally-managed-environment");
        expect(events.some((event) => event.type === "installed")).toBe(true);
        expect(served?.status).toBe(200);
        expect(served?.body).toContain("Running on Python");
      } finally {
        controller.abort();
      }
    }, 300_000);
  },
);
