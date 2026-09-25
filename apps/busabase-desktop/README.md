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
