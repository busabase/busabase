/** Marker used when list responses omit a detail-sized commit field value. */
export const LIST_OMITTED_FIELD_VALUE =
  "[value omitted from the list view - open the change request to view]";

export const LIST_OMITTED_LONG_TEXT_VALUE =
  "[long text omitted from the list view - open the change request to view]";

const isOmittedWhiteboard = (value: unknown): value is { omitted: string; previewSvg: string } =>
  typeof value === "object" &&
  value !== null &&
  (value as { omitted?: unknown }).omitted === LIST_OMITTED_FIELD_VALUE &&
  typeof (value as { previewSvg?: unknown }).previewSvg === "string";

export const isListPayloadOmitted = (value: unknown): boolean =>
  value === LIST_OMITTED_FIELD_VALUE ||
  value === LIST_OMITTED_LONG_TEXT_VALUE ||
  isOmittedWhiteboard(value);

/** The thumbnail a table-mode row kept when it left out a whiteboard's scene. */
export const getOmittedWhiteboardPreview = (value: unknown): string | null =>
  isOmittedWhiteboard(value) ? value.previewSvg : null;

export const isListPayloadLongTextOmitted = (value: unknown): boolean =>
  value === LIST_OMITTED_LONG_TEXT_VALUE;
