"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const { describe, it } = require("node:test");
const { once } = require("node:events");

const { buildAutostartEntry, getAutostartPath, quoteExecArg } = require("../lib/autostart.cjs");
const {
  buildSidecarEnv,
  getDashboardUrl,
  resolveBundledSidecar,
  resolveDataDir,
  tailChars,
} = require("../lib/sidecar-config.cjs");
const { isBusabaseHealthy, isPortOpen, waitForPortRelease } = require("../lib/sidecar-manager.cjs");
const { isNewerVersion, pickPlatformRelease } = require("../lib/update-check.cjs");
const {
  classifyNavigation,
  classifyWindowOpen,
  toExternalHttpUrl,
} = require("../lib/url-policy.cjs");

const PORT = 15419;

describe("url policy", () => {
  it("keeps the sidecar and the local boot page inside the window", () => {
    assert.equal(classifyNavigation("http://localhost:15419/dashboard", PORT), "internal");
    assert.equal(classifyNavigation("http://127.0.0.1:15419/api/health", PORT), "internal");
    assert.equal(classifyNavigation("file:///opt/apps/boot.html?state=failed", PORT), "internal");
  });

  it("sends other web origins to the OS browser and refuses other schemes", () => {
    assert.equal(classifyNavigation("https://busabase.com/pricing", PORT), "external");
    // Same host, different port is a different origin.
    assert.equal(classifyNavigation("http://localhost:3000/", PORT), "external");
    assert.equal(classifyNavigation("javascript:alert(1)", PORT), "deny");
    assert.equal(classifyNavigation("not a url", PORT), "deny");
  });

  it("allows real popups for about:blank and same-origin (Cloud Connect OAuth)", () => {
    assert.equal(classifyWindowOpen("", PORT), "popup");
    assert.equal(classifyWindowOpen("about:blank", PORT), "popup");
    assert.equal(classifyWindowOpen("http://localhost:15419/api/buda/oauth/start", PORT), "popup");
  });

  it("opens foreign window.open targets externally and denies non-http", () => {
    assert.equal(classifyWindowOpen("https://share.busabase.com/p/abc", PORT), "external");
    assert.equal(classifyWindowOpen("file:///etc/passwd", PORT), "deny");
    assert.equal(classifyWindowOpen("busabase://desktop/cloud-connect", PORT), "deny");
  });

  it("only hands http(s) URLs to the OS", () => {
    assert.equal(toExternalHttpUrl("https://busabase.com/x"), "https://busabase.com/x");
    assert.equal(toExternalHttpUrl("file:///etc/passwd"), null);
    assert.equal(toExternalHttpUrl("smb://host/share"), null);
  });
});

describe("sidecar config (parity with src-tauri/src/sidecar.rs)", () => {
  it("uses ~/.busabase/data unless BUSABASE_DATA_DIR is set", () => {
    assert.equal(resolveDataDir({}, "/home/u"), "/home/u/.busabase/data");
    assert.equal(resolveDataDir({ BUSABASE_DATA_DIR: "  " }, "/home/u"), "/home/u/.busabase/data");
    assert.equal(resolveDataDir({ BUSABASE_DATA_DIR: "/srv/b" }, "/home/u"), "/srv/b");
  });

  it("builds the same env the Tauri shell passes to the sidecar", () => {
    const { env, pgDir, storageDir } = buildSidecarEnv({
      baseEnv: { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" },
      dataDir: "/home/u/.busabase/data",
      port: PORT,
    });
    assert.equal(pgDir, "/home/u/.busabase/data/pgdata");
    assert.equal(storageDir, "/home/u/.busabase/data/storage");
    assert.equal(env.PORT, "15419");
    assert.equal(env.HOSTNAME, "127.0.0.1");
    assert.equal(env.NODE_ENV, "production");
    assert.equal(env.PG_DATABASE_URL, "pglite:///home/u/.busabase/data/pgdata");
    assert.equal(
      env.STORAGE_URL,
      "local:/home/u/.busabase/data/storage?base_url=/api/storage&upload_url=/api/storage/upload",
    );
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  });

  it("resolves the staged sidecar from entry.json", () => {
    const root = "/opt/apps/com.busabase.app/files/resources/busabase-server";
    const files = new Map([
      [
        path.join(root, "entry.json"),
        JSON.stringify({ server: "apps/busabase/server.js", node: "node" }),
      ],
    ]);
    const present = new Set([path.join(root, "apps/busabase/server.js"), path.join(root, "node")]);
    const fs = {
      readFile: (file) => {
        if (!files.has(file)) throw new Error("ENOENT");
        return files.get(file);
      },
      exists: (file) => present.has(file),
    };

    assert.deepEqual(resolveBundledSidecar(root, fs), {
      executable: path.join(root, "node"),
      args: ["server.js"],
      cwd: path.join(root, "apps/busabase"),
    });

    present.delete(path.join(root, "node"));
    assert.equal(resolveBundledSidecar(root, fs), null);
    assert.equal(resolveBundledSidecar("/missing", fs), null);
  });

  it("points the window at the sidecar dashboard and tails logs on char boundaries", () => {
    assert.equal(getDashboardUrl(PORT), "http://localhost:15419/dashboard");
    assert.equal(tailChars("错误: port busy", 9), "port busy");
    assert.equal(tailChars("短", 20), "短");
  });
});

describe("update check (parity with src-tauri/src/updater.rs)", () => {
  it("compares build time when semver is equal", () => {
    const current = "0.9.14+202607231530";
    assert.equal(isNewerVersion(current, "0.9.14+202607231530"), false);
    assert.equal(isNewerVersion(current, "0.9.14+202607231531"), true);
    assert.equal(isNewerVersion(current, "0.9.14+202607231529"), false);
  });

  it("compares semver before build time", () => {
    const current = "0.9.14+202607231530";
    assert.equal(isNewerVersion(current, "0.9.15+202607220000"), true);
    assert.equal(isNewerVersion(current, "0.9.13+202607240000"), false);
    assert.equal(isNewerVersion("1.0.0-beta.1", "1.0.0"), true);
  });

  it("falls back to the embedded build time and ignores malformed versions", () => {
    assert.equal(isNewerVersion("0.9.14", "0.9.14+202607231531", "202607231530"), true);
    assert.equal(isNewerVersion("0.9.14", "0.9.14+202607231529", "202607231530"), false);
    assert.equal(isNewerVersion("0.9.14", "garbage"), false);
  });

  it("reads the UOS entry from latest.json and requires an https URL", () => {
    const manifest = {
      version: "0.80.0+202609290000",
      platforms: {
        "linux-x86_64": { primary: { url: "https://s1.busabase.com/x.deb" } },
        "linux-x86_64-uos": { primary: { url: "https://s1.busabase.com/x_uos_amd64.deb" } },
      },
    };
    assert.deepEqual(pickPlatformRelease(manifest, "linux-x86_64-uos"), {
      version: "0.80.0+202609290000",
      url: "https://s1.busabase.com/x_uos_amd64.deb",
    });
    assert.equal(
      pickPlatformRelease({ version: "1.0.0", platforms: {} }, "linux-x86_64-uos"),
      null,
    );
    assert.equal(
      pickPlatformRelease(
        { version: "1.0.0", platforms: { "linux-x86_64-uos": { url: "http://evil/x.deb" } } },
        "linux-x86_64-uos",
      ),
      null,
    );
  });
});

describe("sidecar lifecycle", () => {
  const listen = (server) =>
    new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

  it("tells a Busabase apart from any other process holding the port", async () => {
    const health = http.createServer((request, response) => {
      response.writeHead(request.url === "/api/health" ? 200 : 404);
      response.end("ok");
    });
    const port = await listen(health);
    try {
      assert.equal(await isBusabaseHealthy(port), true);
      assert.equal(await isPortOpen(port), true);
    } finally {
      health.closeAllConnections();
      health.close();
      await once(health, "close");
    }

    // A process that accepts connections but never answers is not Busabase.
    const sockets = new Set();
    const foreign = net.createServer((socket) => sockets.add(socket));
    const foreignPort = await listen(foreign);
    try {
      assert.equal(await isPortOpen(foreignPort), true);
      assert.equal(await isBusabaseHealthy(foreignPort), false);
    } finally {
      for (const socket of sockets) socket.destroy();
      foreign.close();
      await once(foreign, "close");
    }

    assert.equal(await isPortOpen(foreignPort), false);
  });

  it("waits for a shutting-down sidecar to release the port", async () => {
    let probes = 0;
    const released = await waitForPortRelease({
      port: 15419,
      timeoutMs: 5_000,
      probe: async () => {
        probes += 1;
        return probes < 3;
      },
    });
    assert.equal(released, true);
    assert.equal(probes, 3);

    const never = await waitForPortRelease({ port: 15419, timeoutMs: 0, probe: async () => true });
    assert.equal(never, false);
  });
});

describe("autostart", () => {
  it("writes an XDG autostart entry under XDG_CONFIG_HOME", () => {
    assert.equal(
      getAutostartPath({}, "/home/u", "com.busabase.app"),
      "/home/u/.config/autostart/com.busabase.app.desktop",
    );
    assert.equal(
      getAutostartPath({ XDG_CONFIG_HOME: "/cfg" }, "/home/u", "com.busabase.app"),
      "/cfg/autostart/com.busabase.app.desktop",
    );
  });

  it("quotes Exec paths that contain spaces or shell metacharacters", () => {
    assert.equal(
      quoteExecArg("/opt/apps/a/files/busabase-desktop"),
      "/opt/apps/a/files/busabase-desktop",
    );
    assert.equal(quoteExecArg("/opt/My App/run"), '"/opt/My App/run"');
    assert.equal(quoteExecArg('/opt/a"b$c'), '"/opt/a\\"b\\$c"');
    assert.match(
      buildAutostartEntry({ execPath: "/opt/x/busabase-desktop", productName: "Busabase Desktop" }),
      /^Exec=\/opt\/x\/busabase-desktop --autostart$/m,
    );
  });
});
