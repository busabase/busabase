# Busabase Node Types

Busabase organizes trusted knowledge as nodes. Every node appears in the left navigation and can be changed through the same Change Request review flow.

![Create node menu showing Folder, Base, Skill, Drive, and Doc](../public/assets/docs/busabase-create-node-menu.png)

## Current Types

| Type | Use it for | Review behavior |
| --- | --- | --- |
| Folder | Navigation groups for related nodes | Rename, move, create, delete, and restore through node operations |
| Base | Structured records with typed fields | Field, view, record, and schema changes go through review |
| Skill | Agent-readable file trees | Files and metadata are stored in object storage and changed through file-tree operations |
| Drive | Plain file collections | Files are stored in object storage with a seeded `README.md`; no `SKILL.md` or `skill.json` |
| AirApp | Agent-authored, human-runnable web apps | Files are stored the same way as Skill/Drive; the node detail view adds a Run panel that executes the app in-browser |
| Doc | Single approved document pages | Document updates are reviewed before merge |

## Drive

Drive is a pure file-tree node. It uses the same file listing, read, change-request, and merge machinery as Skill, but its seed is intentionally minimal: one `README.md` file.

![Drive node detail view with README.md](../public/assets/docs/busabase-drive-node-detail.png)

## Skill

Skill remains backward-compatible. Existing `/skills/*` API routes, `SkillVO`, contract schemas, and core handler exports keep the same names and shapes. The implementation now delegates to the shared file-tree kind.

![Skill node detail view with SKILL.md and skill.json](../public/assets/docs/busabase-skill-node-detail.png)

## AirApp

AirApp is also a file-tree node — same file listing, read, change-request, and merge machinery as Skill and Drive. An agent writes or edits the app's files through the normal ChangeRequest flow; a human opens the node and sees three tabs: **App** (the default — a Run button and a live preview iframe), **Files** (a read-only file browser + code viewer), and **Logs** (streaming install/start output). Clicking Run executes the app through the selected **runtime engine** — the Run panel has an engine picker (default **Nodepod**) — and streams its install/start output into the Logs tab; once the app's server reports ready, the App tab's preview iframe points at it. Each engine installs the app's declared dependencies (`npm install`) then starts it (`npm run dev`); they differ in *where* that happens and *what capabilities the running app gets*.

### Runtime engines (pluggable, divided by capability)

There is a shared `AirAppRunner` interface (`mount → install → start`, plus `onLog`/`onReady`) with **three** implementations. The engines are **not** interchangeable — they occupy deliberately different niches along a trade-off triangle of **runtime fidelity ↔ isolation ↔ live preview**, and the Run panel's engine picker labels each with its trade-off:

| Engine | Runs where | Runtime fidelity | Isolation | Live preview | busabase data bridge (`/__busabase_api__/`, `createBusabaseRpcClient`) | Best for |
| --- | --- | --- | --- | --- | --- | --- |
| **Nodepod** (`@scelar/nodepod`) | In the reviewer's **browser** (Web Worker + Service Worker), same-origin with busabase | Reimplemented Node API surface — **not** a full Node.js (see below) | Browser sandbox | ✅ Yes (SW-served) | ✅ **Yes** — the SW owns the origin and carves out the bridge prefix; a running app reads the workspace's own live data as the logged-in reviewer | Live-data AirApps (dashboards, CRM widgets, anything that calls busabase's own API) |
| **Local Node.js** (bare) | A **bare** real OS Node.js process on the server host — spawned directly, **not** OS-isolated (trust model is the local host) | Real Node.js — real native binaries, real `node:*`, real npm | ⚠️ None (host trust) | ✅ **Yes** — reverse proxy | ✅ **Yes** — busabase **reverse-proxies** the real localhost process to a same-origin sub-path (`/api/airapp-preview/{nodeId}/`) and serves `/__busabase_api__/…` from a server route that forwards to the real backend with the browser's cookie. A bare process's port IS host-reachable, so this works. Caveats: the app must use **relative** asset paths (an arbitrary app hard-coding absolute `/foo` paths won't render under the sub-path proxy, unlike Nodepod's origin-owning SW); no WebSocket/HMR proxying | Standalone / heavier AirApps that need true Node compatibility (things Nodepod can't run) — and can still read busabase's own data |
| **Sandboxed (srt)** (`@anthropic-ai/sandbox-runtime`) | The **same** real OS Node.js process, but wrapped in the OS sandbox (seccomp/bubblewrap on Linux, `sandbox-exec` on macOS) — writes confined to the run's workdir, network limited to the npm registry | Real Node.js | ✅ OS-level | ❌ **No** — verified | ➖ N/A while previewing — srt **network-isolates** the process, so its listening port is **not reachable** from the host reverse proxy. Isolated execution + streamed logs work; the App-tab preview iframe just won't load. Verified via spikes (3 network configs + no port-forward capability all failed) | Untrusted / isolated execution where you only need to run the app and read its logs, not preview it live |

The **trade-off triangle:** you can't have all three of full Node fidelity, OS isolation, and a live in-dashboard preview at once. Nodepod trades Node fidelity for a browser sandbox + preview. Local Node.js (bare) trades isolation for full fidelity + preview. srt trades the live preview for full fidelity + real OS isolation. `local-node` and `srt` share **all** runtime logic (`logic/local-node-runtime.ts`) and differ only in whether the `npm install`/`npm run dev` commands are wrapped by srt's `SandboxManager` (srt) or spawned bare (local-node).

Nodepod and Local Node.js support the `/__busabase_api__/` data bridge via **different mechanisms**: Nodepod's in-browser Service Worker vs. a busabase server-side reverse proxy for Local Node.js. (srt can't serve a live preview at all, so the bridge is moot for it.)

**Why a reverse proxy for Local Node.js (not a second Service Worker):** the Local Node preview is a real OS process on `http://localhost:{port}` — a *different origin* from busabase, so its iframe couldn't share busabase's session/origin directly. Rather than replicating Nodepod's SW bridge (which would mean either a *second* Service Worker fighting Nodepod's over the same origin scope — SWs don't cleanly co-exist on one scope — or folding both routing modes into one busabase-owned SW that duplicates the vendored Nodepod patch), busabase reverse-proxies the localhost process to a same-origin sub-path and serves the `/__busabase_api__/` bridge from an ordinary server route. This is the natural fit for a real-process engine (one server-side layer, no origin-scope collision with Nodepod's SW) and generalizes cleanly to any future out-of-origin engine (e.g. a sandock-backed one). Trade-offs: the proxied app must use relative asset paths, and the port registry is single-process (a run and its proxy requests must hit the same Next.js server) — the same limitation class as the sandbox singleton.

**What runs inside Nodepod:** Nodepod reimplements Node's API surface to run inside a browser Web Worker — it is not a full Node.js. Anything needing a real OS process, a real native binary, or a real headless browser will not work, no matter how it's configured; pure JavaScript (plus WASM-compiled fallbacks) generally does.

- **Works:** a pure static HTML/CSS/JS project with no `package.json` dependencies, served by a five-line `node:http` file server (the seed template's *simplest* demo — no framework needed at all, and no runner-level special-casing either: `npm install` with nothing to install is reported by Nodepod itself as `added 0 packages in 0.0s`, so this goes through the exact same `npm install && npm run dev` path as every other demo); a plain Node HTTP server with a real dependency (the Hono + `@hono/node-server` seed template, no bundler); `node:sqlite`; Vite pinned to `vite@7.3.1` (older Vite crashes on boot with `Cannot destructure property 'createServer'`) either with `@vitejs/plugin-react` (Babel-based Fast Refresh — fixed in Nodepod `1.9.6`, re-verified working on `1.9.9`) or by skipping it and configuring JSX via Vite's own esbuild transform instead (`esbuild: { jsx: 'automatic' }`, no Fast Refresh but no Babel dependency either). Hono mounted as Vite middleware also works under the same pin.
- **Confirmed broken:** `@vitejs/plugin-react-swc` → `Failed to load native binding` (SWC ships a native binary Nodepod can't load; still broken, identical error, as of `1.9.9`). Any tool needing a platform-native binary at install/boot time should be assumed broken the same way. HeyGen's [HyperFrames](https://github.com/heygen-com/hyperframes) CLI installs cleanly but `hyperframes preview` crashes with `TypeError: require is not a function` (also still broken as of `1.9.9`); its full render pipeline (Puppeteer + FFmpeg) is architecturally incompatible regardless. Next.js hasn't been tested directly — its default compiler (SWC) is still broken for the reason above, but its Babel fallback no longer is.

The seed gallery keeps the working demos (Pure HTML, Hono, two Vite+React variants, Hono+Vite, SQLite) *and* the still-broken ones (SWC, HyperFrames) as live, runnable nodes rather than deleting them — clicking Run on a broken one reproduces the real upstream failure, and if Nodepod fixes it, the demo starts succeeding without any change on the Busabase side, exactly like what happened with the Babel demo.

> The rest of this section describes the bridge from **Nodepod's** point of view — it is Nodepod's Service Worker that intercepts the prefix in-browser. The **Local Node.js** engine exposes the same `/__busabase_api__/` prefix and `createBusabaseRpcClient` usage, but implemented as a busabase server-side reverse proxy instead of a Service Worker (see the engine table above); the secure-context requirement is Nodepod-specific (only its SW needs one). The bridge *prefix and client usage below are identical for both engines* — only the mechanism differs.

**Calling busabase's own API from inside a running app requires the `/__busabase_api__/` bridge — a plain relative `fetch()` does not work.** The preview does resolve to a same-origin URL (confirmed via Nodepod's own service worker — not a cross-origin sandbox), so it initially looked like the running app's own `fetch()` calls back to busabase would ride along on the current user's session cookie automatically. Tested directly against a real authenticated busabase-cloud session with a purpose-built probe AirApp: a plain `fetch("/api/rpc/...")` — or any other real busabase route, e.g. `/api/health` — comes back as a flat `404 Not Found` from Nodepod's own virtual server, never reaching the real network. Nodepod's service worker intercepts every request from a claimed preview client and answers it from the sandboxed app's own routes (or its 404 fallback when nothing matches) instead of passing it through, regardless of path — so this has nothing to do with cookies, `SameSite`, or auth; the request simply never leaves the sandbox.

To fix this, `@scelar/nodepod` is patched (`patches/@scelar__nodepod@1.9.9.patch`, applied via pnpm's `patchedDependencies`) to add a reserved bridge prefix to its service worker's fetch dispatch, ahead of any pod-claiming logic: a request to `/__busabase_api__/<real-path>` is never routed to the sandboxed app — the SW strips the prefix and replays the request against `<real-path>` on the real origin with `credentials: "include"`, so it's a genuine browser-native `fetch()` that carries the current user's (possibly `httpOnly`) session cookie automatically. A running app calling busabase's own API must therefore prefix every such call, e.g. `fetch("/__busabase_api__/api/rpc/core/changeRequests/counts", { method: "POST", ... })` instead of `fetch("/api/rpc/core/changeRequests/counts", ...)`. Verified end-to-end against a real busabase-cloud session: the same probe AirApp that got a flat `404` on the plain path got a real `200` with real data through the bridge.

The prefix is deliberately reserved and namespaced (not a bare `/api/*` passthrough) because several seed demos define their own `/api/*` routes on their own sandboxed server (the Hono demo's `/api/greeting`, the SQLite demo's `/api/items`) — those must keep resolving inside the sandbox, not get redirected to busabase's real backend.

**Prefer `busabase-sdk`'s `createBusabaseRpcClient` over hand-writing bridge `fetch()` calls.** It's the same npm package `busabase-cli` and server/CLI code already use for the public API (`createBusabaseClient`), plus a second, RPC-transport client built for this exact use case — fully typed, no `apiKey`, authenticated purely by the ambient session cookie:

```ts
import { createBusabaseRpcClient } from "busabase-sdk";

// apps/busabase (OSS): apiBasePath: "/__busabase_api__/api/rpc"
// apps/busabase-cloud: apiBasePath: "/__busabase_api__/api/rpc/core" (busabase's
//   own procedures are mounted under a `core` prefix there — see below)
const client = createBusabaseRpcClient({ apiBasePath: "/__busabase_api__/api/rpc/core" });
const counts = await client.changeRequests.counts();
```

**The `/api/rpc` mount path differs between the two deployments — this isn't optional to get right.** `apps/busabase` mounts busabase's procedures unnamespaced, directly at `/api/rpc/*`. `apps/busabase-cloud` aggregates busabase alongside other concerns and mounts the same procedures under `/api/rpc/core/*` instead. `createBusabaseRpcClient` doesn't probe for which one it's talking to — pass the right `apiBasePath` for your target, or every call 404s. (`createBusabaseClient`'s public `/api/v1` surface doesn't have this problem — that contract is stable across both deployments.)

**This bridge grants a running AirApp the same API access as the reviewer who clicks Run — there is currently no scoping, allowlist, or capability restriction.** Any agent-authored AirApp that reaches Change Request review and gets merged can, once run, read and write anything the merging reviewer's account can reach through `/api/rpc/*` or `/api/v1/*`, silently, with no separate consent step beyond the normal review. Treat this the same as reviewing any other code change that will execute with your account's privileges — a reviewer who doesn't read the JS bundle for hidden API calls won't catch one from the Run panel alone.

Running always reflects the node's current (merged/HEAD) file tree — previewing a pending, not-yet-merged ChangeRequest's files isn't supported yet for any node type in Busabase.

**Run requires a secure context.** Service Workers — what Nodepod uses to intercept preview/virtual-server requests — only register in a browser "secure context": `https:`, or the literal hostname `localhost`/`127.0.0.1`/`[::1]`. Accessing the dashboard over plain HTTP through any other hostname (a LAN IP, a custom DNS name mapped to your machine, a tunnel domain) is **not** a secure context even though it resolves to the same server, so the service worker silently fails to register and clicking Run 404s. Use `https://` or `http://localhost:<port>` for local development.

## Review Flow

Node changes, file changes, and metadata changes all land in the Inbox as reviewable operations. Reviewers can inspect the proposed change, request edits, approve it, and merge it into the trusted tree.

![Inbox review list with node and file operations](../public/assets/docs/busabase-inbox-review.png)
