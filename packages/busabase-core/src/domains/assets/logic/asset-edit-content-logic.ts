import "server-only";

/**
 * `assets.editContent` — apply a coding-agent-style set of string-replace edits
 * to an asset's CURRENT, REAL, canonical file content (a markdown/code/config
 * file mounted in a Drive or Skill), producing the change as a ChangeRequest
 * for human review. Unlike `putText` (derived/extracted text, direct write, not
 * CR-gated — see asset-texts-logic.ts), this edits the asset's actual bytes and
 * must go through the same review gate any other file edit does.
 *
 * This is a THIN wrapper: resolve the asset's single Drive/Skill mount, read its
 * current content + hash via the shared filetree engine, apply the edits in
 * memory, then delegate to the EXISTING `createDriveChangeRequest` /
 * `createSkillChangeRequest` (packages/busabase-core/src/domains/{drive,skill}/handlers.ts)
 * with a `content`-shaped `update` operation. No new operation kind, no new
 * attachment-upload plumbing, no new merge/conflict logic — `baseContentHash`
 * is threaded straight through to `mergeFileTreeFile`'s existing optimistic-
 * concurrency check (packages/busabase-core/src/domains/filetree/handlers.ts).
 */
import { ORPCError } from "@orpc/server";
import type { EditAssetContentInput } from "busabase-contract/domains/assets/types";
import type { ChangeRequestVO } from "busabase-contract/types";
import { and, eq, inArray } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseAssetUsages } from "../../../db/schema";
import { createDriveChangeRequest, readDriveFile } from "../../drive/handlers";
import { createSkillChangeRequest, readSkillFile } from "../../skill/handlers";
import { INLINE_TEXT_MAX_BYTES } from "./asset-texts-logic";

type EditableOwnerType = "drive" | "skill";

interface ResolvedMount {
  ownerType: EditableOwnerType;
  nodeId: string;
  path: string;
}

/**
 * Find the single Drive/Skill location this asset is mounted at. Deliberate
 * scope limitation: an asset mounted in zero or more-than-one editable location
 * is rejected outright rather than guessed at — `editContent` never picks a
 * mount on the caller's behalf.
 */
const resolveEditableMount = async (assetId: string): Promise<ResolvedMount> => {
  const db = await getDb();
  const rows = await db
    .select({
      ownerType: busabaseAssetUsages.ownerType,
      nodeId: busabaseAssetUsages.nodeId,
      path: busabaseAssetUsages.path,
    })
    .from(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.spaceId, getContextSpaceId()),
        eq(busabaseAssetUsages.assetId, assetId),
        inArray(busabaseAssetUsages.ownerType, ["drive", "skill"]),
      ),
    );

  if (rows.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Asset is not mounted in an editable Drive or Skill location.",
    });
  }
  if (rows.length > 1) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Asset is mounted in multiple locations; editContent requires exactly one editable mount.",
    });
  }

  const row = rows[0];
  if (!row) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Asset is not mounted in an editable Drive or Skill location.",
    });
  }
  return { ownerType: row.ownerType as EditableOwnerType, nodeId: row.nodeId, path: row.path };
};

/** Plain substring occurrence count (not regex) — mirrors a coding-agent Edit tool. */
const countOccurrences = (haystack: string, needle: string): number => {
  let count = 0;
  let fromIndex = 0;
  for (;;) {
    const foundAt = haystack.indexOf(needle, fromIndex);
    if (foundAt === -1) break;
    count += 1;
    fromIndex = foundAt + needle.length;
  }
  return count;
};

const replaceFirstOccurrence = (haystack: string, needle: string, replacement: string): string => {
  const foundAt = haystack.indexOf(needle);
  if (foundAt === -1) return haystack;
  return haystack.slice(0, foundAt) + replacement + haystack.slice(foundAt + needle.length);
};

/**
 * Apply `edits` IN ARRAY ORDER, each against the CURRENT state of the string
 * (sequential — edit N sees edit N-1's result, not the original). Per-edit
 * check order mirrors a coding-agent Edit tool exactly: same-string no-op →
 * not-found → ambiguous-without-replaceAll → apply.
 */
const applyEdits = (original: string, edits: EditAssetContentInput["edits"]): string => {
  let content = original;
  edits.forEach((edit, index) => {
    if (edit.oldString === edit.newString) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Edit at index ${index}: oldString and newString must differ.`,
      });
    }
    const count = countOccurrences(content, edit.oldString);
    if (count === 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Edit at index ${index}: oldString not found in the current content.`,
      });
    }
    if (!edit.replaceAll && count > 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Edit at index ${index}: oldString matches ${count} times; either make it unique or set replaceAll: true.`,
      });
    }
    content = edit.replaceAll
      ? content.split(edit.oldString).join(edit.newString)
      : replaceFirstOccurrence(content, edit.oldString, edit.newString);
  });
  return content;
};

export const editAssetContent = async (input: EditAssetContentInput): Promise<ChangeRequestVO> => {
  const mount = await resolveEditableMount(input.assetId);

  const file =
    mount.ownerType === "drive"
      ? await readDriveFile(mount.nodeId, mount.path)
      : await readSkillFile(mount.nodeId, mount.path);

  // `readFileTreeFile` (the shared engine both readDriveFile/readSkillFile
  // delegate to) returns `encoding: "url"` + `content: ""` for a non-text
  // (binary) asset — that IS the "is this editable text" signal; no need to
  // consult `busabase_asset_texts`/`openAssetTextSource` for this task.
  if (file.encoding !== "utf8") {
    throw new ORPCError("BAD_REQUEST", { message: "Asset has no editable text content." });
  }

  const originalContent = file.content;
  const sizeBytes = Buffer.byteLength(originalContent, "utf8");
  if (sizeBytes > INLINE_TEXT_MAX_BYTES) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", {
      message: `Asset content is ${sizeBytes} bytes, exceeding editContent's ${INLINE_TEXT_MAX_BYTES}-byte in-memory string-replace limit.`,
    });
  }

  const nextContent = applyEdits(originalContent, input.edits);
  if (nextContent === originalContent) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Edits produced no net change to the file content.",
    });
  }

  // Delegate to the EXISTING filetree CR pipeline — this is the whole point.
  // `baseContentHash: file.contentHash` (read BEFORE applying edits) is what
  // gives this call the same optimistic-concurrency conflict protection any
  // other file-tree update gets, entirely for free (see
  // `mergeFileTreeFile`/`readCurrentContentHash` in
  // `packages/busabase-core/src/domains/filetree/handlers.ts`).
  const changeRequestInput = {
    message: input.message,
    submittedBy: input.submittedBy,
    operations: [
      {
        kind: "update" as const,
        path: mount.path,
        content: nextContent,
        mimeType: file.mimeType,
        baseContentHash: file.contentHash,
      },
    ],
  };

  return mount.ownerType === "drive"
    ? createDriveChangeRequest(mount.nodeId, changeRequestInput)
    : createSkillChangeRequest(mount.nodeId, changeRequestInput);
};
