import "server-only";

import type {
  createSkillChangeRequestInputSchema,
  createSkillInputSchema,
} from "busabase-contract/domains/skill/contract";
import type { SkillVO } from "busabase-contract/types";
import type { z } from "zod";
import type { CommitPO, NodePO, OperationPO } from "../../db/schema";
import { registerMaterializer } from "../../logic/materialize";
import type { MergeCtx } from "../../logic/store";
import {
  createFileTreeChangeRequest,
  createFileTreeNode,
  type FileTreeKindConfig,
  getFileTreeNode,
  listFileTreeFiles,
  listFileTreeNodes,
  makeMaterializer,
  mergeFileTreeFile,
  mergeFileTreeMetadata,
  readFileTreeFile,
} from "../filetree/handlers";

export const skillFileTreeConfig = {
  type: "skill",
  label: "Skill",
  entryFile: "SKILL.md",
  seedFiles: ({ slug, name, description, version }) => {
    const skillMd = `---\nname: ${slug}\ndescription: ${description || name}\n---\n\n# ${name}\n\nUse this skill when you need to ${description || "run this workflow"}.\n`;
    const manifest = JSON.stringify({ name: slug, description, version }, null, 2);
    return [
      { path: "SKILL.md", content: skillMd },
      { path: "skill.json", content: `${manifest}\n` },
    ];
  },
} satisfies FileTreeKindConfig;

export const createSkill = (input: z.input<typeof createSkillInputSchema>) =>
  createFileTreeNode(skillFileTreeConfig, input) as Promise<SkillVO>;

export const getSkill = (nodeIdOrSlug: string): Promise<SkillVO> =>
  getFileTreeNode(skillFileTreeConfig, nodeIdOrSlug) as Promise<SkillVO>;

export const listSkills = () => listFileTreeNodes(skillFileTreeConfig) as Promise<SkillVO[]>;

export const listSkillFiles = (nodeIdOrSlug: string) =>
  listFileTreeFiles(skillFileTreeConfig, nodeIdOrSlug);

export const readSkillFile = (nodeIdOrSlug: string, filePath: string) =>
  readFileTreeFile(skillFileTreeConfig, nodeIdOrSlug, filePath);

export const createSkillChangeRequest = (
  nodeIdOrSlug: string,
  input: z.input<typeof createSkillChangeRequestInputSchema>,
) => createFileTreeChangeRequest(skillFileTreeConfig, nodeIdOrSlug, input);

export const mergeSkillFile = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  try {
    await mergeFileTreeFile(ctx, item, node, headCommit);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid file-tree file operation")) {
      throw new Error(`Invalid skill file operation target: ${item.id}`);
    }
    throw error;
  }
};

export const mergeSkillMetadata = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  try {
    await mergeFileTreeMetadata(ctx, item, node, headCommit);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Invalid file-tree metadata operation")
    ) {
      throw new Error(`Invalid skill metadata operation target: ${item.id}`);
    }
    throw error;
  }
};
export const materializeSkillNode = makeMaterializer(skillFileTreeConfig);

registerMaterializer("skill", materializeSkillNode);
