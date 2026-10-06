# Busabase Desktop

Busabase Desktop is the private local-first desktop shell for the open-source Busabase knowledge base.

The desktop app uses Tauri and manages the existing `apps/busabase` OSS server as a local sidecar. The default mode is private: Busabase binds to localhost and keeps data in the local desktop data directory.

When the desktop window opens, it starts the sidecar automatically, then the desktop SPA loads data from the sidecar API at `http://127.0.0.1:15419/api/v1`. The sidecar also serves the OSS web UI for debugging or browser fallback, but the desktop app renders its own static SPA instead of embedding that webpage.

## Development

```bash
pnpm --filter @busabase/desktop tauri dev
```

The Tauri shell runs on port `3064`. The managed Busabase sidecar runs on port `15419`.

The sidecar command sets `PORT=15419` and `PG_DATABASE_URL` to the desktop-owned PGlite directory
before running `pnpm --filter busabase dev`.

Environment overrides:

- `BUSABASE_DESKTOP_WORKSPACE_ROOT` points the sidecar launcher at a specific workspace root.
- `BUSABASE_DESKTOP_PNPM` overrides the `pnpm` executable used to launch the OSS sidecar.

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
-> Next.js static SPA
-> apps/busabase OSS sidecar API
-> local PGlite data
-> localhost API
```

Cloud Relay is intentionally not enabled in the MVP. Public API access should be opt-in and must add authentication, relay URLs, and rate limits before exposing local data.
