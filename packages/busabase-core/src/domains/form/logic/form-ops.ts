import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  CreateFormDTO,
  FormShareVO,
  FormVO,
  ListFormsDTO,
  ListFormsVO,
  SubmitFormDTO,
  UpdateFormDTO,
} from "busabase-contract/types";
import { and, desc, eq, inArray, isNull, lt, or, type SQL } from "drizzle-orm";
import { getContextSpaceId, isAnonymousVisitor, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseForms,
  busabaseNodes,
} from "../../../db/schema";
import { id, now } from "../../../logic/kernel";
import {
  assertNodePermission,
  buildNodeVisibilityCondition,
  getPublicScopeOf,
  hasNodePermission,
} from "../../../logic/node-acl";
import { registerNodeRuntime } from "../../../logic/node-runtime";
import { ensureReady } from "../../../logic/seed";
import { createFormSubmissionChangeRequest } from "../../base/logic/record-ops";
import type { FormPO } from "../schema";

const formNotFound = (nodeId: string) =>
  new ORPCError("NOT_FOUND", { message: `Form not found: ${nodeId}` });

const DEFAULT_SHARE: FormShareVO = { isPublic: false, anonymousSubmit: false };

export const FORM_ALREADY_EXISTS_ERROR_CODE = "FORM_ALREADY_EXISTS";
export const FORM_ALREADY_EXISTS_MESSAGE =
  "A form already exists for this node. Use the update form endpoint instead.";
export const INVALID_FORM_CURSOR_ERROR_CODE = "INVALID_FORM_CURSOR";
export const INVALID_FORM_CURSOR_MESSAGE = "The form cursor is invalid.";

/** Identity recorded for submissions that came in without a signed-in user. */
const ANONYMOUS_SUBMITTER = "anonymous";

const toFormVO = (po: FormPO): FormVO => ({
  id: po.id,
  nodeId: po.nodeId,
  spaceId: po.spaceId,
  targetBaseId: po.targetBaseId,
  name: po.name,
  description: po.description,
  bindings: po.bindings ?? [],
  boundFields: [],
  page: po.page ?? {},
  share: { ...DEFAULT_SHARE, ...(po.share ?? {}) },
  submissionCount: po.submissionCount ?? 0,
  status: po.status === "archived" ? "archived" : "active",
  createdBy: po.createdBy,
  createdAt: po.createdAt.toISOString(),
  updatedAt: po.updatedAt.toISOString(),
});

const formAlreadyExists = (nodeId: string) =>
  new ORPCError("CONFLICT", {
    message: FORM_ALREADY_EXISTS_MESSAGE,
    data: { errorCode: FORM_ALREADY_EXISTS_ERROR_CODE, nodeId },
  });

const encodeFormCursor = (createdAt: Date, formId: string): string =>
  Buffer.from(`${createdAt.toISOString()}|${formId}`, "utf8").toString("base64");

const decodeFormCursor = (cursor: string): { createdAt: Date; id: string } | null => {
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    const separator = decoded.indexOf("|");
    if (separator < 0) return null;
    const createdAt = new Date(decoded.slice(0, separator));
    const id = decoded.slice(separator + 1);
    if (Number.isNaN(createdAt.getTime()) || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
};

export const listForms = async (input: ListFormsDTO): Promise<ListFormsVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [targetBase] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(and(eq(busabaseBases.id, input.targetBaseId), eq(busabaseBases.spaceId, spaceId)))
    .limit(1);
  if (!targetBase) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${input.targetBaseId}` });
  }
  await assertNodePermission(targetBase.nodeId, "read");

  const visible = buildNodeVisibilityCondition(db);
  const filters: SQL[] = [
    eq(busabaseForms.spaceId, spaceId),
    eq(busabaseForms.targetBaseId, input.targetBaseId),
    eq(busabaseForms.status, "active"),
    isNull(busabaseForms.archivedAt),
    eq(busabaseNodes.spaceId, spaceId),
    eq(busabaseNodes.type, "form"),
    isNull(busabaseNodes.archivedAt),
    isNull(busabaseNodes.deletedAt),
    ...(visible ? [visible] : []),
  ];
  if (input.cursor) {
    const cursor = decodeFormCursor(input.cursor);
    if (!cursor) {
      throw new ORPCError("BAD_REQUEST", {
        message: INVALID_FORM_CURSOR_MESSAGE,
        data: { errorCode: INVALID_FORM_CURSOR_ERROR_CODE },
      });
    }
    filters.push(
      or(
        lt(busabaseForms.createdAt, cursor.createdAt),
        and(eq(busabaseForms.createdAt, cursor.createdAt), lt(busabaseForms.id, cursor.id)),
      ) as SQL,
    );
  }

  const limit = input.limit ?? 50;
  const rows = await db
    .select({ form: busabaseForms })
    .from(busabaseForms)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseForms.nodeId))
    .where(and(...filters))
    .orderBy(desc(busabaseForms.createdAt), desc(busabaseForms.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1]?.form;
  return {
    forms: page.map((row) => toFormVO(row.form)),
    nextCursor: hasMore && last ? encodeFormCursor(last.createdAt, last.id) : null,
  };
};

/**
 * Load an active form by its node id OR the node's slug (the detail route passes
 * whichever `:slug` param is in the URL, which is the node slug). Space-scoped.
 */
export const getFormByNodeId = async (nodeIdOrSlug: string): Promise<FormVO | null> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const visible = buildNodeVisibilityCondition(db);
  const [row] = await db
    .select({ form: busabaseForms })
    .from(busabaseForms)
    .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseForms.nodeId))
    .where(
      and(
        eq(busabaseForms.spaceId, spaceId),
        eq(busabaseForms.status, "active"),
        isNull(busabaseForms.archivedAt),
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "form"),
        isNull(busabaseNodes.archivedAt),
        isNull(busabaseNodes.deletedAt),
        or(eq(busabaseForms.nodeId, nodeIdOrSlug), eq(busabaseNodes.slug, nodeIdOrSlug)),
        visible,
      ),
    )
    .orderBy(desc(busabaseForms.createdAt), desc(busabaseForms.id))
    .limit(1);
  if (!row) return null;
  const form = toFormVO(row.form);
  if (isAnonymousVisitor() && !form.share.isPublic) return null;
  const [targetBase] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(and(eq(busabaseBases.id, row.form.targetBaseId), eq(busabaseBases.spaceId, spaceId)))
    .limit(1);
  if (!targetBase) return null;
  // A public Form is the disclosure boundary: visitors may render its curated
  // page and bindings without gaining read access to the private target Base.
  // Members still need normal Base visibility so a Form cannot reveal a Base
  // that has been hidden from them.
  if (!isAnonymousVisitor() && !(await hasNodePermission(targetBase.nodeId, "read"))) return null;

  const boundSlugs = [...new Set(form.bindings.map((binding) => binding.fieldSlug))];
  const boundFieldRows =
    boundSlugs.length === 0
      ? []
      : await db
          .select({
            slug: busabaseBaseFields.slug,
            name: busabaseBaseFields.name,
            type: busabaseBaseFields.type,
            options: busabaseBaseFields.options,
          })
          .from(busabaseBaseFields)
          .where(
            and(
              eq(busabaseBaseFields.baseId, form.targetBaseId),
              inArray(busabaseBaseFields.slug, boundSlugs),
              isNull(busabaseBaseFields.deletedAt),
            ),
          );
  const fieldsBySlug = new Map(boundFieldRows.map((field) => [field.slug, field]));

  return {
    ...form,
    boundFields: form.bindings.flatMap((binding) => {
      const field = fieldsBySlug.get(binding.fieldSlug);
      return field
        ? [
            {
              slug: field.slug,
              name: field.name,
              type: field.type,
              choices: (field.options.choices ?? []).map((choice) => ({
                id: choice.id,
                name: choice.name,
              })),
            },
          ]
        : [];
    }),
  };
};

export const createForm = async (input: CreateFormDTO): Promise<FormVO> => {
  await ensureReady();
  await assertNodePermission(input.nodeId, "manage");
  const db = await getDb();
  const [targetBase] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(
      and(eq(busabaseBases.id, input.targetBaseId), eq(busabaseBases.spaceId, getContextSpaceId())),
    )
    .limit(1);
  if (!targetBase) {
    throw new ORPCError("NOT_FOUND", { message: `Base not found: ${input.targetBaseId}` });
  }
  await assertNodePermission(targetBase.nodeId, "manage");
  const [existing] = await db
    .select({ id: busabaseForms.id })
    .from(busabaseForms)
    .where(
      and(eq(busabaseForms.nodeId, input.nodeId), eq(busabaseForms.spaceId, getContextSpaceId())),
    )
    .limit(1);
  if (existing) {
    throw formAlreadyExists(input.nodeId);
  }
  const timestamp = now();
  const formId = id("fom");
  const [created] = await db
    .insert(busabaseForms)
    .values({
      id: formId,
      spaceId: getContextSpaceId(),
      nodeId: input.nodeId,
      targetBaseId: input.targetBaseId,
      name: input.name,
      description: input.description ?? "",
      bindings: input.bindings ?? [],
      page: input.page ?? {},
      share: { ...DEFAULT_SHARE, ...(input.share ?? {}) },
      status: "active",
      createdBy: resolveActorId("local-producer"),
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning();
  if (!created) {
    throw new Error("Failed to create form");
  }
  return toFormVO(created);
};

/** Owner-managed config edit (bindings/page/share/name) — NOT a ChangeRequest. */
export const updateForm = async (nodeId: string, input: UpdateFormDTO): Promise<FormVO> => {
  await ensureReady();
  await assertNodePermission(nodeId, "manage");
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(busabaseForms)
    .where(and(eq(busabaseForms.nodeId, nodeId), eq(busabaseForms.spaceId, getContextSpaceId())))
    .orderBy(desc(busabaseForms.createdAt), desc(busabaseForms.id))
    .limit(1);
  if (!existing || existing.status !== "active") {
    throw formNotFound(nodeId);
  }
  const [updated] = await db
    .update(busabaseForms)
    .set({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      bindings: input.bindings ?? existing.bindings,
      page: input.page ?? existing.page,
      share: input.share ? { ...DEFAULT_SHARE, ...input.share } : existing.share,
      updatedAt: now(),
    })
    .where(eq(busabaseForms.id, existing.id))
    .returning();
  if (!updated) {
    throw formNotFound(nodeId);
  }
  return toFormVO(updated);
};

/**
 * Submit a filled-in form. Translates `{inputName: value}` to `{fieldSlug: value}`
 * via the binding contract, applies per-form required overrides, then delegates
 * to the base's `createChangeRequest` — so the submission becomes an
 * approval-first record-create ChangeRequest (validated by validateRecordFields)
 * rather than a direct write.
 *
 * Access is gated on the form's own `share` settings — there is no shareToken:
 *   private                        → caller must be a space member
 *   public + anonymousSubmit=true  → anyone, no login
 *   public + anonymousSubmit=false → any logged-in user, anonymous rejected
 * `submitLimit` is enforced HERE (server-side) — APITable's equivalent only
 * checked it in the browser, which is no enforcement at all.
 */
export const submitForm = async (
  nodeId: string,
  input: SubmitFormDTO,
  caller: { isAnonymous?: boolean } = {},
): Promise<{ changeRequestId: string; status: "pending_review" }> => {
  const form = await getFormByNodeId(nodeId);
  if (!form) {
    throw formNotFound(nodeId);
  }
  if (!isAnonymousVisitor()) {
    await assertNodePermission(form.nodeId, "changeRequest");
  }

  // ── Access gate (§5.1 of the spec) ──
  if (caller.isAnonymous) {
    if (!form.share.isPublic) {
      throw new ORPCError("FORBIDDEN", { message: "This form is not public." });
    }
    if (!form.share.anonymousSubmit) {
      throw new ORPCError("FORBIDDEN", { message: "This form requires sign-in to submit." });
    }
  }

  // Authoritative read/submit capability check, on the node this submission
  // actually resolved to. The router's anonymous guard runs first, but it only
  // has the caller's id-or-slug ref. Typed slugs are space-unique, but checking
  // the resolved id here still keeps this write bound to the exact node that
  // `getFormByNodeId` returned.
  //
  // Keyed on the CONTEXT (`isAnonymousVisitor`), not on the `caller` hint: a
  // public-link visitor is a property of the request the host pinned, so a
  // transport that forgets to pass `isAnonymous` cannot bypass this — which is
  // exactly how the anonymous path broke before.
  if (isAnonymousVisitor() && (await getPublicScopeOf(form.nodeId)) !== "submit") {
    throw new ORPCError("FORBIDDEN", { message: "This form's public link is read-only." });
  }

  // ── Server-side submit limit ──
  if (form.share.submitLimit != null && form.submissionCount >= form.share.submitLimit) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "This form has reached its submission limit.",
    });
  }

  // Translate input names → target field slugs via the binding contract. Inputs
  // with no binding are ignored (the page may have decorative/non-data inputs).
  const fields: Record<string, unknown> = {};
  for (const binding of form.bindings) {
    const value = input.values[binding.inputName];
    if (value !== undefined) {
      fields[binding.fieldSlug] = value;
    }
  }

  // Per-form required overrides (in addition to the Base-level validation that
  // createChangeRequest → validateRecordFields already enforces).
  const missing = form.bindings
    .filter((b) => b.required)
    .filter((b) => {
      const v = fields[b.fieldSlug];
      return v === undefined || v === null || v === "";
    })
    .map((b) => b.label ?? b.fieldSlug);
  if (missing.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Missing required fields: ${missing.join(", ")}`,
      data: { missing },
    });
  }

  const changeRequest = await createFormSubmissionChangeRequest(form.nodeId, form.targetBaseId, {
    fields,
    message: `Form submission: ${form.name}`,
    submittedBy: caller.isAnonymous ? ANONYMOUS_SUBMITTER : "local-producer",
    // A form submission is inherently a "propose for review" action — it must
    // land as a pending ChangeRequest for a human to approve, never a direct
    // write. Force this regardless of the submitter's own write permission,
    // overriding the permission-aware auto-merge default: a member filling in a
    // shared form is still submitting for review, not editing the base.
    autoMerge: false,
  });

  // Count the accepted submission (backs submitLimit). Done after the CR exists
  // so a rejected/invalid submission never consumes quota.
  const db = await getDb();
  await db
    .update(busabaseForms)
    .set({ submissionCount: form.submissionCount + 1, updatedAt: now() })
    .where(eq(busabaseForms.id, form.id));

  return { changeRequestId: changeRequest.id, status: "pending_review" };
};

// A Form's typed detail is just the node row — its bindings/page/share live on
// `busabase_forms` and are read through the Form endpoints. Explicit opt-in, not
// a silent fallback; see `NodeRuntime.genericDetail`.
registerNodeRuntime("form", { genericDetail: true });
