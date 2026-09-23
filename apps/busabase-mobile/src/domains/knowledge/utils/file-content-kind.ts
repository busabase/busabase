/**
 * Whether a file-tree file is text this app may edit, or an asset it may only
 * show.
 *
 * `fileTrees.readFile` answers `encoding: "utf8" | "url"`. A `url` file's bytes
 * live in object storage and its `content` comes back EMPTY — the server is
 * saying "here is where it lives", not "here is what it says".
 *
 * Mobile ignored that field entirely, with two consequences:
 *
 * 1. Opening an image in a Drive rendered the editor's empty state,
 *    "Empty file." — which is a statement about the file, and a false one.
 * 2. Typing anything into that box and saving sent a TEXT update for the path.
 *    Confirmed against a running server: a real PNG accepted a `content: "oops"`
 *    update with HTTP 200 and came back `encoding: "utf8"`, content `"oops"`.
 *    The image was gone.
 *
 * So this is not a formatting question; it decides whether the editor may be
 * opened at all.
 */
export type FileContentKind =
  /** Text the editor can show and write back. */
  | { kind: "text" }
  /** An image — showable inline, never editable here. */
  | { kind: "image" }
  /** Any other asset: openable outside the app, never editable here. */
  | { kind: "binary" };

export interface FileContentSource {
  encoding?: string | null;
  mimeType?: string | null;
}

/**
 * Decided on `encoding`, not on the file extension or the mime type.
 *
 * `encoding` is the server's own statement about what it just handed over;
 * a name or a mime type is a guess about what the bytes probably are. A `.md`
 * stored as an asset is still an asset, and must not be opened in an editor
 * whose save path would replace it.
 *
 * The mime type is consulted only AFTER that, to choose how to show something
 * this app already knows it cannot edit.
 */
export const fileContentKind = (file: FileContentSource | null | undefined): FileContentKind => {
  if (!file) return { kind: "text" };
  if (file.encoding !== "url") return { kind: "text" };
  return file.mimeType?.startsWith("image/") ? { kind: "image" } : { kind: "binary" };
};

/** True when the editor and every write action must stay closed for this file. */
export const isReadOnlyAsset = (file: FileContentSource | null | undefined): boolean =>
  fileContentKind(file).kind !== "text";
