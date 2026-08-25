/** Marker used when list responses omit a detail-sized commit field value. */
export const LIST_OMITTED_FIELD_VALUE =
  "[value omitted from the list view - open the change request to view]";

export const LIST_OMITTED_LONG_TEXT_VALUE =
  "[long text omitted from the list view - open the change request to view]";

export const isListPayloadLongTextOmitted = (value: unknown): boolean =>
  value === LIST_OMITTED_LONG_TEXT_VALUE;
