import { spawnSync } from "node:child_process";
import type { AgentCatalogEntryVO, AgentTransport } from "busabase-contract/domains/agents/types";
import { getContextActorId } from "../../../context";

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
 *
 * See `apps/busabase-cloud/content/spec/agent-integrations.md` §8.0.
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
}

/**
 * Pinned mirror of the official ACP registry entries we support, plus Buda.
 *
 * The versions match `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
 * as of 2026-08-12. Syncing this table from that endpoint at runtime is planned
 * (spec §6.5b) but deliberately not done yet: a network fetch that decides what
 * we are willing to execute is a bigger trust decision than a checked-in table,
 * and it should land together with signature/pinning rules rather than before.
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
  /** remote-websocket only. */
  url?: string;
  authHeader?: string;
}

const findSpec = (slug: string): CatalogSpec | undefined => CATALOG.find((e) => e.slug === slug);

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

/** `npx --version` rather than `which`, so this works the same on Windows. */
function binaryAvailable(bin: string): boolean {
  try {
    const res = spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 5000, shell: true });
    return res.status === 0;
  } catch {
    return false;
  }
}

/** Buda's endpoint is configured by env, exactly like every other outbound credential. */
function budaConfig(): { url?: string; token?: string; agentId?: string } {
  return {
    url: process.env.BUDA_ACP_URL || "wss://buda.im/api/acp",
    token: process.env.BUDA_API_KEY,
    agentId: process.env.BUDA_AGENT_ID,
  };
}

export function listCatalog(): AgentCatalogEntryVO[] {
  const cloudHost = isCloudHost();
  return CATALOG.map((spec) => {
    let available = false;
    let unavailableReason: string | null = null;

    if (spec.transport === "local-subprocess") {
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
      const { token, agentId } = budaConfig();
      if (token && agentId) {
        available = true;
      } else {
        const missing = [!token && "BUDA_API_KEY", !agentId && "BUDA_AGENT_ID"].filter(Boolean);
        unavailableReason = `Set ${missing.join(" and ")} to connect to ${spec.name}.`;
      }
    }

    return {
      slug: spec.slug,
      name: spec.name,
      description: spec.description,
      transport: spec.transport,
      version: spec.npxPackage?.split("@").pop() ?? null,
      available,
      unavailableReason,
    };
  });
}

/**
 * Resolve a slug to something launchable. Throws for anything not in the table —
 * this is the choke point the whole allowlist argument above depends on.
 */
export function resolveLaunch(slug: string): ResolvedLaunch {
  const spec = findSpec(slug);
  if (!spec) {
    throw new Error(`Unknown agent "${slug}". Only agents in Busabase's catalog can be launched.`);
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

  const { url, token, agentId } = budaConfig();
  if (!token || !agentId) {
    throw new Error(
      `${spec.name} is not configured. Set BUDA_API_KEY and BUDA_AGENT_ID, then try again.`,
    );
  }
  const full = `${url}${url?.includes("?") ? "&" : "?"}agentId=${encodeURIComponent(agentId)}`;
  return {
    slug: spec.slug,
    name: spec.name,
    transport: spec.transport,
    url: full,
    authHeader: `Bearer ${token}`,
  };
}
