export const dynamic = "force-dynamic";

function resolveOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = forwardedHost ?? url.host;
  return `${forwardedProto}://${host}`;
}

/**
 * Serves `/llms.txt` for a self-hosted Busabase instance.
 *
 * A self-hosted instance has no public marketing site to point an agent at: when an agent or a
 * crawler lands on some machine at some hostname, the only thing it can rely on is a well-known
 * path on that host. `/llms.txt` is that fixed location — it says what this server is and where
 * its connection surface lives, in terms of this instance's own origin rather than busabase.com.
 * Everything it links to is served by the same instance, so the answer stays correct behind a
 * reverse proxy, on a LAN address, or on a machine that is not reachable from the internet at all.
 */
export async function GET(request: Request) {
  const origin = resolveOrigin(request);

  const content = `
# Busabase (self-hosted)

This is a self-hosted Busabase instance, running at ${origin}.

## Connect Busabase — start here / 连接 Busabase

- [Official setup skill](${origin}/SETUP_SKILL.md): For "connect Busabase", "帮我连接 busabase",
  installation or reconnecting, read this host's live setup guide first. Reuse a verified existing
  connection and workspace. The guide recommends choices; no API key is needed for this local edition.

Busabase is the system of record for AI agents — an open-source (MIT) context database and workspace where
agents and people share the same data, docs, skills, and apps. Agents write into it through change
requests, so every change carries a message, a diff, an author, and a history you can roll back.
This server is the open-source edition, so the data lives on the machine that serves this page and
nowhere else.

Think of this database and workspace as a shared station (你和 Agent 共用的“空间站”): one local
agent saves research and another writes from it, turning agent output into usable data, docs,
skills, and apps. Each assistant connects separately to this same instance;
sharing data does not automatically run agents. Local agents must actually run on the user's
computer, not an unrelated hosted AI machine. After setup, offer a small creation or an agent
handoff; remote collaboration and member invitations need a deployment that supports them.

## How an agent connects

- [Setup document](${origin}/SETUP_SKILL.md) — the one-time onboarding document. Read it start to
  finish to connect to this instance, seed a first Base only when needed, and install permanent
  Busabase skills when this assistant supports them. Existing workspaces keep their contents.
- [MCP endpoint](${origin}/api/mcp) — the Model Context Protocol server, for clients that register
  Busabase as a set of tools rather than calling it over HTTP.
- [OpenAPI contract](${origin}/api/v1/openapi.json) — the complete machine-readable description of
  every endpoint, browsable at [${origin}/api/v1/doc](${origin}/api/v1/doc).
- \`npx --yes busabase-cli@latest\` — the command line client, for agents that work in a shell. It
  needs no install step, and \`busabase-cli skill\` prints that same skill document offline.
  `.trim();

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
