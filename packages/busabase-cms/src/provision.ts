import { BusabaseCmsSchemaDriftError, BusabaseCmsSetupError } from "./errors";
import {
  BUSABASE_CMS_METADATA_KEY,
  BUSABASE_CMS_ROLES,
  BUSABASE_CMS_SCHEMA_PROFILES,
  BUSABASE_CMS_SCHEMA_VERSION,
  type BusabaseCmsBaseIds,
  type BusabaseCmsBaseRole,
  type BusabaseCmsFieldDefinition,
  type BusabaseCmsFolderMetadata,
  type BusabaseCmsSchemaProfile,
  getBusabaseCmsBaseDefinition,
} from "./schema";
import type {
  BusabaseCmsBase,
  BusabaseCmsField,
  BusabaseCmsNode,
  BusabaseCmsSource,
} from "./source";

interface FolderResolverOptions {
  source: BusabaseCmsSource;
  folderId: string;
  lazyCreate: boolean;
  schemaProfile: BusabaseCmsSchemaProfile;
}

interface ProvisioningSource extends BusabaseCmsSource {
  getBaseById: NonNullable<BusabaseCmsSource["getBaseById"]>;
  getNode: NonNullable<BusabaseCmsSource["getNode"]>;
  listDirectChildren: NonNullable<BusabaseCmsSource["listDirectChildren"]>;
  updateNodeMetadata: NonNullable<BusabaseCmsSource["updateNodeMetadata"]>;
}

interface LazyProvisioningSource extends ProvisioningSource {
  createBase: NonNullable<BusabaseCmsSource["createBase"]>;
  createField: NonNullable<BusabaseCmsSource["createField"]>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseMetadata = (folder: BusabaseCmsNode): BusabaseCmsFolderMetadata | null => {
  const raw = folder.metadata[BUSABASE_CMS_METADATA_KEY];
  if (raw === undefined) return null;
  if (!isRecord(raw) || raw.schemaVersion !== BUSABASE_CMS_SCHEMA_VERSION || !isRecord(raw.bases)) {
    throw new BusabaseCmsSchemaDriftError(
      `Folder "${folder.name}" has unsupported ${BUSABASE_CMS_METADATA_KEY} metadata`,
    );
  }

  const rawBases = raw.bases as Record<string, unknown>;
  const profile = raw.profile === undefined ? "standard" : raw.profile;
  if (
    typeof profile !== "string" ||
    !BUSABASE_CMS_SCHEMA_PROFILES.includes(profile as BusabaseCmsSchemaProfile)
  ) {
    throw new BusabaseCmsSchemaDriftError(
      `Folder "${folder.name}" has unsupported Busabase CMS profile metadata`,
    );
  }
  const bases = Object.fromEntries(
    BUSABASE_CMS_ROLES.map((role) => [role, rawBases[role]]),
  ) as Record<BusabaseCmsBaseRole, unknown>;
  for (const role of BUSABASE_CMS_ROLES) {
    if (typeof bases[role] !== "string" || bases[role].length === 0) {
      throw new BusabaseCmsSchemaDriftError(
        `Folder "${folder.name}" metadata is missing the ${role} Base ID`,
      );
    }
  }
  return {
    schemaVersion: BUSABASE_CMS_SCHEMA_VERSION,
    profile: profile as BusabaseCmsSchemaProfile,
    bases: bases as BusabaseCmsBaseIds,
  };
};

const assertMetadataProfile = (
  folder: BusabaseCmsNode,
  metadata: BusabaseCmsFolderMetadata,
  requested: BusabaseCmsSchemaProfile,
) => {
  const stored = metadata.profile ?? "standard";
  if (stored !== requested) {
    throw new BusabaseCmsSchemaDriftError(
      `Folder "${folder.name}" is bound to the ${stored} CMS profile, not ${requested}`,
    );
  }
};

const requireProvisioningSource = (source: BusabaseCmsSource): ProvisioningSource => {
  if (
    !source.getBaseById ||
    !source.getNode ||
    !source.listDirectChildren ||
    !source.updateNodeMetadata
  ) {
    throw new BusabaseCmsSetupError(
      "folderId requires a Busabase client/config or a source with node, Base, and metadata discovery methods",
    );
  }
  return source as ProvisioningSource;
};

const requireLazyProvisioningSource = (source: ProvisioningSource): LazyProvisioningSource => {
  if (!source.createBase || !source.createField) {
    throw new BusabaseCmsSetupError(
      "lazyCreate requires direct Base and field creation methods from the Busabase SDK",
    );
  }
  return source as LazyProvisioningSource;
};

const getFolder = async (source: ProvisioningSource, folderId: string) => {
  const folder = await source.getNode(folderId);
  if (!folder) throw new BusabaseCmsSetupError(`Busabase CMS Folder "${folderId}" was not found`);
  if (folder.type !== "folder") {
    throw new BusabaseCmsSetupError(`Busabase CMS node "${folderId}" is not a Folder`);
  }
  return folder;
};

const getDirectBaseNodes = async (source: ProvisioningSource, folderId: string) =>
  (await source.listDirectChildren(folderId)).filter(
    (node) => node.parentId === folderId && node.type === "base" && Boolean(node.baseId),
  );

const normalizeName = (value: string) => value.trim().toLocaleLowerCase();

const roleAliases: Record<BusabaseCmsBaseRole, string[]> = {
  posts: ["posts / 文章", "posts", "文章", "blog posts", "blog posts / 博客文章", "博客文章"],
  pages: ["pages / 页面", "pages", "页面"],
  categories: ["categories / 分类", "categories", "分类"],
  tags: ["tags / 标签", "tags", "标签"],
};

const candidateScore = (
  role: BusabaseCmsBaseRole,
  folder: BusabaseCmsNode,
  node: BusabaseCmsNode,
) => {
  const name = normalizeName(node.name);
  const expectedSlug = `${folder.slug}-${role}`;
  if (roleAliases[role].includes(name)) return 100;
  if (role === "posts" && node.slug === "blog") return 90;
  if (node.slug === expectedSlug) return 80;
  if (node.slug === `busabase-cms-${role}`) return 70;
  return 0;
};

const adoptExistingBases = async (
  source: ProvisioningSource,
  folder: BusabaseCmsNode,
  nodes: BusabaseCmsNode[],
): Promise<Partial<BusabaseCmsBaseIds>> => {
  const available: Array<{ node: BusabaseCmsNode; base: BusabaseCmsBase }> = [];
  for (const node of nodes) {
    const base = await source.getBaseById(node.baseId as string);
    if (base) available.push({ node, base });
  }

  const adopted: Partial<BusabaseCmsBaseIds> = {};
  const used = new Set<string>();
  for (const role of BUSABASE_CMS_ROLES) {
    const candidates = available
      .filter(({ base }) => !used.has(base.id))
      .map((candidate) => ({
        ...candidate,
        score: candidateScore(role, folder, candidate.node),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score);
    if (!candidates[0]) continue;
    if (candidates[1]?.score === candidates[0].score) {
      throw new BusabaseCmsSetupError(
        `Could not uniquely identify the ${role} Base below Folder "${folder.name}"`,
      );
    }
    adopted[role] = candidates[0].base.id;
    used.add(candidates[0].base.id);
  }
  return adopted;
};

const validateMetadataBases = async (
  source: ProvisioningSource,
  folder: BusabaseCmsNode,
  nodes: BusabaseCmsNode[],
  baseIds: BusabaseCmsBaseIds,
) => {
  const nodeByBaseId = new Map(nodes.map((node) => [node.baseId as string, node]));
  for (const role of BUSABASE_CMS_ROLES) {
    const baseId = baseIds[role];
    const node = nodeByBaseId.get(baseId);
    if (!node || node.parentId !== folder.id) {
      throw new BusabaseCmsSchemaDriftError(
        `Folder metadata maps ${role} to Base "${baseId}", but it is not a direct child`,
      );
    }
    if (!(await source.getBaseById(baseId))) {
      throw new BusabaseCmsSchemaDriftError(
        `Folder metadata maps ${role} to missing Base "${baseId}"`,
      );
    }
  }
};

const sameStringSet = (actual: string[] | undefined, expected: string[] | undefined) => {
  if (!expected) return true;
  if (!actual) return false;
  return [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
};

const mimePatternIsWithin = (actual: string, expected: string) => {
  actual = actual.trim().toLocaleLowerCase();
  expected = expected.trim().toLocaleLowerCase();
  if (actual === expected || expected === "*/*") return true;
  if (!expected.endsWith("/*")) return false;
  if (actual.endsWith("/*")) return actual === expected;
  return actual.startsWith(expected.slice(0, -1));
};

/** An existing attachment policy may be stricter, but never broader, than the CMS contract. */
const mimePolicyIsCompatible = (actual: string[] | undefined, expected: string[] | undefined) => {
  if (!expected || expected.length === 0) return true;
  if (!actual || actual.length === 0) return false;
  return actual.every((actualPattern) =>
    expected.some((expectedPattern) => mimePatternIsWithin(actualPattern, expectedPattern)),
  );
};

const upperBoundIsCompatible = (actual: number | undefined, expected: number | undefined) => {
  if (expected === undefined) return true;
  return actual !== undefined && actual <= expected;
};

interface FieldDriftContext {
  role: BusabaseCmsBaseRole;
  schemaProfile: BusabaseCmsSchemaProfile;
  allowLegacyExisting: boolean;
}

const allowsLegacyOptionalRequiredField = (
  expected: BusabaseCmsFieldDefinition,
  context: FieldDriftContext,
) =>
  context.allowLegacyExisting &&
  context.schemaProfile === "buda" &&
  context.role === "pages" &&
  expected.slug === "body";

const fieldDrift = (
  actual: BusabaseCmsField,
  expected: BusabaseCmsFieldDefinition,
  context: FieldDriftContext,
): string[] => {
  const drift: string[] = [];
  if (actual.type !== expected.type)
    drift.push(`type is ${actual.type}, expected ${expected.type}`);
  if (
    expected.required &&
    !actual.required &&
    !allowsLegacyOptionalRequiredField(expected, context)
  ) {
    drift.push(`required is ${actual.required}, expected ${expected.required}`);
  }
  if (
    expected.options.multiple !== undefined &&
    actual.options.multiple !== expected.options.multiple
  ) {
    drift.push(
      `multiple is ${String(actual.options.multiple)}, expected ${expected.options.multiple}`,
    );
  }
  if (
    expected.options.targetBaseId &&
    actual.options.targetBaseId !== expected.options.targetBaseId
  ) {
    drift.push(
      `targetBaseId is ${String(actual.options.targetBaseId)}, expected ${expected.options.targetBaseId}`,
    );
  }
  if (expected.options.choices) {
    const actualIds = actual.options.choices?.map((choice) => choice.id);
    const expectedIds = expected.options.choices.map((choice) => choice.id);
    if (!sameStringSet(actualIds, expectedIds)) drift.push("select choices do not match");
  }
  const attachment = expected.options.attachment;
  if (attachment) {
    const actualAttachment = actual.options.attachment;
    if (!upperBoundIsCompatible(actualAttachment?.maxFiles, attachment.maxFiles)) {
      drift.push("attachment maxFiles is broader than expected");
    }
    if (!upperBoundIsCompatible(actualAttachment?.maxFileSize, attachment.maxFileSize)) {
      drift.push("attachment maxFileSize is broader than expected");
    }
    if (!mimePolicyIsCompatible(actualAttachment?.allowedMimeTypes, attachment.allowedMimeTypes)) {
      drift.push("attachment allowedMimeTypes are broader than expected");
    }
  }
  return drift;
};

interface MissingField {
  role: BusabaseCmsBaseRole;
  baseId: string;
  field: BusabaseCmsFieldDefinition;
}

const preflightBaseFields = async (
  source: ProvisioningSource,
  role: BusabaseCmsBaseRole,
  baseIds: Partial<BusabaseCmsBaseIds>,
  schemaProfile: BusabaseCmsSchemaProfile,
  allowLegacyExisting: boolean,
) => {
  const expected = getBusabaseCmsBaseDefinition(role, baseIds, schemaProfile);
  const baseId = baseIds[role];
  if (!baseId) throw new BusabaseCmsSetupError(`Busabase CMS ${role} Base was not resolved`);
  const base = await source.getBaseById(baseId);
  if (!base) throw new BusabaseCmsSetupError(`Busabase CMS ${role} Base was not found`);
  const missing: MissingField[] = [];

  for (const field of expected.fields) {
    const actual = base.fields.find((candidate) => candidate.slug === field.slug);
    if (!actual) {
      missing.push({ role, baseId: base.id, field });
      continue;
    }
    const drift = fieldDrift(actual, field, { role, schemaProfile, allowLegacyExisting });
    if (field.type === "relation" && !field.options.targetBaseId) {
      drift.push("target Base cannot be validated before its CMS role is resolved");
    }
    if (drift.length > 0) {
      throw new BusabaseCmsSchemaDriftError(
        `Busabase CMS ${role}.${field.slug} schema drift: ${drift.join("; ")}`,
      );
    }
  }
  return missing;
};

const preflightAllFields = async (
  source: ProvisioningSource,
  baseIds: BusabaseCmsBaseIds,
  schemaProfile: BusabaseCmsSchemaProfile,
  allowLegacyExisting: boolean,
) => {
  const missing: MissingField[] = [];
  for (const role of BUSABASE_CMS_ROLES) {
    missing.push(
      ...(await preflightBaseFields(source, role, baseIds, schemaProfile, allowLegacyExisting)),
    );
  }
  return missing;
};

const preflightResolvedFields = async (
  source: ProvisioningSource,
  baseIds: Partial<BusabaseCmsBaseIds>,
  schemaProfile: BusabaseCmsSchemaProfile,
) => {
  for (const role of BUSABASE_CMS_ROLES) {
    if (baseIds[role]) await preflightBaseFields(source, role, baseIds, schemaProfile, true);
  }
};

const createMissingFields = async (
  source: LazyProvisioningSource,
  missing: MissingField[],
  schemaProfile: BusabaseCmsSchemaProfile,
) => {
  for (const { role, baseId, field } of missing) {
    try {
      const base = await source.createField({ baseId, ...field });
      const actual = base.fields.find((candidate) => candidate.slug === field.slug);
      if (!actual) {
        throw new BusabaseCmsSetupError(
          `Busabase did not materialize field "${field.slug}" in the ${role} Base`,
        );
      }
      const drift = fieldDrift(actual, field, {
        role,
        schemaProfile,
        allowLegacyExisting: false,
      });
      if (drift.length > 0) {
        throw new BusabaseCmsSchemaDriftError(
          `Busabase CMS ${role}.${field.slug} schema drift: ${drift.join("; ")}`,
        );
      }
    } catch (cause) {
      if (cause instanceof BusabaseCmsSchemaDriftError) throw cause;
      const refreshed = await source.getBaseById(baseId);
      const actual = refreshed?.fields.find((candidate) => candidate.slug === field.slug);
      if (!actual) {
        throw new BusabaseCmsSetupError(
          `Could not create field "${field.slug}" in the ${role} Base`,
          { cause },
        );
      }
      const drift = fieldDrift(actual, field, {
        role,
        schemaProfile,
        allowLegacyExisting: false,
      });
      if (drift.length > 0) {
        throw new BusabaseCmsSchemaDriftError(
          `Busabase CMS ${role}.${field.slug} schema drift: ${drift.join("; ")}`,
          { cause },
        );
      }
    }
  }
};

const findCreatedBase = async (
  source: ProvisioningSource,
  folder: BusabaseCmsNode,
  role: BusabaseCmsBaseRole,
) => {
  const expectedName = roleAliases[role][0] as string;
  const expectedSlug = `${folder.slug}-${role}`;
  const nodes = await getDirectBaseNodes(source, folder.id);
  const node = nodes.find(
    (candidate) =>
      candidate.slug === expectedSlug || normalizeName(candidate.name) === expectedName,
  );
  return node?.baseId ? source.getBaseById(node.baseId) : null;
};

const createMissingBase = async (
  source: LazyProvisioningSource,
  folder: BusabaseCmsNode,
  role: BusabaseCmsBaseRole,
  baseIds: Partial<BusabaseCmsBaseIds>,
  schemaProfile: BusabaseCmsSchemaProfile,
) => {
  const definition = getBusabaseCmsBaseDefinition(role, baseIds, schemaProfile);
  try {
    const created = await source.createBase({
      parentNodeId: folder.id,
      slug: `${folder.slug}-${role}`,
      name: definition.name,
      description: definition.description,
      fields: definition.fields,
      autoMerge: true,
    });
    if (!created.id || !created.nodeId) {
      throw new BusabaseCmsSetupError(
        `Busabase did not immediately materialize the ${role} Base with autoMerge`,
      );
    }
    return created;
  } catch (cause) {
    const concurrent = await findCreatedBase(source, folder, role);
    if (concurrent) return concurrent;
    if (cause instanceof BusabaseCmsSetupError) throw cause;
    throw new BusabaseCmsSetupError(`Could not create the Busabase CMS ${role} Base`, { cause });
  }
};

const saveMetadata = async (
  source: ProvisioningSource,
  folder: BusabaseCmsNode,
  baseIds: BusabaseCmsBaseIds,
  schemaProfile: BusabaseCmsSchemaProfile,
) => {
  const value: BusabaseCmsFolderMetadata = {
    schemaVersion: BUSABASE_CMS_SCHEMA_VERSION,
    profile: schemaProfile,
    bases: baseIds,
  };
  try {
    await source.updateNodeMetadata({
      nodeId: folder.id,
      metadata: { [BUSABASE_CMS_METADATA_KEY]: value },
    });
  } catch (cause) {
    const refreshed = await source.getNode(folder.id);
    const concurrent = refreshed ? parseMetadata(refreshed) : null;
    if (
      concurrent &&
      (concurrent.profile ?? "standard") === schemaProfile &&
      BUSABASE_CMS_ROLES.every((role) => concurrent.bases[role] === baseIds[role])
    ) {
      return;
    }
    throw new BusabaseCmsSetupError("Could not persist the Busabase CMS Base ID mapping", {
      cause,
    });
  }
};

const resolveFolderBases = async ({
  source: rawSource,
  folderId,
  lazyCreate,
  schemaProfile,
}: FolderResolverOptions): Promise<BusabaseCmsBaseIds> => {
  const source = requireProvisioningSource(rawSource);
  const folder = await getFolder(source, folderId);
  let nodes = await getDirectBaseNodes(source, folderId);
  const metadata = parseMetadata(folder);
  if (metadata) {
    assertMetadataProfile(folder, metadata, schemaProfile);
    await validateMetadataBases(source, folder, nodes, metadata.bases);
    const missing = await preflightAllFields(source, metadata.bases, schemaProfile, true);
    if (missing.length > 0 && !lazyCreate) {
      const first = missing[0];
      throw new BusabaseCmsSetupError(
        `Busabase CMS ${first.role} Base is missing required field "${first.field.slug}"; enable lazyCreate to add it`,
      );
    }
    if (missing.length > 0) {
      await createMissingFields(requireLazyProvisioningSource(source), missing, schemaProfile);
      const remaining = await preflightAllFields(source, metadata.bases, schemaProfile, true);
      if (remaining.length > 0) {
        throw new BusabaseCmsSetupError("Busabase did not materialize the complete CMS schema");
      }
    }
    return metadata.bases;
  }

  const resolved = await adoptExistingBases(source, folder, nodes);
  const createdRoles = new Set<BusabaseCmsBaseRole>();
  // Validate every existing Base before the first direct schema write. Missing fields are
  // collected again after all Base IDs are known, so a later drift can never leave partial fields.
  await preflightResolvedFields(source, resolved, schemaProfile);
  for (const role of BUSABASE_CMS_ROLES) {
    if (resolved[role]) continue;
    if (!lazyCreate) {
      throw new BusabaseCmsSetupError(
        `Folder "${folder.name}" is missing the ${role} Base; enable lazyCreate to create it`,
      );
    }
    const writable = requireLazyProvisioningSource(source);
    const created = await createMissingBase(writable, folder, role, resolved, schemaProfile);
    resolved[role] = created.id;
    createdRoles.add(role);
    nodes = await getDirectBaseNodes(source, folderId);
  }

  const baseIds = resolved as BusabaseCmsBaseIds;
  await validateMetadataBases(source, folder, nodes, baseIds);
  for (const role of createdRoles) {
    await preflightBaseFields(source, role, baseIds, schemaProfile, false);
  }
  const missing = await preflightAllFields(source, baseIds, schemaProfile, true);
  if (missing.length > 0 && !lazyCreate) {
    const first = missing[0];
    throw new BusabaseCmsSetupError(
      `Busabase CMS ${first.role} Base is missing required field "${first.field.slug}"; enable lazyCreate to add it`,
    );
  }
  if (missing.length > 0) {
    await createMissingFields(requireLazyProvisioningSource(source), missing, schemaProfile);
    const remaining = await preflightAllFields(source, baseIds, schemaProfile, true);
    if (remaining.length > 0) {
      throw new BusabaseCmsSetupError("Busabase did not materialize the complete CMS schema");
    }
  }
  await saveMetadata(source, folder, baseIds, schemaProfile);
  return baseIds;
};

export const createBusabaseCmsBaseResolver = (options: FolderResolverOptions) => {
  let resolution: Promise<BusabaseCmsBaseIds> | undefined;
  const resolve = () => {
    resolution ??= resolveFolderBases(options).catch((error) => {
      resolution = undefined;
      throw error;
    });
    return resolution;
  };
  return async (role: BusabaseCmsBaseRole) => (await resolve())[role];
};
