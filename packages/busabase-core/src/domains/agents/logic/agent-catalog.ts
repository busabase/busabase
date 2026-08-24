import { spawnSync } from "node:child_process";
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
  /** Listed for discovery, but intentionally blocked until the integration ships. */
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
    comingSoon: true,
  },
  {
    slug: "codex-acp",
    name: "Codex CLI",
    description: "OpenAI's Codex CLI, wrapped for ACP. Runs on this machine.",
    transport: "local-subprocess",
    npxPackage: "@agentclientprotocol/codex-acp@1.1.14",
    probeBinary: "npx",
    comingSoon: true,
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

function localBudaConfig(): { token?: string; agentId?: string } {
  return { token: process.env.BUDA_API_KEY, agentId: process.env.BUDA_AGENT_ID };
}

/** `npx --version` rather than `which`, so this works the same on Windows. */
function binaryAvailable(bin: string): boolean {
  try {
    const res = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5000, shell: true });
    return res.status === 0;
  } catch {
    return false;
  }
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
  const budaConnections = await listBudaConnections();

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
  const localConfig = localBudaConfig();
  if (!connection && (!localConfig.token || !localConfig.agentId)) {
    throw new Error(
      isCloudHost()
        ? `${spec.name} is not connected. Sign in to Buda first.`
        : `${spec.name} is not configured. Set BUDA_API_KEY and BUDA_AGENT_ID, then try again.`,
    );
  }
  const agentId = connection?.agentId ?? (localConfig.agentId as string);
  return {
    slug: connection?.slug ?? spec.slug,
    name: connection?.agentName ?? spec.name,
    transport: spec.transport,
    url: getBudaAcpUrl(agentId),
    authHeader: `Bearer ${connection?.accessToken ?? localConfig.token}`,
  };
}
