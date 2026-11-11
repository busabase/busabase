// View object owned by the folder domain. A folder owns no DB table — it is a node
// row whose "payload" is its child nodes.
import { z } from "zod";
import type { NodeVO } from "../../types";

/**
 * What a folder readme is written in. `markdown` is rendered as a Doc-style
 * preview; `html` is a page shown in the same sandboxed frame an HTML node
 * uses. The format is not a setting stored beside the body: it is which object
 * holds the body (`…/folder/readme.md` or `…/folder/readme.html`).
 */
export const FOLDER_BODY_FORMATS = ["markdown", "html"] as const;
export const FolderBodyFormatSchema = z.enum(FOLDER_BODY_FORMATS);
export type FolderBodyFormat = z.infer<typeof FolderBodyFormatSchema>;

export interface FolderVO {
  node: NodeVO;
  children: NodeVO[];
  /** `busabase/nodes/{nodeId}/folder/` — the readme object lives beside children, not in them. */
  storagePrefix: string;
  /** Optional readme. Missing object reads as `""`. Separate from `node.description`. */
  body: string;
  /** How `body` is written. `markdown` when the folder has no readme. */
  bodyFormat: FolderBodyFormat;
}
