interface DocVO {
  node: { id: string; slug: string; name: string; description: string; type: string };
  storagePrefix: string;
  body: string;
}

/**
 * Docs are fetched over plain REST (mirrors skills-rest.ts) to avoid the oRPC
 * path/REST-matcher collision on shared path words.
 */
export async function getDocRest(serverUrl: string, nodeIdOrSlug: string): Promise<DocVO> {
  const base = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/docs/${encodeURIComponent(nodeIdOrSlug)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as DocVO;
}

export async function updateDocBodyRest(
  serverUrl: string,
  nodeId: string,
  body: string,
): Promise<DocVO> {
  const base = serverUrl.replace(/\/+$/, "");
  const response = await fetch(`${base}/api/v1/docs/${encodeURIComponent(nodeId)}/body`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`Server responded ${response.status}`);
  }
  return (await response.json()) as DocVO;
}

export type { DocVO };
