// What previewfile-core's `FileViewer` renders a file as — the one
// classification every host shares: PreviewFile's preview page and showcase,
// Buda's Drive and Busabase's file preview all route with it, and a host that
// decides which files to hand to the viewer (Busabase's `canPreview` check)
// asks the same function the viewer renders by.
//
// Pure and isomorphic — no React, no viewers — so a host can ask it on every
// file before loading the viewer bundle, and the server can use it to label
// uploads (`mimeTypeForFileName`).

/** What `FileViewer` renders a file as. */
export const FileType = {
  PDF: "pdf",
  IMAGE: "image",
  TIFF: "tiff",
  PSD: "psd",
  VIDEO: "video",
  AUDIO: "audio",
  SILK_AUDIO: "silk_audio",
  SUBTITLE: "subtitle",
  SPREADSHEET: "spreadsheet",
  WORD: "word",
  PRESENTATION: "presentation",
  MARKDOWN: "markdown",
  CODE: "code",
  TEXT: "text",
  EPUB: "epub",
  ARCHIVE: "archive",
  SQLITE: "sqlite",
  MODEL_3D: "model_3d",
  UNSUPPORTED: "unsupported",
} as const;

export type FileType = (typeof FileType)[keyof typeof FileType];

/** A file as hosts know it: its name and, when known, its MIME type. */
export interface FileRef {
  fileName: string;
  mimeType?: string | null;
}

const { PDF, IMAGE, TIFF, PSD, VIDEO, AUDIO, SILK_AUDIO, SUBTITLE, SPREADSHEET, WORD } = FileType;
const { PRESENTATION, MARKDOWN, CODE, TEXT, EPUB, ARCHIVE, SQLITE, MODEL_3D, UNSUPPORTED } =
  FileType;

// Types a browser would execute or render as a page. `mimeTypeForFileName`
// never infers these: an upload labelled with one could become a page on
// whatever origin serves it, so they are labelled text/plain instead.
const INERT = "text/plain";

/**
 * Every extension the viewer knows, with the MIME type it stands for (`null`
 * where there is no settled one). Kept rows for formats the viewer does not
 * render (`UNSUPPORTED`) only carry MIME types for upload labelling.
 */
const EXTENSIONS: Record<string, readonly [FileType, string | null]> = {
  pdf: [PDF, "application/pdf"],

  jpg: [IMAGE, "image/jpeg"],
  jpeg: [IMAGE, "image/jpeg"],
  png: [IMAGE, "image/png"],
  gif: [IMAGE, "image/gif"],
  webp: [IMAGE, "image/webp"],
  avif: [IMAGE, "image/avif"],
  bmp: [IMAGE, "image/bmp"],
  ico: [IMAGE, "image/x-icon"],
  svg: [IMAGE, INERT],
  tif: [TIFF, "image/tiff"],
  tiff: [TIFF, "image/tiff"],
  psd: [PSD, "image/vnd.adobe.photoshop"],

  mp4: [VIDEO, "video/mp4"],
  m4v: [VIDEO, "video/x-m4v"],
  webm: [VIDEO, "video/webm"],
  ogv: [VIDEO, "video/ogg"],
  // Also audio — an audio/* MIME type decides (see `detectFileType`).
  ogg: [VIDEO, "video/ogg"],
  mov: [VIDEO, "video/quicktime"],
  avi: [VIDEO, "video/x-msvideo"],
  mkv: [VIDEO, "video/x-matroska"],
  mpeg: [VIDEO, "video/mpeg"],
  mpg: [VIDEO, "video/mpeg"],
  mpe: [VIDEO, "video/mpeg"],

  mp3: [AUDIO, "audio/mpeg"],
  wav: [AUDIO, "audio/wav"],
  m4a: [AUDIO, "audio/mp4"],
  aac: [AUDIO, "audio/aac"],
  flac: [AUDIO, "audio/flac"],
  oga: [AUDIO, "audio/ogg"],
  opus: [AUDIO, "audio/opus"],
  silk: [SILK_AUDIO, "audio/silk"],
  slk: [SILK_AUDIO, "audio/silk"],
  srt: [SUBTITLE, "application/x-subrip"],
  vtt: [SUBTITLE, "text/vtt"],

  // Spreadsheets: all read in the browser by SheetJS.
  xlsx: [SPREADSHEET, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  xls: [SPREADSHEET, "application/vnd.ms-excel"],
  xlsm: [SPREADSHEET, "application/vnd.ms-excel.sheet.macroEnabled.12"],
  xlsb: [SPREADSHEET, "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
  xlt: [SPREADSHEET, "application/vnd.ms-excel"],
  xltx: [SPREADSHEET, "application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
  xltm: [SPREADSHEET, "application/vnd.ms-excel.template.macroEnabled.12"],
  ods: [SPREADSHEET, "application/vnd.oasis.opendocument.spreadsheet"],
  ots: [SPREADSHEET, "application/vnd.oasis.opendocument.spreadsheet-template"],
  fods: [SPREADSHEET, "application/vnd.oasis.opendocument.spreadsheet"],
  numbers: [SPREADSHEET, "application/vnd.apple.numbers"],
  "123": [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wk1: [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wk2: [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wk3: [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wk4: [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wks: [SPREADSHEET, "application/vnd.lotus-1-2-3"],
  wb2: [SPREADSHEET, "application/x-quattropro"],
  wq1: [SPREADSHEET, "application/x-quattropro"],
  wq2: [SPREADSHEET, "application/x-quattropro"],
  csv: [SPREADSHEET, "text/csv"],
  tsv: [SPREADSHEET, "text/tab-separated-values"],

  // Word processing: converted to PDF by LibreOffice (.docx can be drawn instead).
  docx: [WORD, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  doc: [WORD, "application/msword"],
  docm: [WORD, "application/vnd.ms-word.document.macroEnabled.12"],
  dot: [WORD, "application/msword"],
  dotx: [WORD, "application/vnd.openxmlformats-officedocument.wordprocessingml.template"],
  dotm: [WORD, "application/vnd.ms-word.template.macroEnabled.12"],
  odt: [WORD, "application/vnd.oasis.opendocument.text"],
  ott: [WORD, "application/vnd.oasis.opendocument.text-template"],
  fodt: [WORD, "application/vnd.oasis.opendocument.text"],
  rtf: [WORD, "application/rtf"],
  wpd: [WORD, "application/vnd.wordperfect"],
  wps: [WORD, "application/vnd.ms-works"],
  pages: [WORD, "application/vnd.apple.pages"],
  lwp: [WORD, "application/vnd.lotus-wordpro"],

  // Presentations: converted to PDF by LibreOffice.
  pptx: [PRESENTATION, "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  ppt: [PRESENTATION, "application/vnd.ms-powerpoint"],
  pptm: [PRESENTATION, "application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
  pot: [PRESENTATION, "application/vnd.ms-powerpoint"],
  potx: [PRESENTATION, "application/vnd.openxmlformats-officedocument.presentationml.template"],
  potm: [PRESENTATION, "application/vnd.ms-powerpoint.template.macroEnabled.12"],
  pps: [PRESENTATION, "application/vnd.ms-powerpoint"],
  ppsx: [PRESENTATION, "application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
  ppsm: [PRESENTATION, "application/vnd.ms-powerpoint.slideshow.macroEnabled.12"],
  odp: [PRESENTATION, "application/vnd.oasis.opendocument.presentation"],
  otp: [PRESENTATION, "application/vnd.oasis.opendocument.presentation-template"],
  fodp: [PRESENTATION, "application/vnd.oasis.opendocument.presentation"],
  key: [PRESENTATION, "application/vnd.apple.keynote"],
  kth: [PRESENTATION, "application/vnd.apple.keynote"],

  md: [MARKDOWN, "text/markdown"],
  markdown: [MARKDOWN, "text/markdown"],

  json: [CODE, "application/json"],
  jsonl: [CODE, "application/x-ndjson"],
  xml: [CODE, "application/xml"],
  yaml: [CODE, "application/yaml"],
  yml: [CODE, "application/yaml"],
  html: [CODE, INERT],
  htm: [CODE, INERT],
  js: [CODE, INERT],
  mjs: [CODE, INERT],
  cjs: [CODE, INERT],
  jsx: [CODE, INERT],
  ts: [CODE, INERT],
  tsx: [CODE, INERT],
  py: [CODE, INERT],
  java: [CODE, INERT],
  c: [CODE, INERT],
  h: [CODE, INERT],
  cpp: [CODE, INERT],
  hpp: [CODE, INERT],
  cs: [CODE, INERT],
  php: [CODE, INERT],
  rb: [CODE, INERT],
  go: [CODE, INERT],
  rs: [CODE, INERT],
  swift: [CODE, INERT],
  kt: [CODE, INERT],
  scala: [CODE, INERT],
  r: [CODE, INERT],
  sql: [CODE, INERT],
  css: [CODE, INERT],
  scss: [CODE, INERT],
  sass: [CODE, INERT],
  less: [CODE, INERT],
  toml: [CODE, INERT],
  ini: [CODE, INERT],
  cfg: [CODE, INERT],
  conf: [CODE, INERT],
  sh: [CODE, INERT],
  bash: [CODE, INERT],
  zsh: [CODE, INERT],
  fish: [CODE, INERT],
  ps1: [CODE, INERT],
  dockerfile: [CODE, INERT],
  vue: [CODE, INERT],
  svelte: [CODE, INERT],
  astro: [CODE, INERT],
  txt: [TEXT, "text/plain"],
  log: [TEXT, "text/plain"],
  // Subtitle formats the subtitle viewer cannot parse: shown as text.
  ass: [TEXT, "text/plain"],
  ssa: [TEXT, "text/plain"],
  sub: [TEXT, "text/plain"],

  epub: [EPUB, "application/epub+zip"],

  zip: [ARCHIVE, "application/zip"],
  rar: [ARCHIVE, "application/vnd.rar"],
  "7z": [ARCHIVE, "application/x-7z-compressed"],
  tar: [ARCHIVE, "application/x-tar"],
  gz: [ARCHIVE, "application/gzip"],
  tgz: [ARCHIVE, "application/gzip"],
  bz2: [ARCHIVE, "application/x-bzip2"],
  xz: [ARCHIVE, "application/x-xz"],
  jar: [ARCHIVE, "application/java-archive"],

  sqlite: [SQLITE, "application/vnd.sqlite3"],
  sqlite3: [SQLITE, "application/vnd.sqlite3"],
  db: [SQLITE, "application/vnd.sqlite3"],
  db3: [SQLITE, "application/vnd.sqlite3"],

  stl: [MODEL_3D, "model/stl"],
  obj: [MODEL_3D, "model/obj"],
  gltf: [MODEL_3D, "model/gltf+json"],
  glb: [MODEL_3D, "model/gltf-binary"],

  // Known formats with no viewer: labelled, never rendered.
  odg: [UNSUPPORTED, "application/vnd.oasis.opendocument.graphics"],
  otg: [UNSUPPORTED, "application/vnd.oasis.opendocument.graphics-template"],
  vsd: [UNSUPPORTED, "application/vnd.visio"],
  vsdx: [UNSUPPORTED, "application/vnd.ms-visio.drawing"],
  cdr: [UNSUPPORTED, "application/vnd.corel-draw"],
  wmf: [UNSUPPORTED, "application/x-msmetafile"],
  emf: [UNSUPPORTED, "application/x-emf"],
  dwg: [UNSUPPORTED, "application/acad"],
  dxf: [UNSUPPORTED, "application/acad"],
  ofd: [UNSUPPORTED, "application/ofd"],
  xmind: [UNSUPPORTED, "application/xmind"],
  bpmn: [UNSUPPORTED, "application/bpmn+xml"],
  dcm: [UNSUPPORTED, "application/dicom"],
  drawio: [UNSUPPORTED, "application/vnd.jgraph.mxfile"],
  dio: [UNSUPPORTED, "application/vnd.jgraph.mxfile"],
};

/** MIME types that name a type on their own, for files without a known extension. */
const MIME_TYPES = new Map<string, FileType>([
  ["text/srt", SUBTITLE],
  ["text/x-markdown", MARKDOWN],
  ["application/x-javascript", CODE],
  ["application/x-yaml", CODE],
  ["text/rtf", WORD],
  ["image/x-photoshop", PSD],
  ["application/x-photoshop", PSD],
  ["audio/x-silk", SILK_AUDIO],
  ["application/x-silk", SILK_AUDIO],
  ["application/javascript", CODE],
  ["text/javascript", CODE],
  ["text/html", CODE],
  ["text/css", CODE],
  ["text/xml", CODE],
  ["application/x-zip-compressed", ARCHIVE],
  ["application/x-rar-compressed", ARCHIVE],
  ["application/x-gzip", ARCHIVE],
  ["application/x-sqlite3", SQLITE],
]);
for (const [type, mimeType] of Object.values(EXTENSIONS)) {
  if (mimeType && mimeType !== INERT && type !== UNSUPPORTED && !MIME_TYPES.has(mimeType)) {
    MIME_TYPES.set(mimeType, type);
  }
}
MIME_TYPES.set("text/plain", TEXT);
// Shared with video: an Ogg file named by MIME type alone is audio.
MIME_TYPES.set("audio/ogg", AUDIO);

const extensionOf = (fileName: string): string => {
  const dot = fileName.lastIndexOf(".");
  if (dot >= 0) return fileName.slice(dot + 1).toLowerCase();
  return fileName.toLowerCase() === "dockerfile" ? "dockerfile" : "";
};

/** Lower-cased, without parameters; "" when unknown (`application/octet-stream` says nothing). */
const normalizeMimeType = (mimeType: string | null | undefined): string => {
  const type = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "application/octet-stream" ? "" : type;
};

/**
 * What `FileViewer` renders a file as. The extension decides first — uploads
 * from Buda and Busabase often arrive as application/octet-stream — then an
 * exact MIME type, then the MIME family (image/*, video/*, audio/*, text/*).
 */
export function detectFileType({ fileName, mimeType }: FileRef): FileType {
  const mime = normalizeMimeType(mimeType);
  const byExtension = EXTENSIONS[extensionOf(fileName)];
  if (byExtension) {
    const [type] = byExtension;
    return type === VIDEO && extensionOf(fileName) === "ogg" && mime.startsWith("audio/")
      ? AUDIO
      : type;
  }
  if (!mime) return UNSUPPORTED;

  const byMimeType = MIME_TYPES.get(mime);
  if (byMimeType) return byMimeType;
  if (mime.startsWith("image/")) return IMAGE;
  if (mime.startsWith("video/")) return VIDEO;
  if (mime.startsWith("audio/")) return AUDIO;
  if (mime.startsWith("text/")) return TEXT;
  if (
    [
      "application/json-seq",
      "application/json5",
      "application/jsonl",
      "application/jsonlines",
      "application/x-jsonlines",
      "application/xml-dtd",
      "application/xml-external-parsed-entity",
      "application/typescript",
      "application/x-typescript",
    ].includes(mime) ||
    (/^application\/.+\+(?:json|json-seq|xml|yaml)$/.test(mime) && !mime.endsWith(".main+xml"))
  )
    return CODE;
  if (mime.includes("zip") || mime.includes("compressed")) return ARCHIVE;
  return UNSUPPORTED;
}

/** A Word .docx — the one Word format the browser can draw itself. */
export function isDocx({ fileName, mimeType }: FileRef): boolean {
  return (
    extensionOf(fileName) === "docx" ||
    (!EXTENSIONS[extensionOf(fileName)] && normalizeMimeType(mimeType) === EXTENSIONS.docx?.[1])
  );
}

/**
 * True when `FileViewer` shows the file through the host's Office → PDF
 * converter (`OfficeViewer`): presentations, and every Word format but .docx.
 * Every host draws a .docx in the browser (docx-preview); the converter is
 * only its fallback when drawing fails.
 */
export function needsConverter(file: FileRef): boolean {
  const type = detectFileType(file);
  if (type === PRESENTATION) return true;
  return type === WORD && !isDocx(file);
}

/**
 * True when an embedded `FileViewer` has a real viewer for the file — not the
 * "unsupported" card. 3D models need a host that passes the 3D viewer
 * (`model3d`), and the converter's formats need a deployment that runs one;
 * LibreOffice picks its import filter by extension, so those also need a name
 * that carries one.
 */
export function canPreview(
  file: FileRef,
  { officeConversion, model3d = false }: { officeConversion: boolean; model3d?: boolean },
): boolean {
  const type = detectFileType(file);
  if (type === UNSUPPORTED) return false;
  if (type === MODEL_3D) return model3d;
  if (!needsConverter(file)) return true;
  return officeConversion && EXTENSIONS[extensionOf(file.fileName)]?.[0] === type;
}

/**
 * The MIME type a file's name stands for, to label an upload that came
 * without one; `null` when the extension says nothing settled. Never a type a
 * browser would run (HTML, SVG, scripts): those are labelled text/plain.
 */
export function mimeTypeForFileName(fileName: string): string | null {
  return EXTENSIONS[extensionOf(fileName)]?.[1] ?? null;
}
