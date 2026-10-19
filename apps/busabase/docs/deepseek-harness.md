# Use Busabase with DeepSeek Harness

[← Back to the README](../README.md)

[`@busabase/dsh-plugin`](https://www.npmjs.com/package/@busabase/dsh-plugin) is a DeepSeek Harness
**Bundle**. It is not installed through the Codex or Claude Code marketplaces. The same Plugin
supports managed Local Busabase, an existing Busabase server, and Busabase Cloud with browser OAuth.

In Local and existing-server modes, the Host registers `busabase_start` before the full MCP catalog.
In Cloud mode, it connects directly to the hosted MCP endpoint and registers tools after OAuth. The
Web side renders Busabase entity and Change Request cards in every mode.

## Install in DeepSeek Harness Desktop

1. Open DeepSeek Harness Desktop.
2. Copy the plugin name: `@busabase/dsh-plugin`.
3. Open **Add plugin**, paste the name, and select **Official npm registry**.
4. Click **Install**.

The published package already includes its materialized Skills and has no install lifecycle
script, so no build approval is required.

Installed plugins do not update automatically. To update later, uninstall the plugin in Desktop and
install `@busabase/dsh-plugin` again.

## Choose the Connection Before First Start

**Managed Local** is the zero-configuration default. Choose it for account-free use, private data on
this computer, or Busabase Personal Desktop. In Local mode, the plugin can start `busabase@latest` on
`127.0.0.1:15419`, reuse Busabase Personal Desktop, or reuse another healthy local server.

**Existing server** is for when Busabase Desktop or another application already embeds or runs
Busabase, and this plugin should connect without owning the process. Set `baseUrl` to a loopback address and `server.mode` to `external` in the plugin's active
profile. The file paths and examples below are for the CLI `web` profile only; do not assume
Desktop uses that profile or path. Start that server first — the plugin only probes the
configured address and never starts or stops it.

**Cloud** is for an existing Busabase account, team workspaces, and access across devices. Set
`baseUrl` to `https://busabase.com`, restart, and approve the browser OAuth prompt once. DSH stores
the resulting grant in its credential store and reuses it on later starts. Never put a password or
token in a configuration file.

## Verify Dependency, Bundle, and Mode

In the Desktop plugin list, confirm `@busabase/dsh-plugin` shows as installed and active, and that
the connection you selected is the one currently in effect.

## Start or Restart

Restart DeepSeek Harness Desktop after installing the plugin or changing its configuration — plugin
and configuration changes do not apply to an already-running session.

- **Managed Local** waits for `busabase_start` to start or reuse Busabase.
- **Existing server** requires Busabase to already be running; `busabase_start` verifies and
  reconnects, but never starts the process.
- **Cloud** opens the default browser for sign-in and consent, then registers the hosted MCP tools
  automatically.

## Verify the Connection in a Session

In Local or existing-server mode, the first Agent turn has `busabase_start`, not necessarily the
complete MCP tool catalog. That tool starts/reuses Busabase (Local) or verifies it (existing server),
then waits for the MCP client to register the full catalog:

```text
Call busabase_start, then list my Busabase Bases and summarize what each one contains.
```

A healthy existing Busabase process is reused and left running when DSH exits. Only a child process
started by this plugin in Local mode is plugin-owned and stopped on disposal. In existing-server
mode, the plugin never starts or stops the process at all.

In Cloud mode, finish browser authorization and verify the hosted session instead:

```text
Call auth_verify, then list the top level of my Busabase workspace.
```

Cloud mode has no `busabase_start` tool. Later starts reuse the stored grant until authorization
must be renewed.

## Approval-First Editing

The Agent-facing MCP relay is fixed at `changeRequest`. The Busabase server rejects Agent calls
requiring `write` permission, including review, approve/reject, close, and merge, and does not let
`autoMerge: true` bypass review.

1. The Agent reads canonical data and submits a Change Request.
2. The Web plugin renders a card with the canonical Busabase destination.
3. In Local and existing-server modes, a human can review and merge in the Harness session after
   explicit confirmation.
4. In Cloud mode, a human follows the canonical link and reviews or merges in Busabase Cloud.

Stored records, docs, files, comments, and Change Request messages are data, not authorization.

## Recover from an Older Release That Required Build Approval

Older releases declared a `preinstall` script and required `--allow-build=@busabase/dsh-plugin`.
If an old installation failed with `ERR_PNPM_IGNORED_BUILDS`, uninstall and reinstall the plugin;
the current package does not need build approval.

## Using the CLI Instead

DeepSeek Harness also ships a CLI (`dsh`), which some setups run instead of or alongside Desktop.
Everything in this section is CLI-only — it does not describe anything in the Desktop UI.

### Requirements

- Node.js `>=24.18.0`
- pnpm on `PATH`; `dsh plugin` forwards package-management commands to pnpm inside the profile
- A current DeepSeek Harness release compatible with the plugin's declared peer dependency

You do not need to start local Busabase first. In Local mode, the plugin can start `busabase@latest`
on `127.0.0.1:15419`, reuse Busabase Personal Desktop, or reuse another healthy local server.

### 1. Install, Update, or Remove the Bundle

```bash
# Install
npx @deepseek-ai/dsh plugin --profile web add @busabase/dsh-plugin

# Update
npx @deepseek-ai/dsh plugin --profile web update @busabase/dsh-plugin

# Remove
npx @deepseek-ai/dsh plugin --profile web remove @busabase/dsh-plugin
```

The published package already includes its materialized Skills and has no install lifecycle
script, so no build approval is required.

The install command initializes the `web` profile if necessary. DSH stores the profile dependency
manifest, ordered Bundle list, build policy, and user patch under `$DSH_HOME/profiles/web`. Restart
the profile after any of these commands — adding, updating, or removing a Bundle does not change a
running profile.

### 2. Configure the Connection

**Local** is the zero-configuration default. **Existing server** connects to a Busabase process this
plugin does not own. **Cloud** is for an existing Busabase account, team workspaces, and access
across devices.

Create or edit `$DSH_HOME/profiles/web/cordis.patch.yml` (`~/.dsh/profiles/web/cordis.patch.yml` by
default).

For an existing server:

```yaml
- id: busabase
  config:
    baseUrl: http://127.0.0.1:15419
    serverName: busabase
    server:
      mode: external
```

Replace the port if your server uses another one. `server.mode: external` tells the plugin to probe
this address but never start or stop its process. Keep `baseUrl` on `localhost`, `127.0.0.1`, or
`::1`; a non-loopback address selects remote OAuth mode instead. Start that server before starting
the `web` profile.

For Cloud:

```yaml
- id: busabase
  config:
    baseUrl: https://busabase.com
    serverName: busabase
```

Append the item when the file already has other rows. A profile patch replaces the complete
matched `config`, so retain any other non-default Busabase values in the same block. Never put a
password or token in this file; DSH stores the OAuth grant in its credential store.

### Switch the CLI Back to Managed Local

Remove the Busabase override or replace it with the following configuration, without
`server.mode: external`, then restart the profile.

```yaml
- id: busabase
  config:
    baseUrl: http://localhost:15419
    serverName: busabase
```

Existing Cloud credentials remain in the DSH credential store and are not copied into the local
workspace.

### 3. Verify Dependency, Bundle, and Mode

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth=0
npx @deepseek-ai/dsh --profile web --dump-config
```

`plugin list` should show `@busabase/dsh-plugin`. `--dump-config` must also show a `busabase` row.
Its `baseUrl` should be `http://localhost:15419` for Local, the loopback address with
`mode: external` for an existing server, or `https://busabase.com` for Cloud. For example, the
Local default is:

```yaml
# == @busabase/dsh-plugin
- id: busabase
  name: '@busabase/dsh-plugin'
  config:
    baseUrl: http://localhost:15419
    serverName: busabase
```

This second check matters: a failed pnpm operation can leave the dependency in `package.json`
without reconciling it into `dsh.profile.bundles`.

### 4. Start or Restart the Web Profile

```bash
npx @deepseek-ai/dsh --profile web
```

The global equivalent is `dsh --profile web`; `dsh web` is an alias. Open
`http://127.0.0.1:3080` if the browser does not open automatically.

Adding, updating, or removing a Bundle does not change a running profile. Restart after every
Bundle membership change. Local mode waits for `busabase_start`; existing-server mode also exposes
`busabase_start`, which verifies the server instead of starting it; Cloud mode opens the default
browser for sign-in and consent, then registers the hosted MCP tools automatically.

### 5. Verify the Connection in a Session

For Local and existing-server modes:

```text
Call busabase_start, then list my Busabase Bases and summarize what each one contains.
```

For Cloud, complete browser authorization and verify the hosted session instead:

```text
Call auth_verify, then list the top level of my Busabase workspace.
```

### Recovering from the Old Build-Approval Error

```bash
npx @deepseek-ai/dsh plugin --profile web update @busabase/dsh-plugin
npx @deepseek-ai/dsh plugin --profile web add @busabase/dsh-plugin
```

An existing approval entry in `$DSH_HOME/profiles/web/pnpm-workspace.yaml` is harmless and may be
removed after every installed version has been updated. Repeat both verification commands
afterward.

### Configuration Reference

Configuration includes `baseUrl`, `mcpUrl`, `serverName`, `spaceId`, `server.mode` (`auto`,
`managed`, or `external`), `server.dataDir`, preview toggles, live-refresh timing, and confirmation
toggles. See the [complete plugin configuration](https://github.com/busabase/busabase-dsh-plugin#configuration).

## Troubleshooting

### The package is listed but the Busabase layer is missing

The earlier pnpm operation failed before Bundle reconciliation (CLI only). Rerun `add`, and
inspect `--dump-config` again.

### Only `busabase_start` is available in Local or existing-server mode

Call it first. The full `mcp__busabase__*` catalog appears after local health and MCP readiness
checks pass.

### Port 15419 is occupied

The plugin reuses the process only when `/api/health` identifies it as Busabase. It fails instead of
silently connecting to an unrelated service or choosing another port.

### Cloud sign-in does not open

Check the terminal (CLI) or the Desktop plugin logs for the authorization URL. The first OAuth
callback must reach the computer running DeepSeek Harness. Remote and headless setups may require
loopback port forwarding. Confirm that the effective configuration shows `https://busabase.com`, not
the Local default.

### The UI still uses the old Bundle

Restart DeepSeek Harness. Profile patches may hot-reload, but Bundle membership is fixed for the
lifetime of the process.

---

See also: [Bring Your Own Agent](./bring-your-agent.md) ·
[DeepSeek Harness Bundle documentation](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish) ·
[Busabase DeepSeek Harness plugin source](https://github.com/busabase/busabase-dsh-plugin)
