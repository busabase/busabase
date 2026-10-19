# Busabase Desktop

Busabase Desktop is the private local-first desktop shell for the open-source Busabase knowledge base.

The desktop app uses Tauri and manages the existing `apps/busabase` OSS server as a local sidecar. The default mode is private: Busabase binds to localhost and keeps data in the local desktop data directory.

When the desktop window opens, the Tauri shell starts the sidecar automatically and embeds its OSS dashboard. Startup checks both `/api/health` and the dashboard, following local redirects before declaring readiness. A dashboard startup failure stays on the error screen with a retry action instead of opening a broken workspace.

## Development

```bash
pnpm --filter @busabase/desktop tauri dev
```

The Tauri shell runs on port `3064`. The managed Busabase sidecar runs on port `15419`, except that `pnpm tauri dev` in WSL defaults to `15420` to avoid reusing a Windows desktop server.

The sidecar command sets `PORT` to the selected port and `PG_DATABASE_URL` to the desktop-owned PGlite directory
before running `pnpm --filter busabase dev`.

Environment overrides:

- `BUSABASE_DESKTOP_WORKSPACE_ROOT` points the sidecar launcher at a specific workspace root.
- `BUSABASE_DESKTOP_PNPM` overrides the `pnpm` executable used to launch the OSS sidecar.
- `BUSABASE_DESKTOP_SIDECAR_PORT` overrides port `15419` (integer from 1 to 65535). Close other apps using the default port, or select an unused port when running Windows and WSL instances together. Each instance must use its own data directory if they are separate workspaces.
- `BUSABASE_DATA_DIR` overrides the local data directory (default: `~/.busabase/data`). Startup failures include the location of `sidecar.log` and recent log output.
- `BUSABASE_DESKTOP_RENDERER=hardware` opts out of automatic software rendering in WSL development. Other platforms and production/build commands keep their normal rendering environment.

### Linux startup troubleshooting

Registering `busabase://` requires `xdg-utils` and `desktop-file-utils`. If these tools are missing, the shell logs an actionable warning; local workspace startup can continue, but external deep links will not work. On Debian/Ubuntu, install them separately:

```bash
sudo apt-get install xdg-utils desktop-file-utils
```

If Mesa Zink/EGL initialization fails on the machine, try the opt-in software-rendering development launcher:

```bash
pnpm --filter @busabase/desktop tauri:dev:software
```

In WSL, the ordinary development command automatically selects software rendering and port `15420`; no environment prefix is required:

```bash
pnpm --filter @busabase/desktop tauri dev
```

The development sidecar uses `.next-desktop` so a separate OSS development server does not hold its build lock. An already-running external server is never stopped automatically; its failures are reported as external-server errors rather than pointing at a nonexistent managed log.

Software mode sets `LIBGL_ALWAYS_SOFTWARE=true`, `GALLIUM_DRIVER=llvmpipe`, and `WEBKIT_DISABLE_COMPOSITING_MODE=1` for this launch only. It can reduce rendering performance. It does not fix an HTTP 500: inspect the reported sidecar log for that failure. Do not delete the local database to troubleshoot startup.

Startup regression checks:

```bash
pnpm --filter @busabase/desktop test:styles
pnpm --filter @busabase/desktop test:linux-launcher
cargo test --manifest-path apps/busabase-desktop/src-tauri/Cargo.toml
```

`test:startup` additionally requires `DESKTOP_E2E_URL`, `DESKTOP_E2E_SIDECAR_URL`, and `DESKTOP_E2E_OUTPUT_DIR` pointing at isolated desktop/OSS development servers and an artifact directory. It exercises the browser shell's failure/retry flow with a simulated native bridge and loads the real OSS workspace; it does not replace native WebKit/GPU testing.

## Local ACP agents

Codex and Claude Code use the system Node/npx when both are executable. If they are unavailable,
click **Connect** on the agent card and confirm the download: Desktop uses its bundled Node and npm
to install a pinned ACP adapter under its private app data directory. The two adapters have separate
installations and are never installed into the system Node environment. The confirmation lists the
package and npm registry source; a failed or damaged installation can be retried from the card.

Codex ACP requires a separately installed and signed-in Codex CLI (`codex login`). Claude Code ACP
includes the Claude Agent SDK native CLI, but Claude authentication remains the user's responsibility:
sign in from a terminal (`claude auth login`) and reconnect. Desktop does not manage credentials or
offer automatic installation in a regular browser, self-hosted OSS, or Cloud.

## 信创 builds (统信 UOS 20 / 麒麟 Kylin)

Xinchuang Linux systems freeze their ABI: UOS 20 and Kylin ship **GLIBC 2.28** and have no
`libwebkit2gtk-4.1`, which the Tauri shell needs. Those machines cannot be upgraded, so the Tauri
`.deb` fails there with `GLIBC_2.39 not found` (or a missing WebKitGTK dependency) before it ever
opens a window.

For those systems `electron/` builds a **second, additive shell** that renders the same sidecar with
a bundled Chromium instead of the system WebKit:

```txt
Busabase Desktop (.deb, /opt/apps/com.busabase.app)
-> Electron 44 shell (bundled Chromium, needs only GLIBC 2.25)
-> same apps/busabase OSS sidecar on 15419, same ~/.busabase/data
```

```bash
# Requires Linux; stages src-tauri/r/ first, then builds the package.
node apps/busabase-desktop/electron/scripts/build-uos-deb.mjs --out dist/
# Reuse an already staged sidecar:
node apps/busabase-desktop/electron/scripts/build-uos-deb.mjs --skip-prepare --out dist/
# Tests (no Electron download, no sidecar staging):
node --test apps/busabase-desktop/electron/test/*.test.*
```

The build refuses to ship a package whose binaries need symbols newer than UOS 20 provides
(`electron/scripts/elf-abi.mjs`, `readelf -V`) and forces `-Zxz` compression, because `dpkg` on
Debian 10/UOS 20 cannot read zstd members.

Differences from the Tauri shell, all deliberate:

- **No self-update.** The package is root-owned under `/opt`, so the shell only reports a newer build
  and opens the download URL. Its platform id is `linux-x86_64-uos` in the release manifest.
- **The window loads the sidecar dashboard directly** instead of embedding it in an iframe with a
  custom titlebar. `window.open()` is a real Chromium window when the main process allows it, so
  Cloud Connect and other popups no longer need the `postMessage` → `open-external` bridge.
- **Agent adapter install is manual.** The `install_agent_adapter` bridge only answers inside a
  framed Tauri window, so the "Connect" flow for Codex/Claude ACP cannot install the pinned adapter
  with the bundled npm. The dashboard falls back to its "not in the desktop shell" copy.
- **`Conflicts`/`Replaces: busabase-desktop`.** Both shells claim the `busabase://` scheme and the same
  data directory, so they may never be installed side by side.

### Installing on UOS 20: the signature check

UOS 20 ships the security-center policy "仅允许签名应用" (only signed applications may be installed), so the
graphical installer aborts before any of our files run:

```txt
'…Desktop_…_uos_amd64.deb' that failed the verification,
please go to Security Center - Security Tools - Application Security to adjust.
dpkg: 处理归档 /tmp/LinkTemp/com.busabase.app (--install) 出错:
  if test -x /usr/sbin/deepin-pkg-install-hook;then /usr/sbin/deepin-pkg-install-hook -e hc-verifysign;fi
安装失败
```

This is a system policy, not a packaging defect — an unsigned `.deb` is refused the same way, **including
the existing Tauri Linux package**. Until a 统信 developer certificate is available, install in one of these
ways:

1. 控制中心 → 安全中心 → 安全工具 → 应用安全 → 选择「任意应用」（任意应用可在系统内安装运行），然后正常安装 `.deb`；装完可以改回更严的策略。
2. 或从终端安装：`sudo dpkg -i "Busabase Desktop_…_uos_amd64.deb"`（签名 hook 挂在 apt 上，图形安装器走 apt 才会命中）。

**Signing status:** there is no 统信 developer certificate yet. When one is available the signing step goes
into `electron/scripts/build-uos-deb.mjs` behind `UOS_SIGN_*` (skipped with an explicit "unsigned" log line
when unset), with the certificate stored as a CI secret. An AppImage — which would bypass dpkg and the policy
entirely — was evaluated and is deliberately not built for now.

The sidecar env, port, data directory, single-instance lock, autostart entry, deep-link scheme, and
boot/failure page are identical to the Tauri shell.

## Sidecar Model

```txt
Busabase Desktop
-> Tauri shell
-> Next.js static shell
-> embedded apps/busabase OSS dashboard and API
-> local PGlite data
-> localhost API
```

Cloud Relay is intentionally not enabled in the MVP. Public API access should be opt-in and must add authentication, relay URLs, and rate limits before exposing local data.
