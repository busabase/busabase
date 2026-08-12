import { ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { runWithBusabaseContext, runWithLocalContext } from "busabase-core/context";
import { busabaseRouter } from "busabase-core/router";
import { busabaseDemoRouter } from "busabase-core/router-demo";
import { addCorsHeaders, createCorsHeaders } from "openlib/cors";
import { resolveDemoMode } from "openlib/ui/dashboard/demo";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getLocalUserName } from "~/lib/local-user";

// BatchHandlerPlugin serves the batch requests emitted by the shared
// BatchLinkPlugin. Both routers use the same transport in normal and demo mode.
const handler = new RPCHandler(busabaseRouter, { plugins: [new BatchHandlerPlugin()] });
const demoHandler = new RPCHandler(busabaseDemoRouter, { plugins: [new BatchHandlerPlugin()] });
const BUSABASE_RPC_METHODS = "GET, POST, OPTIONS";

async function handle(request: Request) {
  const url = new URL(request.url);
  const { useCase: demoUseCase, locale: demoLocale } = resolveDemoMode(
    url.searchParams,
    request.headers,
  );
  const run = async () => {
    const result = await (demoUseCase ? demoHandler : handler).handle(request, {
      context: {},
      prefix: "/api/rpc",
    });
    if (!result.matched) {
      return addCorsHeaders(new Response("Not Found", { status: 404 }), BUSABASE_RPC_METHODS);
    }
    return addCorsHeaders(result.response, BUSABASE_RPC_METHODS);
  };

  try {
    if (demoUseCase) {
      return await runWithBusabaseContext({ isDemo: true, demoUseCase, demoLocale }, run);
    }

    const vaultRuntimeEnv = await readBuiltinVaultRuntimeEnv();
    return await runWithLocalContext({ vaultRuntimeEnv, localUserName: getLocalUserName() }, run);
  } catch (error) {
    if (error instanceof ORPCError) {
      return addCorsHeaders(
        Response.json(
          { error: error.message, code: error.code, data: error.data },
          { status: error.status },
        ),
        BUSABASE_RPC_METHODS,
      );
    }
    throw error;
  }
}

export const GET = handle;
export const POST = handle;
export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: createCorsHeaders(BUSABASE_RPC_METHODS),
  });
