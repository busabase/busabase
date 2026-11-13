/** Node ids become one storage-key and archive-name segment; never rewrite them. */
export const isSafeNodeIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("\0") &&
  value !== "." &&
  value !== "..";
