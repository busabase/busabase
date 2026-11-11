import { defaultMessages, type Messages } from "../i18n/messages";

/** A viewer message that takes no arguments. */
export type ViewerMessageKey = {
  [K in keyof Messages]: Messages[K] extends () => string ? K : never;
}[keyof Messages];

/**
 * An error a viewer raises for a reason it can name — no pages in a TIFF, no
 * tables in a database. Its `message` stays English, for logs and the
 * technical details; `ErrorState` shows `messageKey` in the viewer's language.
 * Throw sites need no messages of their own, so a callback or effect that
 * raises one keeps its dependencies.
 */
export class ViewerError extends Error {
  constructor(readonly messageKey: ViewerMessageKey) {
    super(defaultMessages[messageKey]());
    this.name = "ViewerError";
  }
}
