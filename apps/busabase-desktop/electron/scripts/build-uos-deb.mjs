#!/usr/bin/env node

// Builds the Busabase Desktop .deb for UOS 20 / Xinchuang Linux (GLIBC 2.28).
//
// This package uses Electron (bundled Chromium) instead of Tauri, because
// Tauri 2 needs WebKitGTK 4.1 and a GLIBC far newer than UOS 20 ships. Every
// other platform keeps the Tauri build; this script never touches src-tauri/
// except to reuse the sidecar that scripts/prepare-tauri-build.mjs stages.
//
// Layout follows the UnionTech (UOS) application packaging convention used by
// ToDesk and other store apps:
//
//   /opt/apps/com.busabase.app/
//     info                                   UOS app metadata (JSON)
//     entries/applications/com.busabase.app.desktop
//     entries/icons/hicolor/<size>/apps/com.busabase.app.png
//     files/                                 Electron runtime + app + sidecar
//
// Usage:
//   node electron/scripts/build-uos-deb.mjs [--skip-prepare] [--out <dir>]
//
// Env:
//   APP_VERSION                  Package version (default: package.json version)
//   BUSABASE_DESKTOP_BUILD_TIME  12-digit yyyyMMddHHmm build time
//   ELECTRON_MIRROR              Base URL for Electron zips (default: GitHub releases)
//   ELECTRON_ZIP                 Path to an already-downloaded Electron zip

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, constants as fsConstants } from "node:fs";
import {
  access,
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { findAbiViolations, UOS20_ABI_LIMITS } from "./elf-abi.mjs";

const execFileAsync = promisify(execFile);

const scriptDir = dirname(fileURLToPath(import.meta.url));
const electronDir = join(scriptDir, "..");
const desktopDir = join(electronDir, "..");
const repoDir = join(desktopDir, "..", "..");
const sidecarStageDir = join(desktopDir, "src-tauri", "r");
const iconsDir = join(desktopDir, "src-tauri", "icons");

// Electron 44 is built against GLIBC <= 2.25 and runs on Debian 10 / UOS 20
// (verified in a debian:10 container). Pin the exact zip by SHA-256 so a
// compromised mirror cannot swap the runtime.
const ELECTRON_VERSION = "44.4.5";
const ELECTRON_ZIP_NAME = `electron-v${ELECTRON_VERSION}-linux-x64.zip`;
const ELECTRON_ZIP_SHA256 = "04586a0ec46c3283fbdaef85530f561f71f0b5e136ad0cb9ef63683615609780";

const APP_ID = "com.busabase.app";
const PRODUCT_NAME = "Busabase Desktop";
const DEB_PACKAGE_NAME = APP_ID;
const EXECUTABLE_NAME = "busabase-desktop";
const INSTALL_ROOT = `/opt/apps/${APP_ID}`;

// Shared libraries the Electron binary links against, as named on Debian 10 /
// UOS 20. Unversioned on purpose: UOS repackages several of these with its own
// version strings, and the ELF ABI gate below is what actually enforces the
// GLIBC/GLIBCXX floor.
const DEB_DEPENDS = [
  "libgtk-3-0",
  "libnss3",
  "libnspr4",
  "libasound2",
  "libgbm1",
  "libxkbcommon0",
  "libatspi2.0-0",
  "libatk-bridge2.0-0",
  "libatk1.0-0",
  "libcups2",
  "libdbus-1-3",
  "libdrm2",
  "libexpat1",
  "libudev1",
  "libx11-6",
  "libxcb1",
  "libxcomposite1",
  "libxdamage1",
  "libxext6",
  "libxfixes3",
  "libxrandr2",
  "libstdc++6",
  "xdg-utils",
];

const ICON_SIZES = [
  { size: "32x32", file: "32x32.png" },
  { size: "128x128", file: "128x128.png" },
  { size: "256x256", file: "128x128@2x.png" },
  { size: "512x512", file: "icon.png" },
];

const parseArgs = (argv) => {
  const args = { skipPrepare: false, outDir: join(electronDir, "dist") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--skip-prepare") args.skipPrepare = true;
    else if (arg === "--out") args.outDir = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
};

const exists = async (path) => {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const run = async (command, args, options = {}) => {
  const { stdout } = await execFileAsync(command, args, {
    maxBuffer: 1024 * 1024 * 64,
    ...options,
  });
  return stdout;
};

const sha256File = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};

const resolveVersion = async () => {
  const packageJson = JSON.parse(await readFile(join(desktopDir, "package.json"), "utf8"));
  const version = process.env.APP_VERSION?.trim() || packageJson.version;
  if (!/^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$/.test(version)) {
    throw new Error(`Invalid package version: ${version}`);
  }
  const buildTime = process.env.BUSABASE_DESKTOP_BUILD_TIME?.trim() || version.split("+")[1] || "";
  if (buildTime && !/^\d{12}$/.test(buildTime)) {
    throw new Error("BUSABASE_DESKTOP_BUILD_TIME must use the 12-digit yyyyMMddHHmm format.");
  }
  return { version, buildTime };
};

const obtainElectronZip = async () => {
  const override = process.env.ELECTRON_ZIP?.trim();
  const cacheDir = join(tmpdir(), "busabase-desktop-electron-cache");
  const zipPath = override || join(cacheDir, ELECTRON_ZIP_NAME);

  if (!override && !(await exists(zipPath))) {
    await mkdir(cacheDir, { recursive: true });
    const mirror = (
      process.env.ELECTRON_MIRROR?.trim() ||
      "https://github.com/electron/electron/releases/download/"
    ).replace(/\/?$/, "/");
    const url = `${mirror}v${ELECTRON_VERSION}/${ELECTRON_ZIP_NAME}`;
    console.log(`Downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download Electron: ${url} (${response.status})`);
    }
    const partial = `${zipPath}.partial`;
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    await rename(partial, zipPath);
  }

  const digest = await sha256File(zipPath);
  if (digest !== ELECTRON_ZIP_SHA256) {
    if (!override) await rm(zipPath, { force: true });
    throw new Error(
      `Electron zip checksum mismatch for ${zipPath}: expected ${ELECTRON_ZIP_SHA256}, got ${digest}`,
    );
  }
  return zipPath;
};

const prepareSidecar = async (skipPrepare) => {
  if (!skipPrepare) {
    await run(process.execPath, [join(desktopDir, "scripts", "prepare-tauri-build.mjs")], {
      cwd: repoDir,
      env: process.env,
    });
  }
  if (!(await exists(join(sidecarStageDir, "entry.json")))) {
    throw new Error(
      `Staged sidecar not found at ${relative(repoDir, sidecarStageDir)}. Run without --skip-prepare.`,
    );
  }
};

const desktopEntry = () =>
  [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${PRODUCT_NAME}`,
    "Name[zh_CN]=Busabase 桌面版",
    "Comment=Private local-first Busabase knowledge base",
    "Comment[zh_CN]=本地优先的 Busabase 私有知识库",
    `Exec=${INSTALL_ROOT}/files/${EXECUTABLE_NAME} %U`,
    `Icon=${APP_ID}`,
    "Terminal=false",
    "Categories=Office;Utility;",
    "MimeType=x-scheme-handler/busabase;",
    `StartupWMClass=${PRODUCT_NAME}`,
    "",
  ].join("\n");

const uosInfo = (version) =>
  `${JSON.stringify(
    {
      appid: APP_ID,
      name: PRODUCT_NAME,
      version,
      arch: ["amd64"],
      permissions: {
        autostart: true,
        notification: true,
        trayicon: false,
        clipboard: true,
        account: false,
        bluetooth: false,
        camera: false,
        audio_record: false,
        installed_apps: false,
      },
    },
    null,
    2,
  )}\n`;

const debControl = ({ version, installedSizeKb }) =>
  [
    `Package: ${DEB_PACKAGE_NAME}`,
    `Version: ${version}`,
    "Section: utils",
    "Priority: optional",
    "Architecture: amd64",
    `Installed-Size: ${installedSizeKb}`,
    `Depends: ${DEB_DEPENDS.join(", ")}`,
    // The Tauri .deb installs as `busabase-desktop`; both register the same
    // busabase:// handler and data dir, so never let them coexist.
    "Conflicts: busabase-desktop",
    "Replaces: busabase-desktop",
    "Maintainer: Busabase Team <support@busabase.com>",
    "Homepage: https://busabase.com",
    "Description: Busabase Desktop for UOS / Xinchuang Linux",
    " Private local-first Busabase knowledge base. This edition bundles its own",
    " Chromium runtime and supports GLIBC 2.28 systems such as UOS 20 and Kylin.",
    "",
  ].join("\n");

// UOS indexes /opt/apps/*/entries on store installs; for a plain `apt install`
// link the entries into the standard XDG locations too. Only our own symlinks
// are ever removed.
const postinst = () => `#!/bin/sh
set -e
APP_ROOT="${INSTALL_ROOT}"
link_entry() {
  target="$1"; link="$2"
  mkdir -p "$(dirname "$link")"
  if [ ! -e "$link" ] || [ -L "$link" ]; then ln -sfn "$target" "$link"; fi
}
link_entry "$APP_ROOT/entries/applications/${APP_ID}.desktop" "/usr/share/applications/${APP_ID}.desktop"
for dir in "$APP_ROOT"/entries/icons/hicolor/*/apps; do
  size="$(basename "$(dirname "$dir")")"
  link_entry "$dir/${APP_ID}.png" "/usr/share/icons/hicolor/$size/apps/${APP_ID}.png"
done
# Chromium's setuid sandbox helper; Debian-based kernels often disable
# unprivileged user namespaces, so this is what keeps the renderer sandboxed.
chown root:root "$APP_ROOT/files/chrome-sandbox"
chmod 4755 "$APP_ROOT/files/chrome-sandbox"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
exit 0
`;

const postrm = () => `#!/bin/sh
set -e
APP_ROOT="${INSTALL_ROOT}"
unlink_entry() {
  link="$1"
  if [ -L "$link" ]; then
    case "$(readlink "$link")" in "$APP_ROOT"/*) rm -f "$link" ;; esac
  fi
}
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  unlink_entry "/usr/share/applications/${APP_ID}.desktop"
  for size in ${ICON_SIZES.map(({ size }) => size).join(" ")}; do
    unlink_entry "/usr/share/icons/hicolor/$size/apps/${APP_ID}.png"
  done
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
fi
exit 0
`;

const directorySizeKb = async (root) => {
  let bytes = 0;
  const queue = [root];
  while (queue.length > 0) {
    const dir = queue.pop();
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) queue.push(full);
      else if (entry.isFile()) bytes += (await stat(full)).size;
    }
  }
  return Math.ceil(bytes / 1024);
};

const main = async () => {
  if (process.platform !== "linux") throw new Error("The UOS .deb can only be built on Linux.");
  const args = parseArgs(process.argv.slice(2));
  const { version, buildTime } = await resolveVersion();

  const [zipPath] = await Promise.all([obtainElectronZip(), prepareSidecar(args.skipPrepare)]);

  const stageRoot = join(tmpdir(), `busabase-uos-deb-${process.pid}`);
  const appRoot = join(stageRoot, INSTALL_ROOT.slice(1));
  const filesDir = join(appRoot, "files");
  const resourcesDir = join(filesDir, "resources");
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(filesDir, { recursive: true });

  try {
    // Electron runtime, renamed so the process / WM class reads as Busabase.
    await run("unzip", ["-q", zipPath, "-d", filesDir]);
    await rename(join(filesDir, "electron"), join(filesDir, EXECUTABLE_NAME));
    await rm(join(resourcesDir, "default_app.asar"), { force: true });

    // Shell code.
    const shellDir = join(resourcesDir, "app");
    await mkdir(join(shellDir, "lib"), { recursive: true });
    for (const file of ["main.cjs", "preload.cjs", "boot.html"]) {
      await cp(join(electronDir, file), join(shellDir, file));
    }
    for (const file of await readdir(join(electronDir, "lib"))) {
      if (file.endsWith(".cjs") && !file.endsWith(".test.cjs")) {
        await cp(join(electronDir, "lib", file), join(shellDir, "lib", file));
      }
    }
    await cp(join(iconsDir, "icon.png"), join(shellDir, "icon.png"));
    await writeFile(
      join(shellDir, "package.json"),
      `${JSON.stringify(
        { name: "busabase-desktop", productName: PRODUCT_NAME, version, main: "main.cjs" },
        null,
        2,
      )}\n`,
    );
    await writeFile(
      join(shellDir, "build-info.json"),
      `${JSON.stringify({ version, buildTime, electron: ELECTRON_VERSION }, null, 2)}\n`,
    );

    // Sidecar (Next standalone server + Node 24) — identical to the Tauri bundle.
    await cp(sidecarStageDir, join(resourcesDir, "busabase-server"), {
      recursive: true,
      filter: (source) => !source.endsWith(".gitkeep"),
    });

    // UOS entries + metadata.
    const applicationsDir = join(appRoot, "entries", "applications");
    await mkdir(applicationsDir, { recursive: true });
    await writeFile(join(applicationsDir, `${APP_ID}.desktop`), desktopEntry());
    for (const { size, file } of ICON_SIZES) {
      const iconDir = join(appRoot, "entries", "icons", "hicolor", size, "apps");
      await mkdir(iconDir, { recursive: true });
      await cp(join(iconsDir, file), join(iconDir, `${APP_ID}.png`));
    }
    await writeFile(join(appRoot, "info"), uosInfo(version));

    // ABI gate: nothing we ship may need more than UOS 20 provides.
    const violations = await findAbiViolations(filesDir, UOS20_ABI_LIMITS);
    if (violations.length > 0) {
      const lines = violations.map(
        ({ file, symbol }) => `  ${symbol}  ${relative(filesDir, file)}`,
      );
      throw new Error(
        `ELF files require symbols newer than UOS 20 provides (GLIBC ${UOS20_ABI_LIMITS.GLIBC}, GLIBCXX ${UOS20_ABI_LIMITS.GLIBCXX}):\n${lines.join("\n")}`,
      );
    }

    // Debian control files.
    const debianDir = join(stageRoot, "DEBIAN");
    await mkdir(debianDir, { recursive: true });
    await writeFile(
      join(debianDir, "control"),
      debControl({ version, installedSizeKb: await directorySizeKb(appRoot) }),
    );
    await writeFile(join(debianDir, "postinst"), postinst());
    await writeFile(join(debianDir, "postrm"), postrm());
    // Files land root-owned under /opt; never ship group/world-writable modes
    // inherited from the build host's umask.
    await run("chmod", ["-R", "u+rwX,go+rX,go-w", stageRoot]);
    await chmod(join(debianDir, "postinst"), 0o755);
    await chmod(join(debianDir, "postrm"), 0o755);
    await chmod(join(filesDir, "chrome-sandbox"), 0o4755);

    await mkdir(args.outDir, { recursive: true });
    const debPath = join(args.outDir, `${PRODUCT_NAME}_${version}_uos_amd64.deb`);
    // xz, not zstd: dpkg on UOS 20 / Debian 10 cannot read zstd members, and
    // Ubuntu's dpkg-deb defaults to zstd.
    await run("dpkg-deb", ["--root-owner-group", "-Zxz", "--build", stageRoot, debPath]);

    const { size } = await stat(debPath);
    console.log(
      `Built ${relative(repoDir, debPath)} (${Math.round(size / 1024 / 1024)} MB)\n` +
        `  version:  ${version}\n` +
        `  electron: ${ELECTRON_VERSION}\n` +
        `  abi:      <= GLIBC_${UOS20_ABI_LIMITS.GLIBC}, <= GLIBCXX_${UOS20_ABI_LIMITS.GLIBCXX}`,
    );
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
