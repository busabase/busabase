/**
 * Byte <-> string helpers shared by the hub (decode) and client (encode) so the
 * two ends agree on chunk encoding. Runtime-agnostic: prefers Node's `Buffer`,
 * falls back to `btoa`/`atob` so the package also works outside Node.
 */

const utf8Encoder = new TextEncoder();

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decode a chunk's `data` string into bytes per its (optional) encoding. */
export function decodeChunk(data: string, encoding?: "utf8" | "base64"): Uint8Array {
  return encoding === "base64" ? base64ToBytes(data) : utf8Encoder.encode(data);
}
