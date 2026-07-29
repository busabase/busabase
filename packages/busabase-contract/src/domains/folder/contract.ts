import { z } from "zod";
import { nodeSchema } from "../../contract/schemas";

// --- Folder domain schema (a folder + its direct child nodes) ---

export const folderSchema = z.object({
  node: nodeSchema,
  children: z.array(nodeSchema),
});

// The Folder domain has no transport surface of its own any more. `GET /folders`
// and `GET /folders/{nodeId}` were retired in favour of the unified Node
// surface: list folders with `GET /nodes?types=folder` (lightweight summaries —
// the old list ran a children query and hydration per folder) and read one with
// `GET /nodes/{nodeId}`, which returns this exact `folderSchema` payload under
// `type: "folder"`. The schema stays here because it is still the folder
// variant of `NodeDetailVOSchema`.
