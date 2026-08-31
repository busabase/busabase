import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIRAPP_RUNTIME_ENV_VAR,
  airAppRuntimeEnv,
} from "../src/domains/airapp/utils/airapp-runtime-env";

/**
 * `BUSABASE_AIRAPP_RUNTIME` is the only signal a running AirApp may use to
 * decide whether Busabase is hosting it. Every URL-shaped alternative is wrong
 * in both directions — a hosted AirApp is served from `localhost` on
 * Desktop/OSS, and a standalone `npm run dev` is reached over LAN IPs and
 * signed dev tunnels — and the "not localhost ⇒ hosted" direction makes the app
 * skip its own connection gate and call `/api/v1` with no credential.
 *
 * The contract only holds if the host really injects the variable, so this
 * asserts it reaches the spawned process rather than just existing as a
 * constant. The in-browser engine passes the same fragment through
 * `Nodepod.boot`/`spawn`, which is covered by live verification instead: it
 * needs a real Service Worker and Web Worker runtime.
 */

describe("airAppRuntimeEnv", () => {
  it("names the variable Busabase's engines and the generated server.js agree on", () => {
    expect(AIRAPP_RUNTIME_ENV_VAR).toBe("BUSABASE_AIRAPP_RUNTIME");
  });

  it("produces a spreadable single-key fragment per hosted runtime", () => {
    expect(airAppRuntimeEnv("browser")).toEqual({ BUSABASE_AIRAPP_RUNTIME: "browser" });
    expect(airAppRuntimeEnv("local")).toEqual({ BUSABASE_AIRAPP_RUNTIME: "local" });
    expect(airAppRuntimeEnv("remote")).toEqual({ BUSABASE_AIRAPP_RUNTIME: "remote" });
    expect(airAppRuntimeEnv("embed")).toEqual({ BUSABASE_AIRAPP_RUNTIME: "embed" });
  });
});

describe("runAirAppLocal — runtime env injection", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../src/logic/node-acl");
  });

  const collectSpawns = async () => {
    vi.resetModules();

    const spawn = vi.fn(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter;
        stderr: EventEmitter;
      };
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(() => child.emit("exit", 0), 0);
      return child;
    });
    vi.doMock("node:child_process", () => ({ spawn }));
    vi.doMock("../src/logic/node-acl", () => ({
      assertNodePermission: vi.fn(async () => undefined),
    }));
    const { runAirAppLocal } = await import("../src/domains/airapp/logic/local-runtime");
    for await (const _event of runAirAppLocal({ nodeId: "env-node", files: {}, engine: "local" })) {
      // drain
    }
    return spawn.mock.calls.map(
      (call) => (call[2] as { env?: Record<string, string> } | undefined)?.env ?? {},
    );
  };

  it("tells a bare local app what it is, alongside the injected PORT", async () => {
    const envs = await collectSpawns();
    expect(envs.length).toBeGreaterThan(0);
    for (const env of envs) {
      expect(env.BUSABASE_AIRAPP_RUNTIME).toBe("local");
      // The app is reverse-proxied onto a sub-path of busabase's origin; PORT is
      // how the proxy finds it, and both must survive together.
      expect(Number.parseInt(env.PORT ?? "", 10)).toBeGreaterThan(0);
    }
  });
});
