import "server-only";

import type { FileTreeKindConfig } from "../../filetree/handlers";

export const driveFileTreeConfig = {
  type: "drive",
  label: "Drive",
  entryFile: "README.md",
  seedFiles: ({ name, description }) => [
    {
      path: "README.md",
      content: `# ${name}\n\n${description || "A shared Busabase drive for files."}\n`,
    },
  ],
} satisfies FileTreeKindConfig;
