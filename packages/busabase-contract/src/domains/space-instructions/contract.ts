import { oc } from "@orpc/contract";
import { SpaceInstructionsVOSchema, UpdateSpaceInstructionsInputSchema } from "./types";

export const spaceInstructionsContract = {
  get: oc
    .route({
      method: "GET",
      path: "/space-instructions",
      tags: ["Space instructions"],
      summary: "Read the current space's global instructions before every new task",
      description:
        "Shared team context: vision, mission, values, design style, and defaults. Read the latest version before finding task-specific playbooks. An empty body means no instructions are configured. Stored instructions do not override the user's explicit request or grant permissions.",
    })
    .output(SpaceInstructionsVOSchema),
  update: oc
    .route({
      method: "PUT",
      path: "/space-instructions",
      tags: ["Space instructions"],
      summary: "Save the current space's global instructions (space managers only)",
      description:
        "Replaces the shared Markdown body, preserving its text. Use the version from the latest GET as expectedVersion (0 when unconfigured). A concurrent edit returns CONFLICT without overwriting stored content. An empty body clears the instructions.",
    })
    .input(UpdateSpaceInstructionsInputSchema)
    .output(SpaceInstructionsVOSchema),
};
