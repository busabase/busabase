/** Cloud canonical redirects URL-encode path segments; ACP identities are decoded. */
export function decodeAgentRouteSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}
