import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type {
  CreatedEmbedLinkVO,
  CreateEmbedLinkDTO,
  EmbedFramePolicyVO,
  EmbedLinkVO,
  EmbedTargetType,
  ListEmbedLinksDTO,
} from "busabase-contract/contract/embed-link-schemas";
import {
  EmbedFramePolicyVOSchema,
  EmbedNodeTypeSchema,
  EmbedTargetTypeSchema,
} from "busabase-contract/contract/embed-link-schemas";
import type { FileTreeReadFileVO } from "busabase-contract/types";
import { and, desc, eq, isNull } from "drizzle-orm";
import {
  getContextEmbedOrigin,
  getContextSourceProvenance,
  getContextSpaceId,
  resolveActorId,
  resolveEmbedActorState,
  runWithEmbedContext,
} from "../../context";
import { getDb } from "../../db";
import { busabaseBases, busabaseEmbedLinks, busabaseNodes } from "../../db/schema";
import { getChangeRequest } from "../../logic/cr-lifecycle";
import { getEffectiveNodeLevel } from "../../logic/node-acl";
import { getAirApp, readAirAppFile } from "../airapp/handlers";
import { getBase, getRecord, listRecordsPaged } from "../base/handlers";
import { getDoc } from "../doc/handlers";
import { getDrive, readDriveFile } from "../drive/handlers";
import { getFileNodeDetail } from "../file-node/handlers";
import { getFolder } from "../folder/handlers";
import { getSkill, readSkillFile } from "../skill/handlers";
import { EMBED_PUBLIC_ID_PATTERN, EMBED_SECRET_PATTERN } from "./capability";
import type { AirAppEmbedRuntimeVO, EmbedNodeDetailVO, ResolvedPolymorphicEmbedVO } from "./types";

export { EMBED_PUBLIC_ID_PATTERN, EMBED_SECRET_PATTERN } from "./capability";

const EMBED_LINK_ID_PREFIX = "emb_";
const EMBED_SECRET_BYTES = 32;
const LOCAL_API_KEY_ID = "local";

export const hashEmbedSecret = (secret: string): string =>
  createHash("sha256").update(secret, "utf8").digest("hex");

export const verifyEmbedSecret = (secret: string, expectedHash: string): boolean => {
  const actual = Buffer.from(hashEmbedSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

export const isEmbedLinkActive = (
  link: { expiresAt: Date; revokedAt: Date | null },
  at = new Date(),
): boolean => link.revokedAt === null && link.expiresAt.getTime() > at.getTime();

const makePublicId = () => `${EMBED_LINK_ID_PREFIX}${randomBytes(12).toString("base64url")}`;
const makeSecret = () => randomBytes(EMBED_SECRET_BYTES).toString("base64url");

const DESKTOP_FALLBACK_ORIGIN = "http://localhost:15419";

const configuredEmbedOrigin = (): string => {
  // Host-injected first (see `BusabaseContext.embedOrigin`). The env fallback
  // is the open-source Desktop host's own default and must never become
  // Cloud's: Cloud resolves its app URL through `appConfig` and injects it.
  const configured = new URL(
    getContextEmbedOrigin() || process.env.NEXT_PUBLIC_APP_URL || DESKTOP_FALLBACK_ORIGIN,
  );
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(configured.hostname);
  if (configured.protocol !== "https:" && !(isLoopback && configured.protocol === "http:")) {
    throw new Error("Embed link origin must use HTTPS (HTTP is allowed only for loopback hosts)");
  }
  return configured.origin;
};

const configuredEmbedUrl = (id: string, secret: string, view?: "iframe"): string => {
  const url = new URL(`/embed/${encodeURIComponent(id)}`, configuredEmbedOrigin());
  url.searchParams.set("token", secret);
  if (view) url.searchParams.set("view", view);
  return url.toString();
};

interface EmbedTargetMetadata {
  scopeNodeId: string;
  targetName: string;
  nodeType: string | null;
}

const resolveEmbedTargetMetadata = async (
  type: EmbedTargetType,
  typeId: string,
): Promise<EmbedTargetMetadata | null> => {
  const db = await getDb();
  const actorId = resolveActorId("local-user");
  const spaceId = getContextSpaceId();
  let scopeNodeId: string | null = null;
  let targetName = typeId;

  if (type === "node") {
    scopeNodeId = typeId;
  } else if (type === "change-request") {
    const changeRequest = await getChangeRequest(typeId);
    scopeNodeId = changeRequest?.nodeId ?? changeRequest?.base?.nodeId ?? null;
    targetName = changeRequest?.id ?? typeId;
  } else {
    const record = await getRecord(typeId);
    scopeNodeId = record?.base.nodeId ?? null;
    targetName = record?.id ?? typeId;
  }
  if (!scopeNodeId || (await getEffectiveNodeLevel(scopeNodeId, actorId, db)) !== "manage") {
    return null;
  }

  const [node] = await db
    .select({ name: busabaseNodes.name, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, scopeNodeId),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    )
    .limit(1);
  if (!node) return null;

  return {
    scopeNodeId,
    targetName: type === "node" ? node.name : targetName,
    nodeType: type === "node" ? node.type : null,
  };
};

const toEmbedLinkVO = (row: {
  id: string;
  type: EmbedTargetType;
  typeId: string;
  targetName: string;
  nodeType: string | null;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  frameMode: string;
  allowedOrigins: string[];
}): EmbedLinkVO => ({
  id: row.id,
  type: row.type,
  typeId: row.typeId,
  targetName: row.targetName,
  nodeType: row.nodeType ? EmbedNodeTypeSchema.parse(row.nodeType) : null,
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt.toISOString(),
  revokedAt: row.revokedAt?.toISOString() ?? null,
  active: isEmbedLinkActive(row),
  framePolicy: EmbedFramePolicyVOSchema.parse({
    mode: row.frameMode,
    allowedOrigins: row.allowedOrigins,
  }),
});

export const createEmbedLink = async (input: CreateEmbedLinkDTO): Promise<CreatedEmbedLinkVO> => {
  const db = await getDb();
  const target = await resolveEmbedTargetMetadata(input.type, input.typeId);
  if (!target) throw new ORPCError("NOT_FOUND", { message: "Embed target not found" });

  const nodeType = target.nodeType ? EmbedNodeTypeSchema.safeParse(target.nodeType) : null;
  if (nodeType && !nodeType.success) {
    throw new ORPCError("BAD_REQUEST", { message: "Unsupported node type" });
  }

  const id = makePublicId();
  const secret = makeSecret();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.expiresInMinutes * 60_000);
  const source = getContextSourceProvenance();
  const [created] = await db
    .insert(busabaseEmbedLinks)
    .values({
      id,
      spaceId: getContextSpaceId(),
      type: input.type,
      typeId: input.typeId,
      secretHash: hashEmbedSecret(secret),
      createdBy: resolveActorId("local-user"),
      createdByApiKeyId: source?.apiKey?.id ?? LOCAL_API_KEY_ID,
      frameMode: input.framePolicy.mode,
      allowedOrigins: input.framePolicy.allowedOrigins,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const vo = toEmbedLinkVO({
    ...created,
    type: input.type,
    typeId: input.typeId,
    targetName: target.targetName,
    nodeType: nodeType?.success ? nodeType.data : null,
  });
  return {
    ...vo,
    url: configuredEmbedUrl(id, secret),
    iframeUrl: configuredEmbedUrl(id, secret, "iframe"),
  };
};

export const listEmbedLinks = async (input: ListEmbedLinksDTO): Promise<EmbedLinkVO[]> => {
  const db = await getDb();
  const filters = [eq(busabaseEmbedLinks.spaceId, getContextSpaceId())];
  if (input.type) filters.push(eq(busabaseEmbedLinks.type, input.type));
  if (input.typeId) filters.push(eq(busabaseEmbedLinks.typeId, input.typeId));

  const rows = await db
    .select({
      id: busabaseEmbedLinks.id,
      type: busabaseEmbedLinks.type,
      typeId: busabaseEmbedLinks.typeId,
      createdAt: busabaseEmbedLinks.createdAt,
      expiresAt: busabaseEmbedLinks.expiresAt,
      revokedAt: busabaseEmbedLinks.revokedAt,
      frameMode: busabaseEmbedLinks.frameMode,
      allowedOrigins: busabaseEmbedLinks.allowedOrigins,
    })
    .from(busabaseEmbedLinks)
    .where(and(...filters))
    .orderBy(desc(busabaseEmbedLinks.createdAt));

  const visible: EmbedLinkVO[] = [];
  for (const row of rows) {
    const target = await resolveEmbedTargetMetadata(row.type, row.typeId);
    if (target) visible.push(toEmbedLinkVO({ ...row, ...target }));
  }
  return visible;
};

export const revokeEmbedLink = async (id: string): Promise<{ revoked: true }> => {
  const db = await getDb();
  const [link] = await db
    .select({ type: busabaseEmbedLinks.type, typeId: busabaseEmbedLinks.typeId })
    .from(busabaseEmbedLinks)
    .where(and(eq(busabaseEmbedLinks.id, id), eq(busabaseEmbedLinks.spaceId, getContextSpaceId())))
    .limit(1);
  if (!link) throw new ORPCError("NOT_FOUND", { message: "Embed link not found" });
  if (!(await resolveEmbedTargetMetadata(link.type, link.typeId))) {
    throw new ORPCError("NOT_FOUND", { message: "Embed target not found" });
  }

  await db
    .update(busabaseEmbedLinks)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(busabaseEmbedLinks.id, id), eq(busabaseEmbedLinks.spaceId, getContextSpaceId())));
  return { revoked: true };
};

const readEntryFile = async (
  nodeId: string,
  entryFile: string,
  reader: (nodeId: string, path: string) => Promise<FileTreeReadFileVO>,
): Promise<FileTreeReadFileVO | null> => {
  if (!entryFile) return null;
  try {
    return await reader(nodeId, entryFile);
  } catch {
    return null;
  }
};

export const loadEmbedNodeDetail = async (
  nodeId: string,
  nodeType: string,
): Promise<EmbedNodeDetailVO | null> => {
  const db = await getDb();
  if (nodeType === "base") {
    const [baseRow] = await db
      .select({ id: busabaseBases.id })
      .from(busabaseBases)
      .where(and(eq(busabaseBases.nodeId, nodeId), isNull(busabaseBases.deletedAt)))
      .limit(1);
    if (!baseRow) return null;
    const [base, page] = await Promise.all([
      getBase(baseRow.id),
      listRecordsPaged({ baseId: baseRow.id, limit: 50 }),
    ]);
    return base
      ? {
          type: "base",
          base,
          records: page.records.map((record) => ({
            ...record,
            createdByUser: record.createdByUser ?? null,
            headCommit: {
              ...record.headCommit,
              authorUser: record.headCommit.authorUser ?? null,
            },
          })),
          recordsTruncated: page.nextCursor !== null,
        }
      : null;
  }
  if (nodeType === "doc") return { type: "doc", doc: await getDoc(nodeId) };
  if (nodeType === "file") return { type: "file", file: await getFileNodeDetail(nodeId) };
  if (nodeType === "drive") {
    const drive = await getDrive(nodeId);
    return {
      type: "drive",
      drive: { ...drive, skippedGitignorePaths: drive.skippedGitignorePaths ?? [] },
      entryFile: await readEntryFile(nodeId, drive.entryFile, readDriveFile),
    };
  }
  if (nodeType === "skill") {
    const skill = await getSkill(nodeId);
    return {
      type: "skill",
      skill: { ...skill, skippedGitignorePaths: skill.skippedGitignorePaths ?? [] },
      entryFile: await readEntryFile(nodeId, skill.entryFile, readSkillFile),
    };
  }
  if (nodeType === "folder") {
    const folder = await getFolder(nodeId);
    return {
      type: "folder",
      folder: { ...folder, children: folder.children.filter((child) => child.type !== "airapp") },
    };
  }
  if (nodeType === "airapp") {
    const airapp = await getAirApp(nodeId);
    return {
      type: "airapp",
      airapp: { ...airapp, skippedGitignorePaths: airapp.skippedGitignorePaths ?? [] },
    };
  }
  return null;
};

interface ResolvedEmbedLinkRecord {
  id: string;
  spaceId: string;
  type: EmbedTargetType;
  typeId: string;
  createdBy: string;
  createdByApiKeyId: string;
  expiresAt: Date;
  framePolicy: EmbedFramePolicyVO;
}

const resolveEmbedLinkRecord = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<ResolvedEmbedLinkRecord | null> => {
  if (!EMBED_PUBLIC_ID_PATTERN.test(id) || !EMBED_SECRET_PATTERN.test(secret)) return null;
  const db = await getDb();
  const [row] = await db
    .select({
      id: busabaseEmbedLinks.id,
      spaceId: busabaseEmbedLinks.spaceId,
      type: busabaseEmbedLinks.type,
      typeId: busabaseEmbedLinks.typeId,
      secretHash: busabaseEmbedLinks.secretHash,
      createdBy: busabaseEmbedLinks.createdBy,
      createdByApiKeyId: busabaseEmbedLinks.createdByApiKeyId,
      frameMode: busabaseEmbedLinks.frameMode,
      allowedOrigins: busabaseEmbedLinks.allowedOrigins,
      expiresAt: busabaseEmbedLinks.expiresAt,
      revokedAt: busabaseEmbedLinks.revokedAt,
    })
    .from(busabaseEmbedLinks)
    .where(eq(busabaseEmbedLinks.id, id))
    .limit(1);
  if (!row || !isEmbedLinkActive(row, at) || !verifyEmbedSecret(secret, row.secretHash)) {
    return null;
  }
  const type = EmbedTargetTypeSchema.safeParse(row.type);
  const framePolicy = EmbedFramePolicyVOSchema.safeParse({
    mode: row.frameMode,
    allowedOrigins: row.allowedOrigins,
  });
  return type.success && framePolicy.success
    ? { ...row, type: type.data, framePolicy: framePolicy.data }
    : null;
};

export type ResolvedEmbedLink = ResolvedPolymorphicEmbedVO;

export interface EmbedRequestContext {
  actorId: string;
  spaceId: string;
  restrictedVisibility: boolean;
}

/**
 * Resolve a capability to its row PLUS the host's verdict on the credential
 * behind it, or null if either says no.
 *
 * The pairing is the point. A row on its own only proves the secret matches an
 * unexpired, unrevoked link; whether its CREATOR is still a member, still
 * unbanned, and still holds a live API key is `resolveEmbedActorState`'s
 * answer, and every caller needs both. Keeping them apart meant each entry
 * point re-spelled the same two checks, and a future one could quietly ship
 * with only the first.
 */
const resolveActiveEmbedLink = async (id: string, secret: string, at: Date) => {
  const row = await resolveEmbedLinkRecord(id, secret, at);
  if (!row) return null;
  const actorState = await resolveEmbedActorState({
    actorId: row.createdBy,
    spaceId: row.spaceId,
    apiKeyId: row.createdByApiKeyId,
  });
  return actorState.active ? { row, actorState } : null;
};

export const resolveEmbedRequestContext = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<EmbedRequestContext | null> => {
  const active = await resolveActiveEmbedLink(id, secret, at);
  if (!active) return null;
  return {
    actorId: active.row.createdBy,
    spaceId: active.row.spaceId,
    restrictedVisibility: active.actorState.restrictedVisibility,
  };
};

export const resolveEmbedLink = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<ResolvedEmbedLink | null> => {
  const active = await resolveActiveEmbedLink(id, secret, at);
  if (!active) return null;
  const { row, actorState } = active;
  const db = await getDb();

  const [targetNode] = await db
    .select({ name: busabaseNodes.name, type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, row.typeId),
        eq(busabaseNodes.spaceId, row.spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    )
    .limit(1);
  const base = {
    id: row.id,
    spaceId: row.spaceId,
    typeId: row.typeId,
    targetName: row.type === "node" ? (targetNode?.name ?? row.typeId) : row.typeId,
    expiresAt: row.expiresAt.toISOString(),
    framePolicy: row.framePolicy,
  };

  try {
    return await runWithEmbedContext(
      {
        db,
        actorId: row.createdBy,
        spaceId: row.spaceId,
        restrictedVisibility: actorState.restrictedVisibility,
      },
      async () => {
        if (row.type === "change-request") {
          const changeRequest = await getChangeRequest(row.typeId);
          return changeRequest ? { ...base, type: row.type, changeRequest } : null;
        }
        if (row.type === "record-detail") {
          const record = await getRecord(row.typeId);
          return record ? { ...base, type: row.type, record } : null;
        }
        if (!targetNode || !EmbedNodeTypeSchema.safeParse(targetNode.type).success) return null;
        const detail = await loadEmbedNodeDetail(row.typeId, targetNode.type);
        return detail ? { ...base, type: row.type, detail } : null;
      },
    );
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
    throw error;
  }
};

export interface AirAppEmbedCapability {
  id: string;
  spaceId: string;
  nodeId: string;
  createdBy: string;
  createdByApiKeyId: string;
  expiresAt: Date;
  framePolicy: EmbedFramePolicyVO;
  isSpaceManager: boolean;
  restrictedVisibility: boolean;
}

export const resolveAirAppEmbedCapability = async (
  id: string,
  secret: string,
  expectedNodeId?: string,
  at = new Date(),
): Promise<AirAppEmbedCapability | null> => {
  const row = await resolveEmbedLinkRecord(id, secret, at);
  if (!row || row.type !== "node") return null;
  const db = await getDb();
  const [node] = await db
    .select({ type: busabaseNodes.type })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, row.typeId),
        eq(busabaseNodes.spaceId, row.spaceId),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
      ),
    )
    .limit(1);
  if (node?.type !== "airapp") return null;
  if (expectedNodeId !== undefined && expectedNodeId !== row.typeId) return null;
  const actorState = await resolveEmbedActorState({
    actorId: row.createdBy,
    spaceId: row.spaceId,
    apiKeyId: row.createdByApiKeyId,
  });
  if (!actorState.active) return null;
  return {
    id: row.id,
    spaceId: row.spaceId,
    nodeId: row.typeId,
    createdBy: row.createdBy,
    createdByApiKeyId: row.createdByApiKeyId,
    expiresAt: row.expiresAt,
    framePolicy: row.framePolicy,
    isSpaceManager: actorState.isSpaceManager,
    restrictedVisibility: actorState.restrictedVisibility,
  };
};

export const resolveAirAppEmbedRuntime = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<AirAppEmbedRuntimeVO | null> => {
  const capability = await resolveAirAppEmbedCapability(id, secret, undefined, at);
  if (!capability) return null;
  try {
    return await runWithEmbedContext(
      {
        db: await getDb(),
        actorId: capability.createdBy,
        spaceId: capability.spaceId,
        restrictedVisibility: capability.restrictedVisibility,
      },
      async () => {
        const airapp = await getAirApp(capability.nodeId);
        const entries = await Promise.all(
          airapp.files.map(async (file) => {
            const detail = await readAirAppFile(capability.nodeId, file.path);
            return detail.encoding === "utf8" ? ([file.path, detail.content] as const) : null;
          }),
        );
        return {
          id: capability.id,
          nodeId: capability.nodeId,
          nodeName: airapp.node.name,
          expiresAt: capability.expiresAt.toISOString(),
          framePolicy: capability.framePolicy,
          files: Object.fromEntries(entries.filter((entry) => entry !== null)),
        };
      },
    );
  } catch (error) {
    if (error instanceof ORPCError && error.code === "NOT_FOUND") return null;
    throw error;
  }
};

export interface EmbedCapabilityMetadata {
  expiresAt: Date;
  framePolicy: EmbedFramePolicyVO;
}

export const resolveEmbedCapabilityMetadata = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<EmbedCapabilityMetadata | null> => {
  const row = await resolveEmbedLinkRecord(id, secret, at);
  return row ? { expiresAt: row.expiresAt, framePolicy: row.framePolicy } : null;
};

export const resolveEmbedFramePolicy = async (
  id: string,
  secret: string,
  at = new Date(),
): Promise<EmbedFramePolicyVO | null> =>
  (await resolveEmbedCapabilityMetadata(id, secret, at))?.framePolicy ?? null;
