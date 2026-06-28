import type { SkillVO } from "busabase-core/types";

/**
 * Skills are fetched over plain REST rather than oRPC: the RPC path /skills/get
 * collides with the server's REST matcher /skills/:id (both use the word
 * "skills"), so the oRPC call resolves to a skill named "get" and 500s. The
 * plain GET endpoints below avoid that. Mirrors search-rest.ts.
 */
export async function getSkillRest(serverUrl: string, nodeIdOrSlug: string): Promise<SkillVO> {
  const base = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/skills/${encodeURIComponent(nodeIdOrSlug)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as SkillVO;
}

export async function readSkillFileRest(
  serverUrl: string,
  nodeId: string,
  filePath: string,
): Promise<{ nodeId: string; path: string; content: string; contentHash: string }> {
  const base = serverUrl.replace(/\/+$/, "");
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `${base}/api/v1/skills/${encodeURIComponent(nodeId)}/files/${encodedPath}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as {
    nodeId: string;
    path: string;
    content: string;
    contentHash: string;
  };
}
