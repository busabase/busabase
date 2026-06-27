import { buildSkillMarkdown } from "busabase-core/skill-doc";

export const dynamic = "force-dynamic";

function resolveOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = forwardedHost ?? url.host;
  return `${forwardedProto}://${host}`;
}

export async function GET(request: Request) {
  const content = buildSkillMarkdown(resolveOrigin(request), { mode: "local" });

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
