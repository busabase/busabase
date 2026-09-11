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

Busabase is a workspace built for AI agents — a database, a knowledge base, an apps library, and a
skills registry in one place. Agents write into it through change requests, so every change carries
a message, a diff, an author, and a history you can roll back. This server is the open-source
edition, so the data lives on the machine that serves this page and nowhere else.

## How an agent connects

- [Setup document](${origin}/SETUP_SKILL.md) — the one-time onboarding document. Read it start to
  finish and you end up connected to this instance, with a first Base seeded and the permanent
  Busabase skills installed.
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
