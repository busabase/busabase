/**
 * Standard CORS headers for public API endpoints
 * Allows cross-origin requests from any domain
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/**
 * Add CORS headers to a NextResponse object
 * @param response - NextResponse to add headers to
 * @param methods - HTTP methods to allow (e.g., "GET, POST, OPTIONS")
 * @returns The response with CORS headers added
 */
export function addCorsHeaders<T extends Response>(
  response: T,
  methods: string,
  allowHeaders = CORS_HEADERS["Access-Control-Allow-Headers"],
): T {
  response.headers.set("Access-Control-Allow-Origin", CORS_HEADERS["Access-Control-Allow-Origin"]);
  response.headers.set("Access-Control-Allow-Methods", methods);
  response.headers.set("Access-Control-Allow-Headers", allowHeaders);
  return response;
}

/**
 *
 * Create CORS headers object with specified methods
 * Useful for OPTIONS handlers
 * @param methods - HTTP methods to allow (e.g., "GET, POST, OPTIONS")
 * @param allowHeaders - request headers to allow (defaults to Content-Type, Authorization)
 * @returns Headers object with CORS configuration
 *
 */
export function createCorsHeaders(
  methods: string,
  allowHeaders = CORS_HEADERS["Access-Control-Allow-Headers"],
): Record<string, string> {
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": allowHeaders,
  };
}
