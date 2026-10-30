// View object owned by the folder domain. A folder owns no DB table — it is a node
// row whose "payload" is its child nodes.
import type { NodeVO } from "../../types";

export interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
  /** `busabase/nodes/{nodeId}/folder/` — the readme object lives beside children, not in them. */
  storagePrefix: string;
  /** Optional Markdown readme. Missing object reads as `""`. Separate from `node.description`. */
  body: string;
}
