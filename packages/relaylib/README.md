# relaylib

Reusable **reverse-WebSocket relay tunnel** transport, extracted from
`apps/buda`'s connector relay.

A private daemon (keyed by an opaque string id) holds a persistent WebSocket to
a **relay hub**. The hub turns a `request(id, { method, path, ... })` call into
a streamed `Response` by forwarding the request over that socket and
re-assembling the daemon's `start` / `chunk` / `end` / `error` reply.

Transport only — **no auth, no persistence, no app-specific types**. Each app
owns its own hub instance and layers registration/auth/routing on top.

## Hub side (the server / cloud)

```ts
import { createMemoryRelayHub } from "relaylib";

// One hub instance per process (the app's composition root).
const hub = createMemoryRelayHub();

// On a WebSocket upgrade, hand the socket to the hub keyed by tunnel id.
hub.register(tunnelId, socket);

// Anywhere server-side, issue an HTTP-shaped request down the tunnel.
const res = await hub.request(tunnelId, { method: "GET", path: "/api/v1/records" });

hub.isOnline(tunnelId); // boolean
```

## Daemon side (the private service)

`attachRelayClient` runs the protocol loop on a hub socket the caller already
connected — so connection, auth headers, reconnection, and heartbeat stay the
app's concern. `createFetchHandler` forwards each relayed request to a local
base URL; supply your own handler to add origin guards, audit logging, etc.

```ts
import WebSocket from "ws";
import { attachRelayClient, createFetchHandler } from "relaylib";

const socket = new WebSocket(hubUrl, { headers: { Authorization: `Bearer ${token}` } });
socket.on("open", () => {
  attachRelayClient(socket, createFetchHandler("http://localhost:3000"));
});
```

## Implementations

- `createMemoryRelayHub()` — single process, in-memory map. (Current.)
- `createRedisRelayHub()` — cross-instance via Redis pub/sub. (Planned: needed
  before any multi-replica public ingress; the tunnel's socket lives on one
  instance but requests may land on another. Will implement the same `RelayHub`
  interface.)

## Wire protocol

Hub → daemon: `{ type: "request", requestId, request }`. Daemon → hub:
`start` → `chunk`* → `end` (or `error`). Chunks carry an optional
`encoding: "utf8" | "base64"`:

- **omitted / `"utf8"`** — `data` is raw text (the original buda daemon's
  behavior; kept for backward compatibility).
- **`"base64"`** — `data` is base64; what `attachRelayClient` emits, so **binary
  payloads round-trip intact**.

The hub decodes per the flag, so old (utf8) and new (base64) daemons interop
with a base64-aware hub. Rolling a daemon to base64 requires a base64-aware hub
to be deployed first.

## Notes / limitations

- `register` replaces any existing socket for the same id (one live tunnel per
  id) and rejects in-flight requests on replace/close.
- The hub's `request` resolves once the daemon sends `start`; it rejects if the
  daemon is offline or no `start` arrives within the configured timeout.
