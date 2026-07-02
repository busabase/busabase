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

| Flag           | Env                  | Default                  |
| -------------- | -------------------- | ------------------------ |
| `--base-url`   | `BUSABASE_BASE_URL`  | `https://busabase.com`   |
| `--api-key`    | `BUSABASE_API_KEY`   | _(none — local is open)_ |
| `--output`     | —                    | `table` (`json` for raw) |

Config is read from flags, then env vars, then `~/.busabase/.env` (auto-loaded —
no need to `source` it), then the default. An exported env var overrides the file.

The default host is the always-on Cloud, which needs an `--api-key`. For a local
server, pass `--base-url http://localhost:15419` (or set `BUSABASE_BASE_URL`); the
open-source server needs no auth.

## Examples

```bash
busabase-cli whoami                       # active space / user / membership
busabase-cli bases list
busabase-cli bases get --slug tasks
busabase-cli nodes create-draft --type folder --slug crm --name "CRM"
busabase-cli nodes create-draft --type base --slug contacts --name "Contacts" --parent-node-id nod_123 --field name:Name:text
busabase-cli records list --limit 20 --output json
busabase-cli records by-field-text --field-slug status --value-text open
busabase-cli drafts list
busabase-cli drafts review --draft-id cr_123 --verdict approved --reason "LGTM"
busabase-cli drafts review --draft-id cr_124 --verdict rejected --reason "Needs revision" # request changes
busabase-cli drafts close --draft-id cr_125 --reason "Wrong proposal"                  # terminal close
busabase-cli drafts merge --draft-id cr_123
busabase-cli search --query invoice
busabase-cli api --method get --path /nodes        # raw OpenAPI passthrough
```

Run `busabase-cli --help` for the full command list.

## Programmatic use

```ts
import { createBusabaseClient } from "busabase-cli";

const client = createBusabaseClient({ baseUrl: "http://localhost:15419", output: "json" });
const bases = await client.bases.list();
```
