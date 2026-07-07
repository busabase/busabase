import {
  readBuiltinUserEnvConfig,
  writeBuiltinUserEnvConfig,
} from "~/domains/user-env/logic/user-env";

export const dynamic = "force-dynamic";

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    ...init,
    headers: {
      "cache-control": "no-store",
      ...init?.headers,
    },
  });
}

export async function GET() {
  return json(await readBuiltinUserEnvConfig());
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { env?: unknown } | null;
  if (!body || !body.env || typeof body.env !== "object" || Array.isArray(body.env)) {
    return json({ error: "Expected JSON body with an env object." }, { status: 400 });
  }

  return json(await writeBuiltinUserEnvConfig(body.env as Record<string, string>));
}
