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
| `--space-id`   | `BUSABASE_SPACE_ID`  | _(none; multi-space Cloud calls require one)_ |
| `--output`     | —                    | `text` (`json` for raw, `table` for aligned columns) |

Config is read from flags, then env vars, then `~/.busabase/.env` (auto-loaded —
no need to `source` it), then the default. An exported env var overrides the file.

The default host is the always-on Cloud, which needs credentials. For a local
server, pass `--base-url http://localhost:15419` (or set `BUSABASE_BASE_URL`); the
open-source server needs no auth.

## Sign in / connect

`login` connects the CLI to a Busabase and writes it to `~/.busabase/.env`. Run it
interactively and it asks **where** your Busabase is — every option boils down to the
same saved config, differing only in base URL and how (if at all) it gets a token:

```
Busabase is an approval-first database and knowledge base for AI agents.
Agents propose changes; humans review and merge what becomes trusted data.

How should this CLI connect?
  1. Local/Desktop on this computer — no account, no login
     Use when you run `busabase server` or the Busabase Desktop app locally.
  2. Busabase Cloud — device sign-in (recommended)
     Works locally, over SSH, and in containers; approve from any browser.
  3. Busabase Cloud — paste an API key
     Best for CI, servers, or agents where a browser is not available.
  4. Self-hosted Busabase — device sign-in
     Use your team's Busabase URL when it supports device authorization.
  5. Self-hosted Busabase — paste an API key
     Use your team's Busabase URL with a long-lived key for automation.
```

- **1 (local)** just saves `BUSABASE_BASE_URL` — the open-source `busabase server` needs
  no account. (It checks the server is reachable and actually open first.)
- **2–5** obtain an `sk_…` API key (selected or created during browser consent, or pasted), verify it against
  `/api/v1/auth`, pick your space, and save everything.

Flags skip the menu (for scripts / CI):

```bash
busabase-cli login                                   # pick from the menu
busabase-cli login --device-code                     # Cloud/remote device sign-in
busabase-cli login --oauth                           # legacy same-machine loopback OAuth
busabase-cli login --api-key sk_…                    # Cloud API key (headless/CI)
busabase-cli login --base-url http://localhost:15419 # connect to a local server (no auth)
busabase-cli login --refresh                         # slide the current OAuth session forward
busabase-cli logout                                  # revoke the session + clear saved creds
```

Device authorization uses a short-lived, opaque login session only for the hand-off. In the
browser you select an existing API key or create a new one; the waiting CLI exchanges the
temporary session for that key, immediately discards the session, and saves only the `sk_…`
credential. The key secret is never rendered in the browser or printed by device login.

`--refresh` applies only to legacy OAuth sessions. API keys are not refreshable; if a key expires
or is revoked, run `busabase-cli login` again and select or create another key. Credentials are
saved with restricted file permissions.

## Output modes

The default output is `text`, designed for terminals. Tree-like responses such as
`nodes list` render as an indented tree, and nested objects are summarized so rows
do not turn into unreadable JSON blobs.

Use `--output json` for agents, scripts, and piping into tools such as `jq`. Use
`--output table` when you want the older aligned-column view for flat lists.

## Examples

```bash
busabase-cli whoami                       # active space / user / membership
busabase-cli bases list
busabase-cli nodes list                   # terminal-friendly tree by default
busabase-cli nodes list --output json      # raw tree for scripts / agents
busabase-cli bases get --slug tasks
busabase-cli nodes create-change-request --type folder --slug crm --name "CRM"
busabase-cli nodes create-change-request --type base --slug contacts --name "Contacts" --parent-node-id nod_123 --field name:Name:text
busabase-cli nodes create-change-request --type base --slug products --name "Products" --fields-json @fields.json
busabase-cli bases create --slug products --name "Products" --fields-json @fields.json
busabase-cli bases create-field --base-id bse_123 --slug cover_image --name "Cover image" --field-type attachment --max-files 1 --allowed-mime image/png --allowed-mime image/svg+xml
busabase-cli bases update-field-change-request --base-id bse_123 --field-id bsf_123 --max-files 1 --allowed-mime image/png
busabase-cli bases create-change-request --base-id bse_123 --fields-json '{"title":"Hello"}'
busabase-cli bases create-change-request --base-id bse_123 --fields-json @record.json
busabase-cli records list --base-id bse_123 --limit 20 --output json
busabase-cli records by-field-text --field-slug status --value-text open
busabase-cli assets upload --file ./cover.png --context record-field --output json
busabase-cli change-requests list
busabase-cli change-requests review --change-request-id cr_123 --verdict approved --reason "LGTM"
busabase-cli change-requests review --change-request-id cr_124 --verdict rejected --reason "Needs revision" # request changes
busabase-cli change-requests close --change-request-id cr_125 --reason "Wrong proposal"                  # terminal close
busabase-cli change-requests merge --change-request-id cr_123
busabase-cli search --query invoice
busabase-cli backup -o ./space.bbdump              # full-fidelity backup of the active space
busabase-cli restore ./space.bbdump                # restore an archive into an EMPTY space
busabase-cli api --method get --path /nodes        # raw OpenAPI passthrough
```

Run `busabase-cli --help` for the full command list.

## Programmatic use

```ts
import { createBusabaseClient } from "busabase-cli";

const client = createBusabaseClient({ baseUrl: "http://localhost:15419", output: "json" });
const bases = await client.bases.list();
```
