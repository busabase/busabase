export const DESKTOP_AGENT_REQUEST = "busabase-desktop:agent-dependencies";
export const DESKTOP_AGENT_RESULT = "busabase-desktop:agent-dependencies:result";
export type DesktopAgentSlug = "codex-acp" | "claude-acp";

export interface DesktopAgentStatus {
  source: "system" | "managed";
  installed: boolean;
  codex: "ready" | "missing" | "login_required";
  systemPath?: string | null;
  codexPath?: string | null;
  auth: "ready" | "missing" | "login_required" | "unknown";
}

export async function requestDesktopAgent(
  slug: DesktopAgentSlug,
  action: "status" | "install",
  win: Window | undefined = typeof window === "undefined" ? undefined : window,
): Promise<DesktopAgentStatus | null> {
  const parent = win?.parent;
  if (!win || !parent || parent === win) return null;
  const requestId = `agent-${win.crypto.randomUUID()}`;
  return new Promise((resolve, reject) => {
    const timeout = win.setTimeout(() => finish(null), action === "install" ? 125_000 : 4_000);
    const finish = (result: DesktopAgentStatus | null, error?: string) => {
      win.clearTimeout(timeout);
      win.removeEventListener("message", onMessage);
      if (error) reject(new Error(error));
      else resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent) return;
      const data = event.data;
      if (data?.type !== DESKTOP_AGENT_RESULT || data.requestId !== requestId || data.slug !== slug)
        return;
      finish(data.status ?? null, data.error);
    };
    win.addEventListener("message", onMessage);
    parent.postMessage({ type: DESKTOP_AGENT_REQUEST, requestId, slug, action }, "*");
  });
}
