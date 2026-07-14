import { api, approveMerge, type NodeTreeVO } from "./_client";
import { DEMO_FOLDERS } from "./_data";

export interface DemoFolderDef {
  slug: string;
  name: string;
  description: string;
  seedNodeId?: string;
}

export const STANDARD_DEMO_FOLDERS: DemoFolderDef[] = [
  ...DEMO_FOLDERS.map((folder) => ({
    slug: folder.slug,
    name: folder.name,
    description: folder.description,
    seedNodeId: folder.nodeId,
  })),
  { slug: "docs", name: "Docs", description: "Documents and shared knowledge." },
  { slug: "files", name: "Files", description: "Uploaded files and assets." },
  {
    slug: "skills",
    name: "Agent Skills",
    description: "Reusable agent skills and instructions.",
  },
  { slug: "drives", name: "Drives", description: "Reviewed file trees and runbooks." },
  { slug: "airapps", name: "AirApps", description: "Runnable workspace applications." },
];

export interface LocatedNode {
  node: NodeTreeVO;
  parentId?: string;
}

export function findNode(
  nodes: NodeTreeVO[],
  predicate: (node: NodeTreeVO) => boolean,
  parentId?: string,
): LocatedNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return { node, parentId };
    const found = findNode(node.children ?? [], predicate, node.id);
    if (found) return found;
  }
  return undefined;
}

export const findFolderBySlug = (nodes: NodeTreeVO[], slug: string) =>
  findNode(nodes, (node) => node.type === "folder" && node.slug === slug);

export const folderSlugForSeedNodeId = (seedNodeId: string) =>
  STANDARD_DEMO_FOLDERS.find((folder) => folder.seedNodeId === seedNodeId)?.slug;

export function needsMove(nodes: NodeTreeVO[], nodeSlug: string, folderSlug: string): boolean {
  const target = findNode(nodes, (node) => node.slug === nodeSlug);
  const folder = findFolderBySlug(nodes, folderSlug);
  return !!target && !!folder && target.parentId !== folder.node.id;
}

export async function moveNodeToFolder(
  nodeSlug: string,
  folderSlug: string,
  knownNodes?: NodeTreeVO[],
): Promise<boolean> {
  const nodes = knownNodes ?? (await api<NodeTreeVO[]>("GET", "/nodes"));
  const target = findNode(nodes, (node) => node.slug === nodeSlug);
  const folder = findFolderBySlug(nodes, folderSlug);
  if (!target) throw new Error(`node slug "${nodeSlug}" not found`);
  if (!folder) throw new Error(`folder slug "${folderSlug}" not found`);
  if (target.parentId === folder.node.id) return false;

  const cr = await api<{ id: string }>("POST", "/nodes/change-requests", {
    message: `demo: move ${nodeSlug} into ${folderSlug}`,
    submittedBy: "demo-script",
    operations: [{ kind: "move", nodeId: target.node.id, parentNodeId: folder.node.id }],
  });
  await approveMerge(cr.id);
  return true;
}
