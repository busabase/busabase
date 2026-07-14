/**
 * Next.js Instrumentation Hook — see https://nextjs.org/docs/app/guides/instrumentation
 *
 * Only used today to resume a previously-connected Cloud tunnel on server
 * boot (Local ↔ Cloud Tunnel, Block 1) — a working tunnel should survive an
 * OSS server restart without the user re-clicking Connect.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Separate node file so this only ever runs once, on the real Node
    // runtime (matches apps/busabase-cloud's instrumentation.ts pattern).
    await import("./instrumentation.node");
  }
}
