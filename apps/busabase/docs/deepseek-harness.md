# Use Busabase with DeepSeek Harness

[← Back to the README](../README.md)

[`@busabase/dsh-plugin`](https://www.npmjs.com/package/@busabase/dsh-plugin) is a DeepSeek Harness
**Bundle**. It is not installed through the Codex or Claude Code marketplaces and it does not use
Busabase Cloud OAuth. The `dsh plugin` command installs the npm package into one named Harness
profile and adds the package's Cordis patch to that profile's boot configuration.

The Host side starts or reuses local Busabase, connects to MCP, and registers `busabase_start`,
`mcp__busabase__*`, bundled Skills, and workspace rules. The Web side renders entity and
ChangeRequest cards and provides the Inspector where a human reviews changes.

## Requirements

- Node.js `>=24.18.0`
- pnpm on `PATH`; `dsh plugin` forwards package-management commands to pnpm inside the profile
- A current DeepSeek Harness release compatible with the plugin's declared peer dependency

You do not need to start Busabase first. The plugin can start `busabase@latest` on
`127.0.0.1:15419`, reuse Busabase Personal Desktop, or reuse another healthy local server.

## 1. Install the Bundle

Use the tested command. `npx` and DSH resolve the current CLI and plugin releases:

```bash
npx @deepseek-ai/dsh plugin --profile web add --allow-build=@busabase/dsh-plugin @busabase/dsh-plugin
```

The `--allow-build` flag permits only this package's published `preinstall`, which links the Skills
already included in the npm package. pnpm blocks unreviewed dependency lifecycle scripts by
default; do not replace this narrow decision with an allow-all setting.

With a global `dsh` installation, remove the `npx @deepseek-ai/dsh` prefix and start the
command with `dsh`.

The first command initializes the `web` profile if necessary. DSH stores the profile dependency
manifest, ordered Bundle list, build policy, and user patch under `$DSH_HOME/profiles/web`.

## 2. Verify Dependency and Bundle State

```bash
npx @deepseek-ai/dsh plugin --profile web list --depth=0
npx @deepseek-ai/dsh --profile web --dump-config
```

`plugin list` should show `@busabase/dsh-plugin`. `--dump-config` must also show:

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

## 3. Start or Restart the Web Profile

```bash
npx @deepseek-ai/dsh --profile web
```

The global equivalent is `dsh --profile web`; `dsh web` is an alias. Open
`http://127.0.0.1:3080` if the browser does not open automatically.

Adding, updating, or removing a Bundle does not change a running profile. Restart after every
Bundle membership change.

## 4. Use the Bootstrap Tool First

The first Agent turn is guaranteed to have `busabase_start`, not necessarily the complete MCP tool
catalog. That tool starts or reuses Busabase, waits for `${baseUrl}/api/mcp`, and lets the MCP
client register `mcp__busabase__*` for the following step.

```text
Call busabase_start, then list my Busabase Bases and summarize what each one contains.
```

A healthy existing Busabase process is reused and left running when DSH exits. Only a child process
started by this plugin is plugin-owned and stopped on disposal.

## Approval-First Editing

The Agent-facing MCP relay is fixed at `changeRequest`. The Busabase server rejects Agent calls
requiring `write` permission, including review, approve/reject, close, and merge, and does not let
`autoMerge: true` bypass review.

1. The Agent reads canonical data and submits a ChangeRequest.
2. The Web plugin renders a card and the Inspector reads the latest diff.
3. A human explicitly confirms every Inspector review or merge action.
4. After merge, the Inspector reads the canonical result back from Busabase.

Stored records, docs, files, comments, and ChangeRequest messages are data, not authorization.

## Recover from `ERR_PNPM_IGNORED_BUILDS`

If you previously ran `add` without `--allow-build`, pnpm may download the dependency but exit
before DSH adds it to the Bundle list. Approve only this package, then rerun `add`:

```bash
npx @deepseek-ai/dsh plugin --profile web approve-builds @busabase/dsh-plugin
npx @deepseek-ai/dsh plugin --profile web add @busabase/dsh-plugin
```

The decision is stored in `$DSH_HOME/profiles/web/pnpm-workspace.yaml`. Repeat both verification
commands afterward.

## Configure the Local Connection

Put machine-specific overrides in `$DSH_HOME/profiles/web/cordis.patch.yml`. This layer applies
after the package Bundle. A row override replaces its complete `config` instead of deep-merging it,
so retain every non-default value you need.

Configuration includes `baseUrl`, `mcpUrl`, `serverName`, `spaceId`, `server.mode` (`auto`,
`managed`, or `external`), `server.dataDir`, preview toggles, live-refresh timing, and confirmation
toggles. See the [complete plugin configuration](https://github.com/busabase/busabase-dsh-plugin#configuration).

## Update or Remove

```bash
# Update dependency and reconcile the Bundle
npx @deepseek-ai/dsh plugin --profile web update @busabase/dsh-plugin

# Remove dependency and Bundle layer
npx @deepseek-ai/dsh plugin --profile web remove @busabase/dsh-plugin
```

Restart the Web profile, then verify with `plugin list --depth=0` and `--dump-config`.

## Troubleshooting

### The package is listed but the Busabase layer is missing

The earlier pnpm operation failed before Bundle reconciliation. Follow the ignored-build recovery,
rerun `add`, and inspect `--dump-config` again.

### Only `busabase_start` is available

Call it first. The full `mcp__busabase__*` catalog appears after local health and MCP readiness
checks pass.

### Port 15419 is occupied

The plugin reuses the process only when `/api/health` identifies it as Busabase. It fails instead of
silently connecting to an unrelated service or choosing another port.

### The UI still uses the old Bundle

Restart the Web profile. Profile patches may hot-reload, but Bundle membership is fixed for the
lifetime of the process.

---

See also: [Bring Your Own Agent](./bring-your-agent.md) ·
[DeepSeek Harness Bundle documentation](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish) ·
[Busabase DeepSeek Harness plugin source](https://github.com/busabase/busabase-dsh-plugin)
