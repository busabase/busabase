import { homedir, tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import QRCode from "qrcode";

/**
 * `busabase-cli qrcode <url>` — render a URL as a QR code.
 *
 * Exists for one moment: an agent has a login `verification_url` and the human
 * who must approve it is holding a phone. A QR code removes the copy-a-long-URL
 * step entirely. The URL is treated as an OPAQUE string — encoded byte-for-byte,
 * never re-encoded, trimmed, or re-assembled — because a "helpfully" reworded
 * URL is a 404 on the user's phone.
 */

/** Same shape as lark-cli's hint: generating the file alone is a classic agent miss. */
export const QR_DISPLAY_HINT =
  "You MUST include this QR image in your reply to the user — generating the file alone is not enough. " +
  "Show the URL first (verbatim — it is an opaque string; never re-encode, trim, or re-wrap it) and place the QR image below it.";

/** PNG size bounds, matching what stays scannable without being silly. */
export const QR_MIN_SIZE = 64;
export const QR_MAX_SIZE = 1024;
export const QR_DEFAULT_SIZE = 256;

/**
 * A `--out-file` path may live under the working directory, the OS temp
 * directory, or the user's home — the places an agent legitimately writes
 * artifacts. Anything else (e.g. `/etc/...`) is refused rather than written.
 */
export function safeQrOutputPath(raw: string): string {
  const abs = resolve(raw);
  const roots = [process.cwd(), tmpdir(), homedir()];
  const contained = roots.some((root) => {
    const prefix = root.endsWith(sep) ? root : root + sep;
    return abs === root || abs.startsWith(prefix);
  });
  if (!contained) {
    throw new Error(
      `Unsafe --out-file path "${raw}" — write inside the current directory, ${tmpdir()}, or your home directory.`,
    );
  }
  return abs;
}

/** Encode `url` into a PNG at `filePath` (path must already be validated). */
export async function writeQrPng(url: string, filePath: string, size: number): Promise<void> {
  if (!Number.isInteger(size) || size < QR_MIN_SIZE || size > QR_MAX_SIZE) {
    throw new Error(`--size must be an integer between ${QR_MIN_SIZE} and ${QR_MAX_SIZE}.`);
  }
  await QRCode.toFile(filePath, url, {
    type: "png",
    width: size,
    errorCorrectionLevel: "M",
  });
}

/** Encode `url` as a small terminal (ANSI half-block) QR code. */
export async function renderQrAscii(url: string): Promise<string> {
  return QRCode.toString(url, { type: "terminal", small: true, errorCorrectionLevel: "M" });
}
