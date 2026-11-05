import { oc } from "@orpc/contract";
import { SpaceWelcomeVOSchema, UpdateSpaceWelcomeInputSchema } from "./types";

export const spaceWelcomeContract = {
  get: oc
    .route({
      method: "GET",
      path: "/space-welcome",
      tags: ["Space welcome"],
      summary: "Read which Doc or HTML node is this space's welcome page",
      description:
        "The welcome page is an ordinary Doc or HTML node a space manager chose; Home shows it at the top for every member who can read that node. `nodeId` is null when none is set. Read the node itself with `GET /nodes/{nodeId}`.",
    })
    .output(SpaceWelcomeVOSchema),
  update: oc
    .route({
      method: "PUT",
      path: "/space-welcome",
      tags: ["Space welcome"],
      summary: "Choose or clear this space's welcome page (space managers only)",
      description:
        "Write the guide as a Doc or HTML node first, then pass its id. The node must exist in this space and must not be archived or in the trash. `nodeId: null` clears the welcome. Use the version from the latest GET as expectedVersion (0 when never set). A concurrent change returns CONFLICT without overwriting it.",
    })
    .input(UpdateSpaceWelcomeInputSchema)
    .output(SpaceWelcomeVOSchema),
};
