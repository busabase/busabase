import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { AgentCatalogEntryVO, AgentTransport } from "busabase-contract/domains/agents/types";
import { getContextActorId } from "../../../context";
import { getBudaAcpUrl, getBudaConnection, listBudaConnections } from "./buda-connection";

/**
 * What Busabase is willing to launch, and how.
 *
 * ## Why this is a fixed allowlist and not a user-supplied command
 *
 * OSS's `/api/rpc` has no authentication (deliberate — the Local↔Cloud Tunnel
 * treats the tunnel itself as the trust boundary) and serves
 * `Access-Control-Allow-Origin: *`. If this domain accepted a `command`/`args`
 * from its caller, any web page a user happens to visit could POST to
 * `http://localhost:<port>/api/rpc` and execute arbitrary programs on their
 * machine. That is a categorical escalation over the existing posture, not a
 * marginal one.
 *
 * So a caller may only name a `slug` from this table. The command line is ours.
 * `assertSameOriginForAgents` (see `logic/agent-origin-guard.ts`) is the second
 * layer; neither is sufficient alone.
 */
interface CatalogSpec {
  slug: string;
  name: string;
  description: string;
  transport: AgentTransport;
  /** Pinned — never `@latest`. Registry entries pin too, for the same reason. */
  npxPackage?: string;
  args?: string[];
  /** Which binary must exist on PATH for a local agent to be usable at all. */
  probeBinary?: string;
  /**
   * Listed for discovery, but intentionally blocked until the integration ships.
   *
   * **Not the way to say "Cloud can't do this."** This flag is unconditional —
   * it is checked before the host branch in both `listCatalog` and
   * `resolveLaunch`, so setting it also blocks OSS and desktop, where a local
   * agent runs on the user's own machine and is exactly the point. Local
   * agents already have a host gate (`isCloudHost()`); that is what expresses
   * "Cloud only". Reserve this flag for an integration that genuinely does not
   * work anywhere yet.
   */
  comingSoon?: boolean;
}

/**
 * Pinned mirror of the official ACP registry entries we support, plus Buda.
 *
 * This table stays the sole authority on *what gets spawned* — `npxPackage`
 * below is never replaced by anything a network fetch returns. A live
 * response that decides which program executes is a bigger trust decision
 * than a checked-in table, and that decision hasn't been made (spec §8.0
 * already treats "registry-only spawning" as the safer posture *because* the
 * command line is ours, not the network's).
 *
 * What `listCatalog()` below *does* sync live is display metadata only —
 * `description`/`version` shown to the user — fetched directly from the
 * official registry endpoint. This table is *this file's own* fallback: no
 * separate pinned JSON snapshot is needed the way `@acprouter/core`'s
 * `registry-sync.ts` keeps one, because these hardcoded strings already
 * serve exactly that role. If the fetch fails or a slug isn't in the
 * response, these are what's shown — so they still have to be kept
 * reasonably current, they're just no longer the only source.
 *
 * Deliberately **not** a dependency on `@acprouter/core` (which has this
 * same fetch-with-timeout logic already, and was tried first) — `busabase`,
 * `busabase-contract`, and `busabase-core` ship as this repo's own public,
 * self-contained workspace, and `acprouter-core` is not part of it. A
 * `workspace:*` dependency on it would type-check fine here and then break
 * every downstream install the moment it tried to resolve a package that
 * isn't there. Every package on this surface must declare its OWN type deps
 * for the same reason — none of them may rely on hoisting from a dependency
 * outside this workspace. Caught before merge, not after a public build broke.
 */
const CATALOG: CatalogSpec[] = [
  {
    slug: "claude-acp",
    name: "Claude Code",
    description: "Anthropic's Claude, wrapped for ACP. Runs on this machine.",
    transport: "local-subprocess",
    npxPackage: "@agentclientprotocol/claude-agent-acp@0.66.0",
    probeBinary: "npx",
  },
  {
    slug: "codex-acp",
    name: "Codex CLI",
    description: "OpenAI's Codex CLI, wrapped for ACP. Runs on this machine.",
    transport: "local-subprocess",
    npxPackage: "@agentclientprotocol/codex-acp@1.1.14",
    probeBinary: "npx",
  },
  {
    slug: "buda",
    name: "Buda AI Agent",
    description: "A hosted Buda agent. Runs in Buda's cloud — nothing is installed locally.",
    transport: "remote-websocket",
  },
];

export interface ResolvedLaunch {
  slug: string;
  name: string;
  transport: AgentTransport;
  /** local-subprocess only. */
  command?: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  direct?: boolean;
  /** remote-websocket only. */
  url?: string;
  authHeader?: string;
}

const findSpec = (slug: string): CatalogSpec | undefined =>
  CATALOG.find((entry) => entry.slug === slug) ??
  (slug.startsWith("buda:") ? CATALOG.find((entry) => entry.slug === "buda") : undefined);

/**
 * Local-subprocess spawning is only safe on the single-user OSS/desktop host,
 * where the spawned process runs on the *user's own* machine under their own
 * OS permissions. Busabase Cloud is a shared, multi-tenant Next.js process —
 * spawning there would mean one tenant's request runs an arbitrary CLI on
 * infrastructure shared by every other tenant. See spec §8 point 4.
 *
 * `getContextActorId()` is the existing mode detector for this (already used
 * by node-ACL write paths, see its doc comment in `context.ts`): Cloud's real
 * `withBusabaseContext` always sets `actorId` from the authenticated actor;
 * OSS's `runWithLocalContext` never does. A tunnel-forwarded request from
 * Cloud reaches this code running *inside the OSS process on the user's own
 * machine* (Local↔Cloud Tunnel, Block 3) — never inside Cloud's own actorId
 * context — so it correctly reads as "allowed" there too.
 */
function isCloudHost(): boolean {
  return getContextActorId() !== undefined;
}

const CLOUD_LOCAL_AGENT_REASON =
  "Local agents run on your own machine, not on Busabase Cloud. Install the Busabase desktop app, or connect your machine via Local↔Cloud Tunnel, to use this agent.";

/**
 * The env-fallback path for Buda: `BUDA_API_KEY` + `BUDA_AGENT_ID` let OSS/desktop
 * (and a tunnel-forwarded Cloud request, which runs this same code on the user's
 * own machine — see `isCloudHost()`) reach a Buda agent with no vault row at all,
 * e.g. a fixture-configured agent in a dedicated ACP E2E run.
 *
 * Exported so other agent-domain logic (`agent-connection-list.ts`) can recognize
 * this same agent as connected without re-reading `process.env` itself — never
 * log or forward `token` verbatim; it is a bearer credential.
 */
export function localBudaConfig(): { token?: string; agentId?: string } {
  return { token: process.env.BUDA_API_KEY, agentId: process.env.BUDA_AGENT_ID };
}

/** `npx --version` rather than `which`, so this works the same on Windows. */
function binaryAvailable(bin: string, env?: NodeJS.ProcessEnv): boolean {
  try {
    const res = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5000, shell: true, env });
    return res.status === 0;
  } catch {
    return false;
  }
}

const CODEX_PACKAGE = "@agentclientprotocol/codex-acp";
const CODEX_VERSION = "1.1.14";
const CODEX_INTEGRITY =
  "sha512-6JKLbGYH0/Gcz788U6KnljwSdNvUnXOyjJDOgsWsbwmXbxn/BXH+urF5AciACdgq13+KgAP9O96Kp6h33BgyKg==";
const CLAUDE_PACKAGE = "@agentclientprotocol/claude-agent-acp";
const CLAUDE_VERSION = "0.66.0";
const CLAUDE_INTEGRITY =
  "sha512-BwalxKsxZzHZGEs+X9hV3biErLE7PHWoao2hmyP3QBWXxvMHbc1F1tzDE95ZA47Fle+KBYf2gKpgy1MJ+ZmVlw==";

function claudeNativeBinary(home: string): string | null {
  if (process.platform !== "darwin" && process.platform !== "win32" && process.platform !== "linux")
    return null;
  if (process.arch !== "arm64" && process.arch !== "x64") return null;
  const base = join(home, "node_modules", "@anthropic-ai");
  const suffix = process.platform === "win32" ? ".exe" : "";
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const linuxMusl = process.platform === "linux" && !report?.header?.glibcVersionRuntime;
  const names =
    process.platform === "linux"
      ? linuxMusl
        ? [`claude-agent-sdk-linux-${process.arch}-musl`, `claude-agent-sdk-linux-${process.arch}`]
        : [`claude-agent-sdk-linux-${process.arch}`, `claude-agent-sdk-linux-${process.arch}-musl`]
      : [`claude-agent-sdk-${process.platform}-${process.arch}`];
  return names.map((name) => join(base, name, `claude${suffix}`)).find(existsSync) ?? null;
}

function managedClaudeLaunch(): Pick<ResolvedLaunch, "command" | "args" | "env" | "direct"> | null {
  if (process.env.APP_ENV !== "DESKTOP") return null;
  const node = process.env.BUSABASE_DESKTOP_CLAUDE_NODE;
  const home = process.env.BUSABASE_DESKTOP_CLAUDE_HOME;
  if (!node || !home || !existsSync(node)) return null;
  const native = claudeNativeBinary(home);
  if (!native) return null;
  const adapter = join(home, "node_modules", "@agentclientprotocol", "claude-agent-acp");
  try {
    const lock = JSON.parse(readFileSync(join(home, "package-lock.json"), "utf8"));
    const locked = Object.entries(lock.packages ?? {}).find(
      ([key]) =>
        key === `node_modules/${CLAUDE_PACKAGE}` || key.endsWith(`/node_modules/${CLAUDE_PACKAGE}`),
    )?.[1] as { version?: string; integrity?: string; resolved?: string } | undefined;
    const nativePackage = `@anthropic-ai/${native.split(/[\\/]/).at(-2) ?? ""}`;
    const nativeLock = Object.entries(lock.packages ?? {}).find(
      ([key]) =>
        key === `node_modules/${nativePackage}` || key.endsWith(`/node_modules/${nativePackage}`),
    )?.[1] as { version?: string; integrity?: string; resolved?: string } | undefined;
    const sdkLock = Object.entries(lock.packages ?? {}).find(
      ([key]) =>
        key === "node_modules/@anthropic-ai/claude-agent-sdk" ||
        key.endsWith("/node_modules/@anthropic-ai/claude-agent-sdk"),
    )?.[1] as { version?: string; integrity?: string; resolved?: string } | undefined;
    if (
      locked?.version !== CLAUDE_VERSION ||
      locked?.integrity !== CLAUDE_INTEGRITY ||
      locked?.resolved !==
        "https://registry.npmjs.org/@agentclientprotocol/claude-agent-acp/-/claude-agent-acp-0.66.0.tgz"
    )
      return null;
    if (
      sdkLock?.version !== "0.3.220" ||
      !sdkLock.integrity?.startsWith("sha512-") ||
      sdkLock.resolved !==
        "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.220.tgz" ||
      nativeLock?.version !== "0.3.220" ||
      !nativeLock.integrity?.startsWith("sha512-") ||
      nativeLock.resolved !==
        `https://registry.npmjs.org/${nativePackage}/-/${nativePackage.split("/")[1]}-0.3.220.tgz`
    )
      return null;
    const stamp = JSON.parse(readFileSync(join(home, "verified-install.json"), "utf8"));
    if (
      stamp.package !== CLAUDE_PACKAGE ||
      stamp.version !== CLAUDE_VERSION ||
      stamp.integrity !== CLAUDE_INTEGRITY
    )
      return null;
    const manifest = JSON.parse(readFileSync(join(adapter, "package.json"), "utf8"));
    if (
      manifest.name !== CLAUDE_PACKAGE ||
      manifest.version !== CLAUDE_VERSION ||
      manifest.bin?.["claude-agent-acp"] !== "dist/index.js"
    )
      return null;
    const entry = join(adapter, "dist/index.js");
    if (
      createHash("sha256").update(readFileSync(entry)).digest("hex") !== stamp.entrySha256 ||
      createHash("sha256").update(readFileSync(native)).digest("hex") !== stamp.nativeSha256
    )
      return null;
    return {
      command: node,
      args: [entry],
      env: { ...process.env, PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ""}` },
      direct: true,
    };
  } catch {
    return null;
  }
}

function managedCodexLaunch(
  codexCli = process.env.BUSABASE_DESKTOP_CODEX_CLI?.trim() || "codex",
): Pick<ResolvedLaunch, "command" | "args" | "env" | "direct"> | null {
  if (process.env.APP_ENV !== "DESKTOP") return null;
  const node = process.env.BUSABASE_DESKTOP_CODEX_NODE;
  const home = process.env.BUSABASE_DESKTOP_CODEX_HOME;
  if (!node || !home || !existsSync(node)) return null;
  const adapter = join(home, "node_modules", "@agentclientprotocol", "codex-acp");
  try {
    const lock = JSON.parse(readFileSync(join(home, "package-lock.json"), "utf8"));
    const locked = Object.entries(lock.packages ?? {}).find(
      ([key]) =>
        key === "node_modules/@agentclientprotocol/codex-acp" ||
        key.endsWith("/node_modules/@agentclientprotocol/codex-acp"),
    )?.[1] as { version?: string; integrity?: string; resolved?: string } | undefined;
    if (
      locked?.version !== CODEX_VERSION ||
      locked?.integrity !== CODEX_INTEGRITY ||
      locked?.resolved !==
        "https://registry.npmjs.org/@agentclientprotocol/codex-acp/-/codex-acp-1.1.14.tgz"
    )
      return null;
    const stamp = JSON.parse(readFileSync(join(home, "verified-install.json"), "utf8"));
    if (
      stamp.package !== CODEX_PACKAGE ||
      stamp.version !== CODEX_VERSION ||
      stamp.integrity !== CODEX_INTEGRITY
    )
      return null;
    const manifest = JSON.parse(readFileSync(join(adapter, "package.json"), "utf8"));
    const entry = manifest.bin?.["codex-acp"];
    if (
      manifest.name !== CODEX_PACKAGE ||
      manifest.version !== CODEX_VERSION ||
      entry !== "dist/index.js"
    )
      return null;
    const script = join(adapter, entry);
    if (!existsSync(script)) return null;
    if (createHash("sha256").update(readFileSync(script)).digest("hex") !== stamp.entrySha256)
      return null;
    return {
      command: node,
      args: [script],
      env: {
        ...process.env,
        CODEX_PATH: codexCli,
        PATH: `${dirname(node)}${delimiter}${process.env.PATH ?? ""}`,
      },
      direct: true,
    };
  } catch {
    return null;
  }
}

function desktopSystemPath(): string | null {
  const path =
    process.env.BUSABASE_DESKTOP_CODEX_SYSTEM_PATH?.trim() || process.env.PATH?.trim() || "";
  return path &&
    binaryAvailable("node", { ...process.env, PATH: path }) &&
    binaryAvailable("npx", { ...process.env, PATH: path })
    ? path
    : null;
}

const OFFICIAL_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";
const REGISTRY_FETCH_TIMEOUT_MS = 3000;

interface OfficialRegistryEntry {
  id: string;
  description: string;
  version: string;
}

/**
 * Live-fetches the official ACP registry for display metadata only —
 * never throws, and never blocks `listCatalog` for longer than the timeout.
 * Any failure (network down, CDN outage, malformed response, timeout)
 * degrades to an empty map, and `listCatalog`'s own hardcoded `CATALOG`
 * strings are what gets shown — the same fallback shape
 * `@acprouter/core`'s `registry-sync.ts` uses, reimplemented here in ~15
 * lines specifically so this file needs no dependency on that package (see
 * the doc comment on `CATALOG` above for why that matters for busabase).
 */
async function fetchRegistryDisplayInfo(): Promise<
  Map<string, { description: string; version: string }>
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(OFFICIAL_REGISTRY_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`registry responded ${response.status}`);
    const data = (await response.json()) as { agents?: OfficialRegistryEntry[] };
    if (!Array.isArray(data.agents)) throw new Error("malformed registry response");
    return new Map(
      data.agents.map((a) => [a.id, { description: a.description, version: a.version }]),
    );
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

export async function listCatalog(): Promise<AgentCatalogEntryVO[]> {
  const cloudHost = isCloudHost();
  const registryInfo = await fetchRegistryDisplayInfo();
  const budaConnections = await listBudaConnections("space");

  return CATALOG.map((spec) => {
    let available = false;
    let unavailableReason: string | null = null;

    if (spec.comingSoon) {
      unavailableReason = "Coming soon.";
    } else if (spec.transport === "local-subprocess") {
      if (cloudHost) {
        // Don't even probe the binary on Cloud's own server — that would be
        // checking whether *Cloud's* PATH has npx, which is irrelevant to
        // whether the user's own machine can run this agent.
        unavailableReason = CLOUD_LOCAL_AGENT_REASON;
      } else if (
        process.env.APP_ENV === "DESKTOP" &&
        (spec.slug === "codex-acp" || spec.slug === "claude-acp")
      ) {
        available =
          desktopSystemPath() !== null ||
          (spec.slug === "codex-acp" ? managedCodexLaunch() : managedClaudeLaunch()) !== null;
        if (!available)
          unavailableReason = `Install ${spec.name} ACP from Busabase Desktop to connect.`;
      } else if (binaryAvailable(spec.probeBinary ?? "npx")) {
        available = true;
      } else {
        unavailableReason = `\`${spec.probeBinary ?? "npx"}\` was not found on this machine. Install Node.js to use ${spec.name}.`;
      }
    } else {
      const localConfig = localBudaConfig();
      if (budaConnections.length > 0 || (!cloudHost && localConfig.token && localConfig.agentId)) {
        available = true;
      } else if (!cloudHost) {
        unavailableReason = "Set BUDA_API_KEY and BUDA_AGENT_ID to connect to Buda.";
      } else {
        unavailableReason = "Sign in to Buda and choose an agent to connect.";
      }
    }

    // Registry-sourced display info only, never the spawn command — see the
    // doc comment on CATALOG above. `buda` is never in the official registry
    // (spec: no URL-based distribution exists for it), so it always falls
    // through to its own hardcoded description below.
    const synced = registryInfo.get(spec.slug);

    return {
      slug: spec.slug,
      name: spec.name,
      description: synced?.description || spec.description,
      transport: spec.transport,
      version: synced?.version ?? spec.npxPackage?.split("@").pop() ?? null,
      available,
      comingSoon: spec.comingSoon ?? false,
      unavailableReason,
      connectionRequired: spec.slug === "buda" && cloudHost,
      connectedAgentName: spec.slug === "buda" ? (budaConnections[0]?.agentName ?? null) : null,
      connectedAgents:
        spec.slug === "buda"
          ? budaConnections.map((connection) => ({
              slug: connection.slug,
              name: connection.agentName,
            }))
          : [],
    };
  });
}

/**
 * Resolve a slug to something launchable. Throws for anything not in the table —
 * this is the choke point the whole allowlist argument above depends on.
 */
export async function resolveLaunch(slug: string): Promise<ResolvedLaunch> {
  const spec = findSpec(slug);
  if (!spec) {
    throw new Error(`Unknown agent "${slug}". Only agents in Busabase's catalog can be launched.`);
  }
  if (spec.comingSoon) {
    throw new Error(`${spec.name} is coming soon.`);
  }

  if (spec.transport === "local-subprocess") {
    // The real gate — enforced here, not just hinted at in listCatalog(),
    // because a client must never be able to force a spawn by calling
    // sessions.create directly with a slug the catalog already marked
    // unavailable (a stale client cache, or a caller that skips the UI
    // entirely). See isCloudHost()'s doc comment.
    if (isCloudHost()) {
      throw new Error(CLOUD_LOCAL_AGENT_REASON);
    }
    if (spec.slug === "claude-acp" && process.env.APP_ENV === "DESKTOP") {
      const systemPath = desktopSystemPath();
      if (!systemPath) {
        const managed = managedClaudeLaunch();
        if (!managed)
          throw new Error("Install Claude Code ACP from Busabase Desktop before connecting.");
        return { slug: spec.slug, name: spec.name, transport: spec.transport, ...managed };
      }
      return {
        slug: spec.slug,
        name: spec.name,
        transport: spec.transport,
        command: "npx",
        args: ["--yes", spec.npxPackage as string],
        env: { ...process.env, PATH: systemPath },
      };
    }
    if (spec.slug === "codex-acp" && process.env.APP_ENV === "DESKTOP") {
      const codexCli = process.env.BUSABASE_DESKTOP_CODEX_CLI?.trim() || "codex";
      const systemPath = desktopSystemPath();
      const cliPath = systemPath ?? process.env.PATH ?? "";
      if (!binaryAvailable(codexCli, { ...process.env, PATH: cliPath })) {
        throw new Error("Codex CLI is missing. Install Codex CLI and sign in before connecting.");
      }
      try {
        if (
          spawnSync(codexCli, ["login", "status"], {
            stdio: "ignore",
            timeout: 5000,
            shell: process.platform === "win32",
            env: { ...process.env, PATH: cliPath },
          }).status !== 0
        ) {
          throw new Error("Codex CLI login is required. Run `codex login` before connecting.");
        }
      } catch {
        throw new Error("Codex CLI login is required. Run `codex login` before connecting.");
      }
      if (!systemPath) {
        const managed = managedCodexLaunch(codexCli);
        if (!managed) throw new Error("Install Codex ACP from Busabase Desktop before connecting.");
        return { slug: spec.slug, name: spec.name, transport: spec.transport, ...managed };
      }
      return {
        slug: spec.slug,
        name: spec.name,
        transport: spec.transport,
        command: "npx",
        args: ["--yes", spec.npxPackage as string],
        env: { ...process.env, PATH: systemPath },
      };
    }
    return {
      slug: spec.slug,
      name: spec.name,
      transport: spec.transport,
      command: "npx",
      // `--yes` so a first run does not hang forever on npx's install prompt with
      // nobody attached to answer it.
      args: ["--yes", spec.npxPackage as string, ...(spec.args ?? [])],
    };
  }

  const connection = await getBudaConnection(slug);
  // Env config is a *local* fallback only (see localBudaConfig's doc comment) —
  // a Cloud actor must never resolve through it just because the shared server
  // process happens to have BUDA_API_KEY/BUDA_AGENT_ID set. Same gate as
  // isCloudHost() everywhere else in this file.
  const localConfig = isCloudHost() ? {} : localBudaConfig();
  if (!connection && (!localConfig.token || !localConfig.agentId)) {
    throw new Error(
      isCloudHost()
        ? `${spec.name} is not connected. Sign in to Buda first.`
        : `${spec.name} is not configured. Set BUDA_API_KEY and BUDA_AGENT_ID, then try again.`,
    );
  }
  const agentId = connection?.agentId ?? (localConfig.agentId as string);
  return {
    // Keep the local environment fallback on its existing catalog identity so
    // retained sessions and /agents/buda routes continue to resolve.
    slug: connection?.slug ?? spec.slug,
    name: connection?.agentName ?? spec.name,
    transport: spec.transport,
    url: getBudaAcpUrl(agentId),
    authHeader: `Bearer ${connection?.accessToken ?? localConfig.token}`,
  };
}
