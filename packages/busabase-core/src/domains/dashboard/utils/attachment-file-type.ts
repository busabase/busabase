export type AttachmentFileKind =
  | "pdf"
  | "spreadsheet"
  | "document"
  | "presentation"
  | "json"
  | "markdown"
  | "code"
  | "config"
  | "archive"
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file";

const extensions: Record<string, AttachmentFileKind> = {
  pdf: "pdf",
  csv: "spreadsheet",
  tsv: "spreadsheet",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  xlsm: "spreadsheet",
  xlsb: "spreadsheet",
  ods: "spreadsheet",
  numbers: "spreadsheet",
  doc: "document",
  docx: "document",
  docm: "document",
  odt: "document",
  rtf: "document",
  pages: "document",
  ppt: "presentation",
  pptx: "presentation",
  pptm: "presentation",
  odp: "presentation",
  key: "presentation",
  json: "json",
  jsonl: "json",
  ndjson: "json",
  geojson: "json",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  js: "code",
  jsx: "code",
  ts: "code",
  tsx: "code",
  mjs: "code",
  cjs: "code",
  html: "code",
  htm: "code",
  css: "code",
  scss: "code",
  py: "code",
  rb: "code",
  go: "code",
  rs: "code",
  java: "code",
  c: "code",
  cpp: "code",
  h: "code",
  swift: "code",
  php: "code",
  sh: "code",
  bash: "code",
  sql: "code",
  yaml: "config",
  yml: "config",
  toml: "config",
  ini: "config",
  env: "config",
  xml: "config",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  tgz: "archive",
  bz2: "archive",
  xz: "archive",
  zst: "archive",
  txt: "text",
  log: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  avif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  mp4: "video",
  webm: "video",
  mov: "video",
  avi: "video",
  mkv: "video",
  m4v: "video",
};

const mimeKinds: Record<string, AttachmentFileKind> = {
  "application/pdf": "pdf",
  "application/x-pdf": "pdf",
  "text/csv": "spreadsheet",
  "application/csv": "spreadsheet",
  "text/tab-separated-values": "spreadsheet",
  "application/vnd.ms-excel": "spreadsheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "spreadsheet",
  "application/vnd.ms-excel.sheet.macroenabled.12": "spreadsheet",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12": "spreadsheet",
  "application/vnd.oasis.opendocument.spreadsheet": "spreadsheet",
  "application/msword": "document",
  "application/rtf": "document",
  "text/rtf": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-word.document.macroenabled.12": "document",
  "application/vnd.oasis.opendocument.text": "document",
  "application/vnd.ms-powerpoint": "presentation",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "presentation",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "presentation",
  "application/vnd.oasis.opendocument.presentation": "presentation",
  "application/json": "json",
  "application/jsonl": "json",
  "application/x-ndjson": "json",
  "text/json": "json",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/javascript": "code",
  "text/javascript": "code",
  "application/typescript": "code",
  "text/typescript": "code",
  "text/html": "code",
  "text/css": "code",
  "application/sql": "code",
  "application/xml": "config",
  "text/xml": "config",
  "application/yaml": "config",
  "application/x-yaml": "config",
  "text/yaml": "config",
  "text/x-yaml": "config",
  "application/toml": "config",
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
  "application/x-rar-compressed": "archive",
  "application/vnd.rar": "archive",
  "application/x-7z-compressed": "archive",
  "application/x-tar": "archive",
  "application/gzip": "archive",
  "application/x-gzip": "archive",
  "application/x-bzip2": "archive",
  "application/x-xz": "archive",
  "application/zstd": "archive",
};

const fallbackLabels: Record<AttachmentFileKind, string> = {
  pdf: "PDF",
  spreadsheet: "XLS",
  document: "DOC",
  presentation: "PPT",
  json: "JSON",
  markdown: "MD",
  code: "CODE",
  config: "CFG",
  archive: "ZIP",
  text: "TXT",
  image: "IMG",
  audio: "AUDIO",
  video: "VIDEO",
  file: "FILE",
};

/** Presentation only: never use an inferred kind to choose a viewer or trust file bytes. */
export function attachmentFileType(fileName: string, mimeType = "") {
  const name = fileName.trim().split(/[\\/]/).pop() ?? "";
  const extension = name.includes(".") ? (name.split(".").pop()?.toLowerCase() ?? "") : "";
  const mime = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const mimeKind =
    (Object.hasOwn(mimeKinds, mime) ? mimeKinds[mime] : undefined) ??
    (mime.startsWith("image/")
      ? "image"
      : mime.startsWith("audio/")
        ? "audio"
        : mime.startsWith("video/")
          ? "video"
          : mime.endsWith("+json")
            ? "json"
            : mime.endsWith("+xml")
              ? "config"
              : undefined);
  // Plain-text and generic upload MIME types often hide Markdown/JSON/Office extensions.
  const kind: AttachmentFileKind =
    mimeKind ??
    (Object.hasOwn(extensions, extension) ? extensions[extension] : undefined) ??
    (mime.startsWith("text/") ? "text" : "file");
  // Longer suffixes use the recognizable type label so compact tiles stay legible.
  const label = /^[a-z0-9]{1,5}$/.test(extension) ? extension.toUpperCase() : fallbackLabels[kind];
  return { kind, label };
}
