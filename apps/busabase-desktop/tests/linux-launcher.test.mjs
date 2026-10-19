import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { pnpmInvocation } from "../scripts/pnpm-launcher.mjs";
import { isWslDevelopment, launchTauri, tauriEnvironment } from "../scripts/tauri.mjs";
import { softwareRenderingEnvironment } from "../scripts/tauri-dev-software.mjs";

test("software rendering is opt-in and leaves the parent environment unchanged", () => {
  const original = {
    PATH: "/usr/bin",
    BUSABASE_DATA_DIR: "/tmp/local-test",
    GALLIUM_DRIVER: "zink",
  };
  const environment = softwareRenderingEnvironment(original, "linux");
  assert.equal(environment.PATH, original.PATH);
  assert.equal(environment.BUSABASE_DATA_DIR, original.BUSABASE_DATA_DIR);
  assert.equal(environment.LIBGL_ALWAYS_SOFTWARE, "true");
  assert.equal(environment.GALLIUM_DRIVER, "llvmpipe");
  assert.equal(environment.WEBKIT_DISABLE_COMPOSITING_MODE, "1");
  assert.equal(original.GALLIUM_DRIVER, "zink");
  assert.equal(original.LIBGL_ALWAYS_SOFTWARE, undefined);
});

test("other platforms keep their normal startup path", () => {
  for (const platform of ["win32", "darwin"]) {
    assert.throws(() => softwareRenderingEnvironment({}, platform), /Linux-only/);
  }
});

test("WSL dev gets an isolated default port and software rendering without mutating its parent", () => {
  const env = { PATH: "/usr/bin", BUSABASE_DATA_DIR: "/tmp/preserved", GALLIUM_DRIVER: "zink" };
  const configured = tauriEnvironment(["dev"], env, "linux", "6.6.87-microsoft-standard-WSL2");
  assert.equal(configured.BUSABASE_DESKTOP_SIDECAR_PORT, "15420");
  assert.equal(configured.GALLIUM_DRIVER, "llvmpipe");
  assert.equal(configured.LIBGL_ALWAYS_SOFTWARE, "true");
  assert.equal(configured.WEBKIT_DISABLE_COMPOSITING_MODE, "1");
  assert.equal(configured.BUSABASE_DATA_DIR, env.BUSABASE_DATA_DIR);
  assert.equal(env.GALLIUM_DRIVER, "zink");
  assert.equal(env.BUSABASE_DESKTOP_SIDECAR_PORT, undefined);
});

test("WSL markers also detect development while explicit port and hardware preferences win", () => {
  for (const marker of ["WSL_DISTRO_NAME", "WSL_INTEROP"]) {
    const env = {
      [marker]: "present",
      BUSABASE_DESKTOP_SIDECAR_PORT: "15601",
      BUSABASE_DESKTOP_RENDERER: "hardware",
    };
    assert.equal(isWslDevelopment(["dev"], env, "linux", "linux"), true);
    assert.deepEqual(tauriEnvironment(["dev"], env, "linux", "linux"), env);
  }
});

test("normal platforms and non-dev commands keep the original environment", () => {
  const env = { PATH: "/usr/bin", WSL_DISTRO_NAME: "Ubuntu", GALLIUM_DRIVER: "zink" };
  for (const platform of ["win32", "darwin"]) {
    assert.deepEqual(tauriEnvironment(["dev"], env, platform, "microsoft"), env);
  }
  for (const args of [["build"], ["info"], [], ["--help"]]) {
    assert.deepEqual(tauriEnvironment(args, env, "linux", "microsoft"), env);
  }
  assert.deepEqual(tauriEnvironment(["dev"], { PATH: "/bin" }, "linux", "6.8.0-generic"), {
    PATH: "/bin",
  });
});

test("the wrapper forwards arguments, environment, signals and exit status to the real CLI", () => {
  const child = new EventEmitter();
  const events = new EventEmitter();
  const signals = [];
  child.kill = (signal) => signals.push(signal);
  let launch;
  const messages = [];
  const args = ["dev", "--no-watch", "--", "argument with spaces"];
  launchTauri(args, {
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    platform: "linux",
    kernelRelease: "linux",
    processEvents: events,
    warn: (message) => messages.push(message),
    spawnProcess: (...invocation) => {
      launch = invocation;
      return child;
    },
  });
  assert.equal(launch[0], "pnpm");
  assert.deepEqual(launch[1], ["exec", "tauri", ...args]);
  assert.equal(launch[2].env.BUSABASE_DESKTOP_SIDECAR_PORT, "15420");
  assert.equal(launch[2].stdio, "inherit");
  assert.ok(launch[2].cwd.endsWith("/apps/busabase-desktop/"));
  assert.match(messages[0], /WSL dev: sidecar port 15420; renderer software/);
  events.emit("SIGINT");
  events.emit("SIGTERM");
  assert.deepEqual(signals, ["SIGINT", "SIGTERM"]);
  child.emit("exit", null, "SIGINT");
  assert.equal(events.exitCode, 130);
  assert.equal(events.listenerCount("SIGINT"), 0);
  assert.equal(events.listenerCount("SIGTERM"), 0);
});

test("spawn failures produce a failing exit status", () => {
  const child = new EventEmitter();
  const events = new EventEmitter();
  child.kill = () => {};
  const original = console.error;
  const errors = [];
  console.error = (message) => errors.push(message);
  try {
    launchTauri(["info"], {
      env: {},
      platform: "linux",
      kernelRelease: "generic",
      processEvents: events,
      spawnProcess: () => child,
    });
    child.emit("error", new Error("pnpm ENOENT"));
    assert.equal(events.exitCode, 1);
    assert.match(errors[0], /Could not launch Tauri: pnpm ENOENT/);
    child.emit("exit", 1, null);
    assert.equal(events.listenerCount("SIGINT"), 0);
  } finally {
    console.error = original;
  }
});

test("Windows launches the pnpm JavaScript CLI through Node without invoking a shell", () => {
  const child = new EventEmitter();
  child.kill = () => {};
  const events = new EventEmitter();
  const env = { npm_execpath: "C:\\Program Files\\pnpm\\bin\\pnpm.cjs", PATH: "preserved" };
  let invocation;
  const args = ["dev", "--", "argument with spaces", "argument&without-shell"];
  launchTauri(args, {
    env,
    platform: "win32",
    kernelRelease: "microsoft",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
    processEvents: events,
    spawnProcess: (...parameters) => {
      invocation = parameters;
      return child;
    },
  });
  assert.equal(invocation[0], "C:\\Program Files\\nodejs\\node.exe");
  assert.deepEqual(invocation[1], [env.npm_execpath, "exec", "tauri", ...args]);
  assert.deepEqual(invocation[2].env, env);
  assert.equal(invocation[2].shell, undefined);
  child.emit("exit", 0, null);
  assert.equal(events.exitCode, 0);
  assert.throws(() => pnpmInvocation(["exec", "tauri"], {}, "win32"), /Run this launcher through/);
  assert.throws(
    () => pnpmInvocation([], { npm_execpath: "C:\\pnpm.cmd" }, "win32"),
    /not a command-shell shim/,
  );
});
