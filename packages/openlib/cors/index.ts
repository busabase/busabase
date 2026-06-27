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
export function addCorsHeaders<T extends Response>(response: T, methods: string): T {
  response.headers.set("Access-Control-Allow-Origin", CORS_HEADERS["Access-Control-Allow-Origin"]);
  response.headers.set("Access-Control-Allow-Methods", methods);
  response.headers.set(
    "Access-Control-Allow-Headers",
    CORS_HEADERS["Access-Control-Allow-Headers"],
  );
  return response;
}

/**
 *
 * Create CORS headers object with specified methods
 * Useful for OPTIONS handlers
 * @param methods - HTTP methods to allow (e.g., "GET, POST, OPTIONS")
 * @returns Headers object with CORS configuration
 *
 */
export function createCorsHeaders(methods: string): Record<string, string> {
  return {
    ...CORS_HEADERS,
    "Access-Control-Allow-Methods": methods,
  };
}
