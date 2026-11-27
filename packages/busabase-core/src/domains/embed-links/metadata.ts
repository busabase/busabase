import type { ChangeRequestVO, RecordVO } from "busabase-contract/types";
import { getPrimaryField } from "../base/utils/primary-field";
import {
  getChangeRequestTitle,
  getOperationMessage,
  getOperationSubject,
} from "../dashboard/helpers/change-request";
import { fieldPreviewText } from "../dashboard/helpers/field";

/** A valid transparent image prevents browsers falling back to the product favicon. */
export const EMBED_TRANSPARENT_ICON = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1"/>')}`;

const titleText = (value: string | null | undefined): string =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

/** Content-only metadata, without importing a web framework into the shared core. */
export const buildEmbedMetadata = (title?: string | null) => ({
  title: { absolute: titleText(title) || "Content unavailable" },
  description: titleText(title),
  applicationName: "",
  robots: { index: false, follow: false },
  icons: {
    icon: { url: EMBED_TRANSPARENT_ICON, type: "image/svg+xml" },
    shortcut: EMBED_TRANSPARENT_ICON,
    apple: EMBED_TRANSPARENT_ICON,
  },
  openGraph: null,
  twitter: null,
});

/** The same primary-field display as Node Detail, with a human fallback instead of an id. */
export const recordEmbedTitle = (record: RecordVO): string => {
  const primary = getPrimaryField(record.base);
  const value = primary
    ? fieldPreviewText(record.headCommit.payload[primary.slug], primary.type)
    : "";
  return titleText(value) || "Record";
};

/** Prefer the author's explanation, then the existing human-readable operation title. */
export const changeRequestEmbedTitle = (request: ChangeRequestVO): string => {
  const operation = request.primaryOperation ?? request.operations[0];
  const message = getOperationMessage(operation);
  if (message) return titleText(message);
  if (request.operationCount > 1 || (operation && getOperationSubject(operation, request.base))) {
    return titleText(getChangeRequestTitle({ ...request, primaryOperation: operation ?? null }));
  }
  return titleText(request.node?.name ?? request.base?.name) || "Change request";
};
