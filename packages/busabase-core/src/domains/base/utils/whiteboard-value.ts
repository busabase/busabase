// Pure, isomorphic value shape for the `whiteboard` Base field type. No DB, no
// React, no server-only imports — safe to use on both client and server, same
// bar as field-conversion.ts.
//
// A `whiteboard` field's stored value carries BOTH the raw Excalidraw scene
// (so it can be re-opened for editing) and a pre-rendered SVG snapshot (so
// read-only surfaces — the table grid cell and Record Detail's view mode —
// can show a static image instead of mounting a full interactive canvas per
// row). Reuses the Whiteboard NODE type's scene schema from busabase-contract
// (`domains/rich-node/types`) rather than duplicating it — the scene shape is
// identical, only the value composite (scene + previewSvg) is new here.
import {
  EMPTY_WHITEBOARD_DOCUMENT,
  WhiteboardDocumentSchema,
} from "busabase-contract/domains/rich-node/types";
import { z } from "zod";

export const WhiteboardFieldValueSchema = z.object({
  scene: WhiteboardDocumentSchema,
  // Raw `<svg>...</svg>` markup exported from the scene at the moment the
  // value was last changed (see record-views.tsx's WhiteboardFieldEditor).
  // Empty string means "no snapshot yet" (e.g. a brand new, untouched field).
  previewSvg: z.string().default(""),
});
export type WhiteboardFieldValue = z.infer<typeof WhiteboardFieldValueSchema>;

const clone = <T>(value: T): T => structuredClone(value);

export const EMPTY_WHITEBOARD_FIELD_VALUE: WhiteboardFieldValue = {
  scene: EMPTY_WHITEBOARD_DOCUMENT,
  previewSvg: "",
};

/** Parse a raw field value into a well-formed `WhiteboardFieldValue`, falling back to empty. */
export const parseWhiteboardFieldValue = (value: unknown): WhiteboardFieldValue => {
  const parsed = WhiteboardFieldValueSchema.safeParse(value);
  return parsed.success ? parsed.data : clone(EMPTY_WHITEBOARD_FIELD_VALUE);
};
