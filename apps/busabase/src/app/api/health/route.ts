import { NextResponse } from "next/server";
import { addCorsHeaders, createCorsHeaders } from "openlib/cors";

const HEALTH_API_METHODS = "GET, OPTIONS";

export const GET = () =>
  addCorsHeaders(
    NextResponse.json({
      service: "busabase",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
    HEALTH_API_METHODS,
  );

export const OPTIONS = () =>
  new Response(null, {
    status: 204,
    headers: createCorsHeaders(HEALTH_API_METHODS),
  });
