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

## Two entry points

**`Busabase` class** — an ergonomic wrapper with namespaced methods (`bb.bases`, `bb.records`, `bb.changeRequests`, `bb.nodes`, `bb.views`, `bb.assets`, `bb.skills`, `bb.docs`, `bb.folders`, `bb.comments`, `bb.auditEvents`, `bb.agent`, `bb.agentTasks`, `bb.embedLinks`, `bb.search()`, `bb.health()`, `bb.me()`). Drop to `bb.client` for the raw oRPC client (e.g. `bb.client.system.meta()`).

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
