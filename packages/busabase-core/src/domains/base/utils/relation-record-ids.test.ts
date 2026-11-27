import { expect, it } from "vitest";
import { LIST_OMITTED_FIELD_VALUE, LIST_OMITTED_LONG_TEXT_VALUE } from "./list-payload-preview";
import { getRelationRecordIds } from "./relation-record-ids";

it("ignores omission markers even when nested in encoded relation values", () => {
  const markers = [
    LIST_OMITTED_FIELD_VALUE,
    LIST_OMITTED_LONG_TEXT_VALUE,
    { omitted: LIST_OMITTED_FIELD_VALUE, previewSvg: "<svg />" },
  ];
  expect(getRelationRecordIds(markers)).toEqual([]);
  expect(getRelationRecordIds(JSON.stringify([LIST_OMITTED_LONG_TEXT_VALUE, "rec_a"]))).toEqual([
    "rec_a",
  ]);
});
