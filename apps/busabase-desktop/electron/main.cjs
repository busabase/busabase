"use strict";

// Busabase Desktop — Electron shell for UOS / Xinchuang Linux (GLIBC 2.28).
//
// Scope: this shell is ONLY packaged as the UOS .deb. macOS, Windows and modern
// Linux keep the Tauri shell in src-tauri/. Both shells launch the same bundled
// sidecar (`node server.js` staged by scripts/prepare-tauri-build.mjs) on the
// same port with the same ~/.busabase/data directory.
//
// Unlike the Tauri shell (which frames the sidecar in an iframe inside a custom
// titlebar), this window loads the sidecar directly with the native window
// frame, so popups (Cloud Connect OAuth) work like in a normal browser.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } = require("electron");

const { buildAutostartEntry, getAutostartPath } = require("./lib/autostart.cjs");
const {
  APP_ID,
  PRODUCT_NAME,
  SIDECAR_PORT,
  UPDATE_MANIFEST_URL,
  UPDATE_PLATFORM_ID,
} = require("./lib/constants.cjs");
const { getDashboardUrl, resolveDataDir } = require("./lib/sidecar-config.cjs");
const { SidecarManager } = require("./lib/sidecar-manager.cjs");
const { isNewerVersion, pickPlatformRelease } = require("./lib/update-check.cjs");
const {
  classifyNavigation,
  classifyWindowOpen,
  isSidecarUrl,
  toExternalHttpUrl,
} = require("./lib/url-policy.cjs");

const DEEP_LINK_SCHEME = "busabase";
const INITIAL_UPDATE_CHECK_DELAY_MS = 15_000;
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 15_000;
const ALLOWED_PERMISSIONS = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "notifications",
]);

const buildInfo = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
  } catch {
    return { version: app.getVersion(), buildTime: "" };
  }
})();

const sidecar = new SidecarManager({
  sidecarRoot: path.join(process.resourcesPath, "busabase-server"),
  dataDir: resolveDataDir(process.env, os.homedir()),
  port: SIDECAR_PORT,
});

/** @type {BrowserWindow | null} */
let mainWindow = null;
let bootInFlight = false;
let quitting = false;
let dismissedUpdateVersion = null;

const bootPagePath = path.join(__dirname, "boot.html");

const showBootPage = (state, message = "") => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  void mainWindow.loadFile(bootPagePath, { query: { state, message } });
};

const focusMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
};

const bootSidecar = async () => {
  if (bootInFlight) return;
  bootInFlight = true;
  showBootPage("starting");
  try {
    await sidecar.start();
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(getDashboardUrl(SIDECAR_PORT));
    }
  } catch (error) {
    console.error("[busabase-desktop] Sidecar start failed", error);
    showBootPage("failed", error instanceof Error ? error.message : String(error));
  } finally {
    bootInFlight = false;
  }
};

const openExternal = (rawUrl) => {
  const url = toExternalHttpUrl(rawUrl);
  if (!url) {
    console.warn("[busabase-desktop] Refusing to open non-http URL externally", rawUrl);
    return;
  }
  void shell.openExternal(url);
};

/** Apply the navigation / popup policy to a window and every popup it spawns. */
const guardWebContents = (contents, { allowExternalNavigation }) => {
  contents.on("will-navigate", (event, url) => {
    const decision = classifyNavigation(url, SIDECAR_PORT);
    if (decision === "internal") return;
    if (decision === "external" && allowExternalNavigation) return;
    event.preventDefault();
    if (decision === "external") openExternal(url);
  });

  contents.setWindowOpenHandler(({ url }) => {
    const decision = classifyWindowOpen(url, SIDECAR_PORT);
    if (decision === "popup") {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    if (decision === "external") openExternal(url);
    return { action: "deny" };
  });

  // OAuth popups start at about:blank and are navigated to the Cloud authorize
  // page, so they must be allowed to leave the sidecar origin. They still get
  // the same popup policy and no preload.
  contents.on("did-create-window", (child) => {
    guardWebContents(child.webContents, { allowExternalNavigation: true });
  });
};

const createMainWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 620,
    title: PRODUCT_NAME,
    icon: path.join(__dirname, "icon.png"),
    show: !process.argv.includes("--autostart"),
    backgroundColor: "#f9f8f4",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  guardWebContents(mainWindow.webContents, { allowExternalNavigation: false });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

const installPermissionPolicy = () => {
  const isAllowed = (permission, requestingUrl) => {
    try {
      return (
        ALLOWED_PERMISSIONS.has(permission) && isSidecarUrl(new URL(requestingUrl), SIDECAR_PORT)
      );
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(isAllowed(permission, details.requestingUrl || contents.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    isAllowed(permission, requestingOrigin),
  );
};

// ── Updates ──────────────────────────────────────────────────────────────────
// The UOS .deb is installed as root through the system package manager, so the
// shell never replaces itself: it reports a newer build and opens its download.

const fetchLatestRelease = async () => {
  // Test/POC override: lets a sandbox point the check at a local manifest
  // without a real release. The only thing a forged manifest can do is make the
  // dialog offer a different download URL — the shell never installs anything.
  const manifestUrl = process.env.BUSABASE_UPDATE_MANIFEST_URL?.trim() || UPDATE_MANIFEST_URL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await net.fetch(manifestUrl, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Update manifest returned HTTP ${response.status}`);
    return pickPlatformRelease(await response.json(), UPDATE_PLATFORM_ID);
  } finally {
    clearTimeout(timer);
  }
};

const checkForUpdates = async ({ manual }) => {
  let release;
  try {
    release = await fetchLatestRelease();
  } catch (error) {
    console.error("[busabase-desktop] Update check failed", error);
    if (manual) {
      void dialog.showMessageBox({
        type: "error",
        title: PRODUCT_NAME,
        message: "Update check failed.",
        detail: "Check your network connection and try again.",
      });
    }
    return;
  }

  const hasUpdate =
    release && isNewerVersion(buildInfo.version, release.version, buildInfo.buildTime);
  if (!hasUpdate) {
    if (manual) {
      void dialog.showMessageBox({
        type: "info",
        title: PRODUCT_NAME,
        message: "Busabase Desktop is up to date.",
        detail: `Version ${buildInfo.version}`,
      });
    }
    return;
  }
  if (!manual && dismissedUpdateVersion === release.version) return;

  const { response } = await dialog.showMessageBox({
    type: "info",
    title: PRODUCT_NAME,
    message: `Busabase Desktop ${release.version} is available.`,
    detail:
      "Download the new package, then install it by double-clicking it or with:\n" +
      "sudo apt install ./<downloaded-file>.deb",
    buttons: ["Download", "Later"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    openExternal(release.url);
  } else {
    dismissedUpdateVersion = release.version;
  }
};

// ── Launch at login (XDG autostart) ─────────────────────────────────────────

const autostartPath = getAutostartPath(process.env, os.homedir(), APP_ID);

const isAutostartEnabled = () => fs.existsSync(autostartPath);

const setAutostartEnabled = (enabled) => {
  try {
    if (enabled) {
      fs.mkdirSync(path.dirname(autostartPath), { recursive: true });
      fs.writeFileSync(
        autostartPath,
        buildAutostartEntry({ execPath: process.execPath, productName: PRODUCT_NAME }),
      );
    } else {
      fs.rmSync(autostartPath, { force: true });
    }
  } catch (error) {
    console.error("[busabase-desktop] Could not update autostart entry", error);
    void dialog.showMessageBox({
      type: "error",
      title: PRODUCT_NAME,
      message: "Could not change the launch-at-login setting.",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  buildMenu();
};

// ── Menu ─────────────────────────────────────────────────────────────────────

const buildMenu = () => {
  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "Launch at Login",
          type: "checkbox",
          checked: isAutostartEnabled(),
          click: (item) => setAutostartEnabled(item.checked),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      label: "Help",
      submenu: [
        { label: "Check for Updates...", click: () => void checkForUpdates({ manual: true }) },
        {
          label: "Open Log Folder",
          click: () => void shell.openPath(sidecar.dataDir),
        },
        { type: "separator" },
        {
          label: `About ${PRODUCT_NAME}`,
          click: () =>
            void dialog.showMessageBox({
              type: "info",
              title: PRODUCT_NAME,
              message: PRODUCT_NAME,
              detail: [
                `Version ${buildInfo.version}`,
                "Edition: UOS / Xinchuang Linux",
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
                `Data: ${sidecar.dataDir}`,
              ].join("\n"),
            }),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// ── Lifecycle ────────────────────────────────────────────────────────────────

const hasDeepLink = (argv) => argv.some((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    // A second launch (menu entry, autostart, or a busabase:// deep link from
    // the OS browser) just raises the running window.
    if (hasDeepLink(argv)) console.info("[busabase-desktop] Received deep link");
    focusMainWindow();
  });

  ipcMain.on("busabase-boot:retry", (event) => {
    // Only the local boot page may ask for a retry.
    if (!event.senderFrame?.url.startsWith("file://")) return;
    void bootSidecar();
  });

  app.whenReady().then(() => {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
    installPermissionPolicy();
    buildMenu();
    createMainWindow();
    void bootSidecar();

    setTimeout(() => void checkForUpdates({ manual: false }), INITIAL_UPDATE_CHECK_DELAY_MS);
    setInterval(() => void checkForUpdates({ manual: false }), UPDATE_CHECK_INTERVAL_MS);
  });

  app.on("window-all-closed", () => {
    // During shutdown the window is destroyed on purpose; `quitting` guards
    // against that turning into a second, uncoordinated app.quit().
    if (!quitting) app.quit();
  });

  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    // Destroy the window before stopping the sidecar: Next.js only finishes its
    // SIGTERM shutdown once the renderer's keep-alive sockets close, which turns
    // a ~1s stop into ~11s when the dashboard is still open.
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
    void sidecar.stop().finally(() => app.exit(0));
  });

  process.on("exit", () => sidecar.killNow());
}
