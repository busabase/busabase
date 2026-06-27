import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { runWithBusabaseContext } from "busabase-core/context";
import { getBusabaseOpenApiSpec } from "busabase-core/openapi";
import { busabaseRouter } from "busabase-core/router";
import { busabaseDemoRouter } from "busabase-core/router-demo";
import { addCorsHeaders, createCorsHeaders } from "openlib/cors";
import { resolveDemoMode } from "openlib/ui/dashboard/demo";

const BUSABASE_API_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";

const encodeOpenApiError = (error: { data?: unknown; message?: string; code?: string }) => {
  if (error.data && typeof error.data === "object" && "error" in error.data) {
    return error.data;
  }

  return {
    error: error.message || "Internal server error",
    code: error.code,
    data: error.data,
  };
};

const openApiHandler = new OpenAPIHandler(busabaseRouter, {
  customErrorResponseBodyEncoder: encodeOpenApiError,
});

const demoOpenApiHandler = new OpenAPIHandler(busabaseDemoRouter, {
  customErrorResponseBodyEncoder: encodeOpenApiError,
});

async function handle(request: Request) {
  const url = new URL(request.url);
  const { useCase: demoUseCase, locale: demoLocale } = resolveDemoMode(
    url.searchParams,
    request.headers,
  );
  const run = () => routeRequest(request, url, Boolean(demoUseCase));

  return demoUseCase
    ? runWithBusabaseContext({ isDemo: true, demoUseCase, demoLocale }, run)
    : run();
}

async function routeRequest(request: Request, url: URL, isDemo: boolean) {
  if (url.pathname === "/api/v1/openapi.json") {
    return addCorsHeaders(Response.json(await getBusabaseOpenApiSpec()), BUSABASE_API_METHODS);
  }

  if (url.pathname === "/api/v1/doc") {
    return addCorsHeaders(
      new Response(getSwaggerHtml(), {
        headers: {
          "content-type": "text/html; charset=utf-8",
        },
      }),
      BUSABASE_API_METHODS,
    );
  }

  const result = await (isDemo ? demoOpenApiHandler : openApiHandler).handle(request, {
    context: {},
  });

  if (result.matched) {
    return addCorsHeaders(result.response, BUSABASE_API_METHODS);
  }

  return addCorsHeaders(
    Response.json({ error: "Not found", path: url.pathname }, { status: 404 }),
    BUSABASE_API_METHODS,
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
    headers: createCorsHeaders(BUSABASE_API_METHODS),
  });

const getSwaggerHtml = () => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Busabase API Documentation</title>
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
