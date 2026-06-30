import { buildSkillMarkdown } from "busabase-core/skill-doc";

export const dynamic = "force-dynamic";

function resolveOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = forwardedHost ?? url.host;
  return `${forwardedProto}://${host}`;
}

/**
 * Serves the local Desktop onboarding at `/SETUP_SKILL.md` (mode "local", stage "bootstrap"):
 * welcome → connect → seed a first Base → install the permanent `busabase` skill. The full,
 * ongoing API surface lives in that installed skill + `/api/v1/openapi.json`, not here — so this
 * URL is purely the one-time setup doc the pasted prompt points at.
 */
export async function GET(request: Request) {
  const content = buildSkillMarkdown(resolveOrigin(request), { mode: "local", stage: "bootstrap" });

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
