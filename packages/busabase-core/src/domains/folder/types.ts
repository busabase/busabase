// View object owned by the folder domain. A folder owns no DB table — it is a node
// row whose "payload" is its child nodes.
import type { NodeVO } from "../../types";

export interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
}
