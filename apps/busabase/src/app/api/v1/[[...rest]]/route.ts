import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { runWithBusabaseContext } from "busabase-core/context";
import { getBusabaseOpenApiSpec } from "busabase-core/openapi";
import { BUSABASE_API_ALLOW_HEADERS, BUSABASE_API_METHODS } from "busabase-core/openapi/cors";
import { encodeBusabaseOpenApiError } from "busabase-core/openapi/error-envelope";
import { busabaseRouter } from "busabase-core/router";
import { busabaseDemoRouter } from "busabase-core/router-demo";
import { addCorsHeaders, createCorsHeaders } from "openlib/cors";
import { resolveDemoMode } from "openlib/ui/dashboard/demo";
import { readBuiltinVaultRuntimeEnv } from "~/domains/vault/logic/vault";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";
import { getLocalUserName } from "~/lib/local-user";

// Shared with busabase-cloud on purpose: both servers mount the same contract,
// so an SDK or agent talking to either has to see the same error shape. This
// file's own copy used to return a self-shaped `{ error, … }` body verbatim,
// which dropped `code` — see `busabase-core/src/openapi/error-envelope.ts`.
const openApiHandler = new OpenAPIHandler(busabaseRouter, {
  customErrorResponseBodyEncoder: encodeBusabaseOpenApiError,
});

const demoOpenApiHandler = new OpenAPIHandler(busabaseDemoRouter, {
  customErrorResponseBodyEncoder: encodeBusabaseOpenApiError,
});

async function handle(request: Request) {
  const url = new URL(request.url);
  const { useCase: demoUseCase, locale: demoLocale } = resolveDemoMode(
    url.searchParams,
    request.headers,
  );
  const run = () => routeRequest(request, url, Boolean(demoUseCase));

  if (demoUseCase) {
    return runWithBusabaseContext({ isDemo: true, demoUseCase, demoLocale }, run);
  }

  const vaultRuntimeEnv = await readBuiltinVaultRuntimeEnv();
  return runWithBusabaseContext({ vaultRuntimeEnv, localUserName: getLocalUserName() }, run);
}

async function routeRequest(request: Request, url: URL, isDemo: boolean) {
  if (url.pathname === "/api/v1/openapi.json") {
    return addCorsHeaders(
      Response.json(await getBusabaseOpenApiSpec()),
      BUSABASE_API_METHODS,
      BUSABASE_API_ALLOW_HEADERS,
    );
  }

  if (url.pathname === "/api/v1/doc") {
    const locale = getBusabaseLocaleFromAcceptLanguage(request.headers.get("accept-language"));
    const LL = getBusabaseAppLL(locale);
    return addCorsHeaders(
      new Response(getSwaggerHtml({ lang: locale, title: LL.marketing.apiDocsTitle() }), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
      BUSABASE_API_METHODS,
      BUSABASE_API_ALLOW_HEADERS,
    );
  }

  const result = await (isDemo ? demoOpenApiHandler : openApiHandler).handle(request, {
    context: {},
  });

  if (result.matched) {
    return addCorsHeaders(result.response, BUSABASE_API_METHODS, BUSABASE_API_ALLOW_HEADERS);
  }

  return addCorsHeaders(
    Response.json({ error: "Not found", path: url.pathname }, { status: 404 }),
    BUSABASE_API_METHODS,
    BUSABASE_API_ALLOW_HEADERS,
  );
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: createCorsHeaders(BUSABASE_API_METHODS, BUSABASE_API_ALLOW_HEADERS),
  });

const getSwaggerHtml = ({ lang, title }: { lang: string; title: string }) => `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; }
    #swagger-ui { height: 100vh; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/api/v1/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIBundle.SwaggerUIStandalonePreset
        ],
      });
    };
  </script>
</body>
</html>`;
