"use client";

import { getDefaultRecordFindFields } from "busabase-contract/domains/base/contract/record-find";
import type { BaseFieldVO, FieldType, ViewConfigVO } from "busabase-contract/types";
import { createContext, type ReactNode, useContext } from "react";
import { highlightSearchText } from "../helpers/search";
import type { RecordFindInput } from "./use-record-find";

export interface RecordFindHighlight {
  /** The committed find query — what the server filtered on, not the draft. */
  query: string;
  /** Slugs of the fields that find searched. */
  fieldSlugs: ReadonlySet<string>;
}

/**
 * Field types whose collection cells show their stored text (or choice/tag
 * labels) as plain strings, so marking a substring is exact. Markdown, HTML and
 * embeds render rich content and are left unmarked.
 */
const HIGHLIGHTED_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "text",
  "longtext",
  "number",
  "email",
  "url",
  "phone",
  "auto_number",
  "select",
  "multiselect",
  "ai_tags",
  "ai_summary",
]);

/**
 * The fields a committed find searched: the chosen one, or the same default
 * scope the server uses (eligible fields the saved View shows). Null without
 * a committed find, or when the chosen field no longer exists.
 */
export const getRecordFindHighlight = (
  input: RecordFindInput | undefined,
  fields: readonly BaseFieldVO[],
  viewConfig?: ViewConfigVO | null,
): RecordFindHighlight | null => {
  const query = input?.query.trim();
  if (!input || !query) return null;
  const searched = input.fieldId
    ? fields.filter((field) => field.id === input.fieldId)
    : getDefaultRecordFindFields(fields, viewConfig);
  if (searched.length === 0) return null;
  return { query, fieldSlugs: new Set(searched.map((field) => field.slug)) };
};

const RecordFindHighlightContext = createContext<RecordFindHighlight | null>(null);

/** Provided around a record collection (table, gallery, board) while a find is active. */
export function RecordFindHighlightProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: RecordFindHighlight | null;
}) {
  return (
    <RecordFindHighlightContext.Provider value={value}>
      {children}
    </RecordFindHighlightContext.Provider>
  );
}

/**
 * A renderer for one field's plain display text: it marks the committed find
 * query when that field was searched, and returns the text untouched otherwise
 * (no find, another field, or a rich-content field). Cell editors never use it,
 * so an input in edit mode always shows the raw value.
 */
export const useRecordFindHighlighter = (
  field: Pick<BaseFieldVO, "slug" | "type"> | null | undefined,
): ((text: string) => ReactNode) => {
  const highlight = useContext(RecordFindHighlightContext);
  const query =
    highlight &&
    field &&
    HIGHLIGHTED_FIELD_TYPES.has(field.type) &&
    highlight.fieldSlugs.has(field.slug)
      ? highlight.query
      : "";
  return (text: string) => (query && text ? highlightSearchText(text, query) : text);
};

/** Plain display text of one field, with the find query marked (see above). */
export function RecordFindHighlightedText({
  field,
  text,
}: {
  field: Pick<BaseFieldVO, "slug" | "type"> | null | undefined;
  text: string;
}) {
  const highlight = useRecordFindHighlighter(field);
  return <>{highlight(text)}</>;
}
