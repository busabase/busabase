export const INLINE_ASSET_TEXT_MAX_BYTES = 1024 * 1024;

export const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

// Browser-provided MIME types are advisory and vary by platform. The server
// performs the authoritative streaming UTF-8 validation during putText.
export const isTxtFile = (file: Pick<File, "name">): boolean =>
  file.name.toLowerCase().endsWith(".txt");
