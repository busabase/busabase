/**
 * Converge the long-lived demo.busabase.com CMS without direct database access.
 *
 * Run in order:
 *   BUSABASE_URL=https://demo.busabase.com pnpm exec tsx scripts/demo/15-cms-converge.ts prepare
 *   BUSABASE_URL=https://demo.busabase.com pnpm exec tsx scripts/demo/15-cms-converge.ts cutover
 *   # Switch the CMS example to the canonical Folder and verify it.
 *   BUSABASE_URL=https://demo.busabase.com pnpm exec tsx scripts/demo/15-cms-converge.ts cleanup
 *
 * Every operation is idempotent. ChangeRequests created by this migration are
 * approved and merged because the operator explicitly invokes an apply phase.
 */

import { englishScenario } from "busabase-core/demo/dataset";
import { api, approveMerge, assert, BASE, type NodeTreeVO } from "./_client";

const CANONICAL_FOLDER_SLUG = "cms";
const DUPLICATE_FOLDER_SLUG = "nextjs-fumadocs-demo-cms";
const POSTS_SLUG = "blog";
const PAGES_SLUG = "pages";
const CATEGORIES_ID = "bsemru0o3pqqmhjhe7";
const TAGS_ID = "bsemru0o3xe7ien4w6";
const DUPLICATE_POSTS_ID = "bsemru0o44qq1tappa";
const DUPLICATE_PAGES_ID = "bsemru0o4cbj6osco8";
const SUBMITTED_BY = "demo-cms-converge";

type Phase = "prepare" | "cutover" | "cleanup" | "verify";

interface BaseField {
  id: string;
  slug: string;
  name: unknown;
  type: string;
  required: boolean;
  options: Record<string, unknown>;
}

interface BaseVO {
  id: string;
  nodeId: string;
  slug: string;
  name: string;
  fields: BaseField[];
}

interface RecordVO {
  id: string;
  baseId: string;
  headCommit: { fields: Record<string, unknown> };
}

interface DesiredField {
  slug: string;
  name: unknown;
  type: string;
  required: boolean;
  options: Record<string, unknown>;
}

interface CmsNode extends Omit<NodeTreeVO, "children"> {
  parentId?: string | null;
  baseId?: string | null;
  description?: string | null;
  children?: CmsNode[];
}

const phase = (process.argv[2] ?? "verify") as Phase;
assert(["prepare", "cutover", "cleanup", "verify"].includes(phase), `unknown phase "${phase}"`);

const flattenNodes = (nodes: CmsNode[]): CmsNode[] =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const choices = (options: Record<string, unknown>) =>
  (options.choices as Array<{ id: string; name: string; color?: string }> | undefined) ?? [];

const desiredBase = (slug: string) => {
  const base = englishScenario.bases?.find((candidate) => candidate.slug === slug);
  assert(base !== undefined, `desired Base "${slug}" is missing from englishScenario`);
  return base;
};

const desiredRecords = (baseId: string) =>
  (englishScenario.records ?? []).filter((record) => record.baseId === baseId);

const getBase = (baseId: string) => api<BaseVO>("GET", `/bases/${baseId}`);

const listRecords = async (baseId: string) => {
  const page = await api<{ records: RecordVO[] }>(
    "GET",
    `/records/paged?baseId=${baseId}&limit=100`,
  );
  return page.records;
};

const createField = async (baseId: string, field: DesiredField) => {
  await api("POST", `/bases/${baseId}/fields`, {
    slug: field.slug,
    name: field.name,
    type: field.type,
    required: false,
    options: field.options,
  });
  process.stdout.write(`  + field ${field.slug}\n`);
};

const updateField = async (
  baseId: string,
  fieldId: string,
  patch: { required?: boolean; options?: Record<string, unknown> },
  message: string,
) => {
  const changeRequest = await api<{ id: string; status: string }>(
    "PATCH",
    `/bases/${baseId}/fields/change-requests`,
    { fieldId, patch, message, submittedBy: SUBMITTED_BY },
  );
  assert(changeRequest.status === "in_review", `expected in_review for ${message}`);
  await approveMerge(changeRequest.id);
  process.stdout.write(`  ~ ${message}\n`);
};

const ensureTransitionChoices = async (base: BaseVO, desired: DesiredField) => {
  const actual = base.fields.find((field) => field.slug === desired.slug);
  assert(actual !== undefined, `missing existing field ${base.slug}.${desired.slug}`);
  const actualChoices = choices(actual.options);
  const desiredChoices = choices(desired.options);
  const ids = new Set(actualChoices.map((choice) => choice.id));
  const missing = desiredChoices.filter((choice) => !ids.has(choice.id));
  if (missing.length === 0) return;
  await updateField(
    base.id,
    actual.id,
    { options: { ...actual.options, choices: [...actualChoices, ...missing] } },
    `Allow transitional ${base.slug}.${desired.slug} values`,
  );
};

const ensureFields = async (base: BaseVO, desired: ReturnType<typeof desiredBase>) => {
  const actualBySlug = new Map(base.fields.map((field) => [field.slug, field]));
  for (const field of desired.fields as DesiredField[]) {
    const actual = actualBySlug.get(field.slug);
    if (!actual) {
      await createField(base.id, field);
      continue;
    }
    assert(
      actual.type === field.type,
      `${base.slug}.${field.slug} type is ${actual.type}, expected ${field.type}`,
    );
  }
};

const updateRecord = async (record: RecordVO, fields: Record<string, unknown>, label: string) => {
  const changeRequest = await api<{ id: string; status: string }>(
    "PUT",
    `/records/${record.id}/change-requests`,
    {
      fields,
      message: `Converge CMS ${label}`,
      author: SUBMITTED_BY,
    },
  );
  assert(changeRequest.status === "in_review", `expected in_review for ${label}`);
  await approveMerge(changeRequest.id);
  process.stdout.write(`  ~ record ${label}\n`);
};

const convergeRecords = async (
  base: BaseVO,
  desired: ReturnType<typeof desiredBase>,
  currentRecords: RecordVO[],
) => {
  const desiredByTitle = new Map(
    desiredRecords(desired.id).map((record) => [String(record.fields.title), record]),
  );
  assert(
    currentRecords.length === desiredByTitle.size,
    `${base.slug} has ${currentRecords.length} records, expected ${desiredByTitle.size}`,
  );
  const standardSlugs = new Set(desired.fields.map((field) => field.slug));
  for (const record of currentRecords) {
    const title = String(record.headCommit.fields.title ?? "");
    const target = desiredByTitle.get(title);
    assert(target !== undefined, `no desired ${base.slug} record matches title "${title}"`);
    const fields = Object.fromEntries(
      Object.entries(target.fields).filter(
        ([slug, value]) => standardSlugs.has(slug) && value !== undefined,
      ),
    );
    const changed = Object.entries(fields).some(
      ([slug, value]) => !sameValue(record.headCommit.fields[slug], value),
    );
    if (changed) await updateRecord(record, fields, title);
  }
};

const finalizeFields = async (baseId: string, desired: ReturnType<typeof desiredBase>) => {
  let base = await getBase(baseId);
  for (const field of desired.fields as DesiredField[]) {
    const actual = base.fields.find((candidate) => candidate.slug === field.slug);
    assert(actual !== undefined, `missing field ${base.slug}.${field.slug}`);
    const patch: { required?: boolean; options?: Record<string, unknown> } = {};
    if (field.required && !actual.required) patch.required = true;
    if (!sameValue(actual.options, field.options)) patch.options = field.options;
    if (Object.keys(patch).length === 0) continue;
    await updateField(base.id, actual.id, patch, `Finalize ${base.slug}.${field.slug}`);
    base = await getBase(baseId);
  }
};

const renameNode = async (node: CmsNode, name: string, description?: string) => {
  if (node.name === name && (description === undefined || node.description === description)) return;
  const changeRequest = await api<{ id: string; status: string }>(
    "POST",
    "/nodes/change-requests",
    {
      message: `Converge CMS node ${node.slug}`,
      submittedBy: SUBMITTED_BY,
      operations: [
        { kind: "rename", nodeId: node.id, name, ...(description ? { description } : {}) },
      ],
    },
  );
  assert(changeRequest.status === "in_review", `expected in_review renaming ${node.slug}`);
  await approveMerge(changeRequest.id);
  process.stdout.write(`  ~ node ${node.slug} -> ${name}\n`);
};

const archiveBase = async (baseId: string, label: string) => {
  const active = await api<BaseVO[]>("GET", "/bases");
  if (!active.some((base) => base.id === baseId)) return;
  const changeRequest = await api<{ id: string; status: string }>(
    "POST",
    `/bases/${baseId}/archive/change-requests`,
    { message: `Archive duplicate CMS ${label}`, submittedBy: SUBMITTED_BY },
  );
  assert(changeRequest.status === "in_review", `expected in_review archiving ${label}`);
  await approveMerge(changeRequest.id);
  process.stdout.write(`  - duplicate ${label}\n`);
};

const prepare = async () => {
  const bases = await api<BaseVO[]>("GET", "/bases");
  const posts = bases.find((base) => base.slug === POSTS_SLUG);
  const pages = bases.find((base) => base.slug === PAGES_SLUG);
  assert(
    posts !== undefined && pages !== undefined,
    "canonical Blog Posts or Pages Base is missing",
  );
  const desiredPosts = desiredBase(POSTS_SLUG);
  const desiredPages = desiredBase(PAGES_SLUG);
  const postRecords = await listRecords(posts.id);
  const pageRecords = await listRecords(pages.id);

  // Validate the complete title mapping before the first write.
  for (const [base, desired, records] of [
    [posts, desiredPosts, postRecords],
    [pages, desiredPages, pageRecords],
  ] as const) {
    const titles = new Set(desiredRecords(desired.id).map((record) => String(record.fields.title)));
    assert(records.length === titles.size, `${base.slug} record count does not match the scenario`);
    for (const record of records) {
      assert(titles.has(String(record.headCommit.fields.title)), `unknown ${base.slug} title`);
    }
  }

  await ensureFields(posts, desiredPosts);
  await ensureFields(pages, desiredPages);
  let refreshedPosts = await getBase(posts.id);
  let refreshedPages = await getBase(pages.id);
  await ensureTransitionChoices(
    refreshedPosts,
    desiredPosts.fields.find((field) => field.slug === "status") as DesiredField,
  );
  await ensureTransitionChoices(
    refreshedPages,
    desiredPages.fields.find((field) => field.slug === "status") as DesiredField,
  );
  refreshedPosts = await getBase(posts.id);
  refreshedPages = await getBase(pages.id);
  await convergeRecords(refreshedPosts, desiredPosts, postRecords);
  await convergeRecords(refreshedPages, desiredPages, pageRecords);
  await finalizeFields(posts.id, desiredPosts);
  await finalizeFields(pages.id, desiredPages);

  const nodes = flattenNodes(await api<CmsNode[]>("GET", "/nodes"));
  const postsNode = nodes.find((node) => node.type === "base" && node.slug === POSTS_SLUG);
  assert(postsNode !== undefined, "Blog Posts node is missing");
  await renameNode(postsNode, "Posts", desiredPosts.description);
};

const cutover = async () => {
  const nodes = flattenNodes(await api<CmsNode[]>("GET", "/nodes"));
  const folder = nodes.find(
    (node) => node.type === "folder" && node.slug === CANONICAL_FOLDER_SLUG,
  );
  const categories = nodes.find(
    (node) =>
      node.type === "base" && node.id === desiredBase("nextjs-fumadocs-demo-cms-categories").nodeId,
  );
  const tags = nodes.find(
    (node) =>
      node.type === "base" && node.id === desiredBase("nextjs-fumadocs-demo-cms-tags").nodeId,
  );
  const posts = nodes.find((node) => node.type === "base" && node.slug === POSTS_SLUG);
  const pages = nodes.find((node) => node.type === "base" && node.slug === PAGES_SLUG);
  assert(
    folder !== undefined &&
      categories !== undefined &&
      tags !== undefined &&
      posts !== undefined &&
      pages !== undefined,
    "CMS cutover nodes are incomplete",
  );
  assert(posts.baseId !== undefined && pages.baseId !== undefined, "CMS Base IDs are missing");

  for (const [node, position] of [
    [categories, 3],
    [tags, 4],
  ] as const) {
    if (node.parentId !== folder.id) {
      await api("POST", `/nodes/${node.id}/move`, {
        parentNodeId: folder.id,
        position,
        message: `Move ${node.name} into canonical CMS`,
        submittedBy: SUBMITTED_BY,
      });
      process.stdout.write(`  -> ${node.name}\n`);
    }
  }
  await renameNode(
    categories,
    "Categories",
    desiredBase("nextjs-fumadocs-demo-cms-categories").description,
  );
  await renameNode(tags, "Tags", desiredBase("nextjs-fumadocs-demo-cms-tags").description);
  await api("PATCH", `/nodes/${folder.id}/metadata`, {
    metadata: {
      busabaseCms: {
        schemaVersion: 1,
        profile: "standard",
        bases: {
          posts: posts.baseId,
          pages: pages.baseId,
          categories: CATEGORIES_ID,
          tags: TAGS_ID,
        },
      },
    },
  });
  process.stdout.write("  ~ canonical CMS metadata\n");
};

const cleanup = async () => {
  await archiveBase(DUPLICATE_POSTS_ID, "Posts");
  await archiveBase(DUPLICATE_PAGES_ID, "Pages");
  const nodes = flattenNodes(await api<CmsNode[]>("GET", "/nodes"));
  const duplicate = nodes.find(
    (node) => node.type === "folder" && node.slug === DUPLICATE_FOLDER_SLUG,
  );
  if (!duplicate) return;
  const changeRequest = await api<{ id: string; status: string }>(
    "POST",
    "/nodes/change-requests",
    {
      message: "Archive duplicate Next.js Fumadocs CMS Folder",
      submittedBy: SUBMITTED_BY,
      operations: [{ kind: "delete", nodeId: duplicate.id }],
    },
  );
  assert(changeRequest.status === "in_review", "expected duplicate Folder delete in review");
  await approveMerge(changeRequest.id);
  process.stdout.write("  - duplicate CMS Folder\n");
};

const verify = async () => {
  const nodes = flattenNodes(await api<CmsNode[]>("GET", "/nodes"));
  const folders = nodes.filter(
    (node) =>
      node.type === "folder" && [CANONICAL_FOLDER_SLUG, DUPLICATE_FOLDER_SLUG].includes(node.slug),
  );
  const bases = await api<BaseVO[]>("GET", "/bases");
  const posts = bases.find((base) => base.slug === POSTS_SLUG);
  const pages = bases.find((base) => base.slug === PAGES_SLUG);
  assert(posts !== undefined && pages !== undefined, "canonical Posts or Pages is missing");
  const postRecords = await listRecords(posts.id);
  const pageRecords = await listRecords(pages.id);
  console.log(
    JSON.stringify(
      {
        baseUrl: BASE,
        cmsFolders: folders.map((folder) => ({
          id: folder.id,
          slug: folder.slug,
          name: folder.name,
        })),
        posts: {
          id: posts.id,
          name: posts.name,
          fields: posts.fields.length,
          records: postRecords.length,
        },
        pages: {
          id: pages.id,
          name: pages.name,
          fields: pages.fields.length,
          records: pageRecords.length,
        },
        categoriesActive: bases.some((base) => base.id === CATEGORIES_ID),
        tagsActive: bases.some((base) => base.id === TAGS_ID),
      },
      null,
      2,
    ),
  );
};

const main = async () => {
  console.log(`\nCMS converge (${phase}) -> ${BASE}\n`);
  if (phase === "prepare") await prepare();
  if (phase === "cutover") await cutover();
  if (phase === "cleanup") await cleanup();
  await verify();
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
