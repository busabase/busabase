# busabase-sdk

Typed TypeScript / JavaScript SDK for the [Busabase](https://busabase.com) OpenAPI REST API. Talks to a local or remote `busabase server`, or to Busabase Cloud.

It's the programmatic sibling of [`busabase-cli`](../busabase-cli): same connection model (server root, optional API key, optional space), but shipped as an importable, fully-typed library instead of a command-line tool.

## Install

```bash
npm install busabase-sdk
# or: pnpm add busabase-sdk / yarn add busabase-sdk
```

Requires Node.js ≥ 20. Ships ESM with bundled type declarations. `zod` and `@orpc/*` are the only runtime dependencies.

## Quick start

```ts
import { Busabase } from "busabase-sdk";

const bb = new Busabase({
  baseUrl: "http://localhost:15419", // or omit for Busabase Cloud
  apiKey: process.env.BUSABASE_API_KEY, // cloud only; a local OSS server is open
});

await bb.health(); // { status, timestamp }

const bases = await bb.bases.list();
const record = await bb.records.get({ recordId });
const cr = await bb.changeRequests.merge({ changeRequestId });
```

Every constructor field is optional and falls back to an environment variable:

| Option    | Env var              | Default                    |
| --------- | -------------------- | -------------------------- |
| `baseUrl` | `BUSABASE_BASE_URL`  | `https://busabase.com`     |
| `apiKey`  | `BUSABASE_API_KEY`   | — (none; local is open)    |
| `spaceId` | `BUSABASE_SPACE_ID`  | no header; multi-space Cloud calls require one |

`baseUrl` accepts either the server root (`http://host`) or the full API path (`http://host/api/v1`) — the `/api/v1` suffix is normalized away.

## Local AirApp OAuth

Local Hono apps can connect without asking the user to run the CLI or paste an API key. Start a PKCE authorization request, validate the callback, exchange the code, then register the returned token set in the local Busabase credential directory:

```ts
import {
  createBusabaseOAuthRequest,
  exchangeBusabaseOAuthCode,
  parseBusabaseOAuthCallback,
} from "busabase-sdk/oauth";
import { storeBusabaseAirAppOAuthCredential } from "busabase-sdk/oauth-node";

const request = await createBusabaseOAuthRequest({
  baseUrl: "https://busabase.com",
  redirectUri: "http://127.0.0.1:3107/auth/callback",
});

// Keep request.codeVerifier and request.state in the Hono server, then redirect
// the browser to request.authorizeUrl.
const code = parseBusabaseOAuthCallback(callbackUrl, request);
const tokenSet = await exchangeBusabaseOAuthCode(request, code);
storeBusabaseAirAppOAuthCredential({
  appId: "kelly-invest-stock",
  baseUrl: request.baseUrl,
  tokenSet,
});
```

The Node-only helper writes `~/.busabase/airapps/<app-id>.json` with an owner-only directory and file (`0700`/`0600`). Use `getBusabaseAirAppAccessToken()` inside Hono when proxying `/api/v1`; it refreshes and persists the token set when needed. Use `revokeBusabaseAirAppOAuthCredential()` on logout. The browser must never receive the `bso_` access token, `bsr_` refresh token, or PKCE verifier through JavaScript-visible storage. This local AirApp registration is separate from the CLI's active `~/.busabase/.env` profile.

## Building an AirApp

Three entry points cover what every AirApp needs before it can show its first screen. Use them instead of reimplementing any part — the rules they encode (which server, whose Space, whose Folder) are a security boundary, not app preferences.

### `busabase-sdk/airapp-node` — the local gateway (server)

`createBusabaseAirAppLocalGateway()` owns the whole standalone-run boundary: the pending PKCE request, credential rotation, auth verification, validated Space persistence, logout, and the `/api/v1` proxy. Do not copy those mechanics into each app.

```ts
import { createBusabaseAirAppLocalGateway } from "busabase-sdk/airapp-node";

const gateway = createBusabaseAirAppLocalGateway({ appId: "kelly-crm", successPath: "/#/overview" });

app.get("/auth/status", (c) => gateway.statusResponse(c.req.raw));
app.post("/auth/start", (c) => gateway.start(c.req.raw));
app.get("/auth/callback", (c) => gateway.callback(c.req.raw));
app.post("/auth/space", (c) => gateway.selectSpace(c.req.raw));
app.post("/auth/logout", (c) => gateway.logout(c.req.raw));
app.all("/api/v1/*", (c) => gateway.proxy(c.req.raw));
```

`proxy()` always sets `x-busabase-space` from its own validated selection and ignores any such header on the incoming request, so a page cannot talk the gateway into reading another Space.

### `busabase-sdk/airapp` — resource provisioning (isomorphic)

Declare the Folder and Bases the app needs; the SDK claims or creates them as one idempotent ChangeRequest.

```ts
import { inspectProvisionedResources, provisionDeclaredResources } from "busabase-sdk/airapp";

const config = {
  appId: "kelly-crm",
  appName: "Kelly CRM",
  schemaVersion: 1,
  folder: { slug: "kelly-crm", name: "Kelly CRM", description: "CRM workspace" },
  bases: [{ key: "contacts", slug: "kelly-crm-contacts-v1", name: "Contacts", fields: [/* … */] }],
};

let resources = await inspectProvisionedResources(client, config);
if (!resources.folder || resources.missing.length) {
  resources = await provisionDeclaredResources(client, config);
}
```

An app that ships its own AirApp node inside the Folder declares it too — `airApp: { slug, name, resourceKey }`. It is published, not provisioned, so it is never created here; declaring it is what lets it be stamped, and what stops it from reading as an unattributable stranger that blocks a legacy claim.

**An app owns a node only if it stamped it.** Ownership lives in `node.metadata` as `{ appId, resourceKey, schemaVersion }`. An unstamped node is adopted only when its slug, name, description, and full field list still match the declaration exactly; anything else raises `SETUP_CONFLICT` and nothing is mutated. A `schemaVersion` bump re-stamps in place — it never recreates a Base, so data survives. Concurrent callers on the same client share one in-flight submission.

**Bases evolve by appending fields.** A live Base whose fields are a strict *prefix* of the declaration is an older schema of yours: the missing suffix is added, one approval-gated `bases.fieldChangeRequest` per field, and anything left unapproved surfaces as `SETUP_PENDING` naming the requests. A field renamed, retyped, reordered, or removed is not an upgrade this can reason about, so it refuses rather than guessing which shape is right.

Failures are an `AirAppSetupError` carrying a `code`: `SETUP_REQUIRED` (offer to initialize), `SETUP_PENDING` (submitted, awaiting approval — the permission model working as designed), `SETUP_CONFLICT`, `SETUP_PERMISSION`, `SCHEMA_INCOMPLETE`. `message` keeps the `"CODE: detail"` shape so code that parses the prefix keeps working.

### `busabase-sdk/airapp-gate` — the connect UI (browser)

The three screens the operator sees before the app mounts: choose a server and connect, choose a Space, and initialize the workspace.

```ts
import { createAirAppConnectGate } from "busabase-sdk/airapp-gate";

const gate = createAirAppConnectGate({
  appName: "Kelly CRM",
  shouldGate: () => !isDemo() && shouldUseLocalGateway(), // see below
  onProvision: () => provisionDeclaredResources(client, config),
  demoHref: "?demo=1",
});

if (await gate.pass({ onReady: start })) start();
// …and when loading data fails because the workspace is not set up yet:
gate.renderSetupRequired(error, start);
```

`pass()` returns `true` when the app may load data.

**Pass `shouldGate`.** Where an app runs is a fact its host states: Busabase injects `BUSABASE_AIRAPP_RUNTIME` into the process it spawns, and the app's own server surfaces that to the browser. Never classify it by hostname, iframe nesting, or path — a hosted AirApp can be served from `localhost`, and a standalone run can be reached over a dev tunnel, so both directions of that guess are wrong. Omitted, `pass()` falls back to probing `/auth/status` and treating an unreachable or non-JSON answer as hosted; that works, but it infers something you already know.

Import `busabase-sdk/airapp-gate.css` for the default look; every colour, radius, and font is a `--bb-gate-*` custom property, so an app themes it by overriding them rather than forking. To replace the markup entirely, pass `render` — `selectAirAppGateScreen()` and `describeAirAppSetupError()` are exported so a custom renderer reuses the state machine instead of re-deriving it.

## Data client entry points

**`Busabase` class** — an ergonomic wrapper with namespaced methods (`bb.bases`, `bb.records`, `bb.changeRequests`, `bb.nodes`, `bb.views`, `bb.assets`, `bb.fileTrees`, `bb.files`, `bb.docs`, `bb.comments`, `bb.auditEvents`, `bb.agent`, `bb.agentTasks`, `bb.embedLinks`, `bb.search()`, `bb.grep()`, `bb.health()`, `bb.me()`). Drop to `bb.client` for the raw oRPC client (e.g. `bb.client.system.meta()`).

Reading or listing nodes goes through `bb.nodes`, whatever the node's type:

```ts
const docs = await bb.nodes.list({ types: ["doc"] }); // flat summaries, one call
const detail = await bb.nodes.get({ nodeId }); // discriminated by `detail.type`
if (detail.type === "doc") console.log(detail.body);
```

`bb.nodes.get` replaced the per-type gets (`docs.get` / `files.get` / `folders.get` / `fileTrees.get`), so a caller holding an id no longer has to discover the node's type before it can read it — and there is no `bb.folders` namespace any more (a folder is `type: "folder"`). `bb.docs` / `bb.files` / `bb.fileTrees` remain for the operations that are genuinely type-specific: creating a node, reading a Doc line range, updating a Doc body, and listing/reading a Skill-, Drive-, or AirApp file.

**`createBusabaseClient(config?)`** — returns the raw, fully-typed [oRPC](https://orpc.unnoq.com) client directly, if you'd rather not wrap it in a class:

```ts
import { createBusabaseClient } from "busabase-sdk";

const client = createBusabaseClient({ apiKey: "…" });
await client.records.search({ fieldSlug: "email", valueText: "a@b.com" });
```

## Types

Every View Object type is re-exported, so you can annotate your own code without depending on Busabase internals:

```ts
import type { BaseVO, RecordVO, ChangeRequestVO } from "busabase-sdk";
```

## Build

```bash
pnpm build      # tsup → dist/index.js (+ index.d.ts)
pnpm typecheck  # tsc --noEmit
```

The build bundles the internal `busabase-contract` (oRPC contracts + VO types) straight into `dist`, so the published package has zero workspace dependencies.
