import "server-only";

import type {
  createSkillChangeRequestInputSchema,
  createSkillInputSchema,
} from "busabase-contract/domains/skill/contract";
import { SkillFrontmatterSchema } from "busabase-contract/domains/skill/frontmatter";
import type { ChangeRequestVO, SkillVO } from "busabase-contract/types";
import { parseFrontmatter } from "busabase-package/frontmatter";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import { busabaseNodes, type CommitPO, type NodePO, type OperationPO } from "../../db/schema";
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
  readMountedTextFile,
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
  createFileTreeNode(skillFileTreeConfig, input) as Promise<
    (SkillVO & { materialized: true }) | (ChangeRequestVO & { materialized: false })
  >;

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

const SKILL_ENTRY_FILE = "SKILL.md";

/**
 * `SKILL.md` frontmatter `name`/`description`, or `null` when the text has no
 * parseable frontmatter. Never throws: a skill author's YAML typo must not be
 * able to fail the merge that carries it.
 */
export const readSkillFrontmatter = (
  text: string | null,
): { name: string; description: string } | null => {
  if (text === null) return null;
  try {
    const parsed = SkillFrontmatterSchema.safeParse(parseFrontmatter(text, SKILL_ENTRY_FILE).data);
    return parsed.success ? { name: parsed.data.name, description: parsed.data.description } : null;
  } catch {
    return null;
  }
};

/**
 * Keep the node's `description` (and `name`) following its `SKILL.md`.
 *
 * The node row is what discovery ranks on (`playbooks.search`, `nodes.list`),
 * but it used to be copied from the frontmatter only at create time — edit the
 * description in `SKILL.md` and search kept matching the old wording.
 *
 * `name` is synced only when the frontmatter `name` itself changed in THIS
 * edit. A skill created in the dashboard is seeded with `name: <slug>` while its
 * node carries the human title ("Weekly Report" vs `weekly-report`); copying the
 * frontmatter name on every edit would silently rename it to its slug the
 * first time anyone touched the description.
 *
 * Unparseable frontmatter (before or after) leaves both columns exactly as
 * they were; this never throws.
 */
const syncSkillNodeFromFrontmatter = async (ctx: MergeCtx, node: NodePO, before: string | null) => {
  try {
    const next = readSkillFrontmatter(await readMountedTextFile(node, SKILL_ENTRY_FILE, ctx.db));
    if (!next) return;
    const previous = readSkillFrontmatter(before);
    const nameChanged = previous !== null && previous.name !== next.name && next.name !== node.name;
    const descriptionChanged = next.description !== node.description;
    if (!nameChanged && !descriptionChanged) return;
    await ctx.db
      .update(busabaseNodes)
      .set({
        ...(descriptionChanged ? { description: next.description } : {}),
        ...(nameChanged ? { name: next.name } : {}),
        updatedAt: ctx.timestamp,
      })
      .where(eq(busabaseNodes.id, node.id));
  } catch (error) {
    // Best effort by design: the file write above already applied, and a sync
    // failure must not turn a good merge into a failed one.
    console.warn(`[busabase] SKILL.md frontmatter sync skipped for ${node.id}:`, error);
  }
};

const isSkillEntryPath = (filePath: string | null) =>
  filePath !== null && filePath.replace(/\\/g, "/").replace(/^\.\//, "") === SKILL_ENTRY_FILE;

export const mergeSkillFile = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  const touchesEntry =
    node.type === "skill" &&
    isSkillEntryPath(item.filePath) &&
    typeof item.operation === "string" &&
    !item.operation.endsWith("_delete");
  const before = touchesEntry
    ? await readMountedTextFile(node, SKILL_ENTRY_FILE, ctx.db).catch(() => null)
    : null;
  try {
    await mergeFileTreeFile(ctx, item, node, headCommit);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Invalid file-tree file operation")) {
      throw new Error(`Invalid skill file operation target: ${item.id}`);
    }
    throw error;
  }
  if (touchesEntry) await syncSkillNodeFromFrontmatter(ctx, node, before);
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
// Built on first use, not at module evaluation: `makeMaterializer` comes from
// filetree/handlers, and calling it here would make this module's evaluation
// order relative to that one load-bearing (see logic/materialize.ts).
let materializeSkillNodeImpl: ReturnType<typeof makeMaterializer> | undefined;
export const materializeSkillNode: ReturnType<typeof makeMaterializer> = (ctx, args) => {
  if (!materializeSkillNodeImpl) {
    materializeSkillNodeImpl = makeMaterializer(skillFileTreeConfig);
  }
  return materializeSkillNodeImpl(ctx, args);
};

registerMaterializer("skill", materializeSkillNode);
