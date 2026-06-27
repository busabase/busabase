# busabase-cli

Command-line client for the [Busabase](https://busabase.com) OpenAPI REST API. It
talks to a local or remote `busabase server` over `/api/v1`, with a fully typed
client generated from the shared oRPC contract.

> Want the server too? Install [`busabase`](https://www.npmjs.com/package/busabase)
> instead — it bundles this CLI **and** adds `busabase server`, so `busabase <cmd>`
> gives you every command below plus a zero-setup local instance.

## Install

```bash
npm install -g busabase-cli
# or run without installing
npx busabase-cli health
```

## Configure

| Flag           | Env                       | Default                  |
| -------------- | ------------------------- | ------------------------ |
| `--base-url`   | `BUSABASE_API_BASE_URL`   | `http://localhost:3061`  |
| `--api-key`    | `BUSABASE_API_KEY`        | _(none — local is open)_ |
| `--output`     | —                         | `table` (`json` for raw) |

The local open-source server needs no auth. `--api-key` is only for hosted
deployments that verify a bearer token.

## Examples

```bash
busabase-cli whoami                       # active space / user / membership
busabase-cli bases list
busabase-cli bases get --slug tasks
busabase-cli records list --limit 20 --output json
busabase-cli records by-field-text --field-slug status --value-text open
busabase-cli drafts list
busabase-cli drafts review --draft-id cr_123 --verdict approved --reason "LGTM"
busabase-cli drafts merge --draft-id cr_123
busabase-cli search --query invoice
busabase-cli api --method get --path /nodes        # raw OpenAPI passthrough
```

Run `busabase-cli --help` for the full command list.

## Programmatic use

```ts
import { createBusabaseClient } from "busabase-cli";

const client = createBusabaseClient({ baseUrl: "http://localhost:3061", output: "json" });
const bases = await client.bases.list();
```
