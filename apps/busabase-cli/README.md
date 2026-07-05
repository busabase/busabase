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
| `--space-id`   | `BUSABASE_SPACE_ID`  | _(cloud default space)_  |
| `--output`     | —                    | `table` (`json` for raw) |

Config is read from flags, then env vars, then `~/.busabase/.env` (auto-loaded —
no need to `source` it), then the default. An exported env var overrides the file.

The default host is the always-on Cloud, which needs credentials. For a local
server, pass `--base-url http://localhost:15419` (or set `BUSABASE_BASE_URL`); the
open-source server needs no auth.

## Sign in

Two ways to authenticate against Cloud — **OAuth is preferred**, an API key is the
fallback. Either way, `login` verifies the credential, picks your space, and writes
`~/.busabase/.env` so every later command (and the installed `busabase` skill) just
works:

```bash
busabase-cli login                 # choose in a prompt: browser OAuth or paste an API key
busabase-cli login --oauth         # browser sign-in (opens a PKCE flow, no key to copy)
busabase-cli login --api-key sk_…  # store an API key non-interactively (headless/CI)
busabase-cli login --refresh       # slide the current OAuth session forward (no browser)
busabase-cli logout                # revoke the OAuth session and clear the saved creds
```

OAuth mints a rolling login session (`bss_…`). You don't normally need `--refresh`:
the CLI **auto-refreshes** an actively-used session before it expires, so a session
stays alive as long as you keep using it. If you've been away and it lapses, just run
`busabase-cli login` again. Prefer an API key for long-lived automation — create one
at **Dashboard → Settings → API Keys**.

## Examples

```bash
busabase-cli whoami                       # active space / user / membership
busabase-cli bases list
busabase-cli bases get --slug tasks
busabase-cli nodes create-change-request --type folder --slug crm --name "CRM"
busabase-cli nodes create-change-request --type base --slug contacts --name "Contacts" --parent-node-id nod_123 --field name:Name:text
busabase-cli bases create-field --base-id bse_123 --slug cover_image --name "Cover image" --field-type attachment --max-files 1 --allowed-mime image/png --allowed-mime image/svg+xml
busabase-cli bases update-field-change-request --base-id bse_123 --field-id bsf_123 --max-files 1 --allowed-mime image/png
busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello"}'
busabase-cli bases create-change-request --base-id bse_123 --fields-json @record.json
busabase-cli records list --base-id bse_123 --limit 20 --output json
busabase-cli records by-field-text --field-slug status --value-text open
busabase-cli attachments upload --file ./cover.png --context record-field --output json
busabase-cli change-requests list
busabase-cli change-requests review --change-request-id cr_123 --verdict approved --reason "LGTM"
busabase-cli change-requests review --change-request-id cr_124 --verdict rejected --reason "Needs revision" # request changes
busabase-cli change-requests close --change-request-id cr_125 --reason "Wrong proposal"                  # terminal close
busabase-cli change-requests merge --change-request-id cr_123
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
