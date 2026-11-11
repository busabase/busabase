import { mimeTypeForFileName } from "./file-types";

const OFFICE_EXTENSIONS = new Set([
  "doc",
  "docx",
  "docm",
  "dot",
  "dotx",
  "dotm",
  "xls",
  "xlsx",
  "xlsm",
  "xlsb",
  "xlt",
  "xltx",
  "xltm",
  "ppt",
  "pptx",
  "pptm",
  "pot",
  "potx",
  "potm",
  "pps",
  "ppsx",
  "ppsm",
  "odt",
  "ods",
  "odp",
  "rtf",
]);

export interface ResolveFileMetadataInput {
  explicitFileName?: string | null;
  multipartFileName?: string | null;
  headerContentDisposition?: string | null;
  url?: string | null;
  explicitMimeType?: string | null;
  multipartMimeType?: string | null;
  headerContentType?: string | null;
  fallbackFileName?: string;
}

export interface ResolvedFileMetadata {
  fileName: string;
  mimeType: string;
}

export function resolveFileMetadata(input: ResolveFileMetadataInput): ResolvedFileMetadata {
  const fileName = sanitizeFileName(
    input.explicitFileName ||
      input.multipartFileName ||
      extractFileNameFromContentDisposition(input.headerContentDisposition) ||
      extractFileNameFromUrl(input.url) ||
      input.fallbackFileName ||
      "file",
  );

  const mimeType =
    normalizeMimeType(input.explicitMimeType) ||
    normalizeMimeType(input.multipartMimeType) ||
    normalizeMimeType(input.headerContentType) ||
    mimeTypeForFileName(fileName) ||
    "application/octet-stream";

  return { fileName, mimeType };
}

export function looksLikeOfficeFile(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ext ? OFFICE_EXTENSIONS.has(ext) : false;
}

export function isProbablyHtmlMime(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "text/html" || normalized === "application/xhtml+xml";
}

function sanitizeFileName(value: string): string {
  const withoutControlChars = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
  const normalized = withoutControlChars.trim().replace(/[/\\]/g, "_").replace(/\s+/g, " ");
  return normalized || "file";
}

function normalizeMimeType(value?: string | null): string | null {
  if (!value) return null;
  const type = value.split(";")[0]?.trim().toLowerCase();
  if (!type || !type.includes("/")) return null;
  return type;
}

function extractFileNameFromUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const pathname = new URL(value).pathname;
    const last = pathname.split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

function extractFileNameFromContentDisposition(value?: string | null): string | null {
  if (!value) return null;

  // RFC 5987: filename*=UTF-8''...
  const utf8Match = value.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;\r\n]+)/i);
  if (utf8Match?.[1]) {
    const raw = stripQuotes(utf8Match[1].trim());
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const plainMatch = value.match(/filename\s*=\s*([^;\r\n]+)/i);
  if (plainMatch?.[1]) {
    return stripQuotes(plainMatch[1].trim());
  }

  return null;
}

function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function getFileExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0 || dot === fileName.length - 1) return null;
  return fileName.slice(dot + 1).toLowerCase();
}
