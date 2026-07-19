import "server-only";

/**
 * In-process registry mapping a running AirApp `nodeId` to the localhost port
 * its Local Node.js dev server bound to. Populated by `local-node-runtime.ts`
 * when a run reaches its `ready` state and cleared when the run ends; read by
 * the `/__airapp_preview__/{nodeId}/…` reverse-proxy route to know where to
 * forward requests.
 *
 * IMPORTANT — this is a module-level `Map`, so it is single-server /
 * single-process only, the same limitation class as the `SandboxManager`
 * process-wide singleton the Local Node runtime already relies on: a run and
 * the proxy request for its preview must be handled by the same Next.js
 * server process. That is already true for the Local Node engine (the process
 * it spawns is reachable only from the host that spawned it), so no external
 * store is needed here.
 */

const localPreviewPorts = new Map<string, number>();

export function registerLocalPreview(nodeId: string, port: number): void {
  localPreviewPorts.set(nodeId, port);
}

export function getLocalPreviewPort(nodeId: string): number | undefined {
  return localPreviewPorts.get(nodeId);
}

export function unregisterLocalPreview(nodeId: string): void {
  localPreviewPorts.delete(nodeId);
}
