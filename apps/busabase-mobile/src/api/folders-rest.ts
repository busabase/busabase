import type { NodeVO } from "busabase-core/types";

interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
}

/**
 * Folders are fetched over plain REST (mirrors skills-rest.ts / docs-rest.ts).
 */
export async function getFolderRest(serverUrl: string, nodeIdOrSlug: string): Promise<FolderVO> {
  const base = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/folders/${encodeURIComponent(nodeIdOrSlug)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as FolderVO;
}

export type { FolderVO };
