/**
 * What the code viewer needs to put a file in front of a person: the language
 * the highlighter knows it by, and how much of a very large file to draw.
 */

/**
 * The names the highlighter (shiki, through kui's `CodeBlock`) knows a language
 * by. A name it does not know would stall the highlighter for that language, so
 * only these are ever returned.
 */
export type CodeLanguage =
  | "astro"
  | "bash"
  | "c"
  | "cpp"
  | "csharp"
  | "css"
  | "diff"
  | "dockerfile"
  | "fish"
  | "go"
  | "html"
  | "ini"
  | "java"
  | "javascript"
  | "json"
  | "kotlin"
  | "less"
  | "markdown"
  | "php"
  | "powershell"
  | "python"
  | "r"
  | "ruby"
  | "rust"
  | "sass"
  | "scala"
  | "scss"
  | "sql"
  | "svelte"
  | "swift"
  | "text"
  | "toml"
  | "typescript"
  | "vue"
  | "xml"
  | "yaml";

const BY_EXTENSION: Record<string, CodeLanguage> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  json: "json",
  jsonl: "json",
  py: "python",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  go: "go",
  rs: "rust",
  swift: "swift",
  kt: "kotlin",
  scala: "scala",
  r: "r",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  dockerfile: "dockerfile",
  md: "markdown",
  markdown: "markdown",
  diff: "diff",
  patch: "diff",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
};

const BY_MIME: Record<string, CodeLanguage> = {
  "application/json": "json",
  "application/javascript": "javascript",
  "text/javascript": "javascript",
  "text/typescript": "typescript",
  "text/html": "html",
  "text/css": "css",
  "text/xml": "xml",
  "application/xml": "xml",
  "text/yaml": "yaml",
  "application/x-yaml": "yaml",
  "text/x-python": "python",
  "text/x-java-source": "java",
  "text/x-c": "c",
  "text/x-c++": "cpp",
  "text/x-php": "php",
  "text/x-ruby": "ruby",
  "text/x-go": "go",
  "text/x-rust": "rust",
  "text/x-swift": "swift",
  "text/x-kotlin": "kotlin",
  "text/x-scala": "scala",
  "text/x-r": "r",
  "text/x-sql": "sql",
  "text/x-shellscript": "bash",
  "text/x-powershell": "powershell",
  "text/markdown": "markdown",
  "text/x-diff": "diff",
};

/** The language of a file by its extension, else by its MIME type, else plain text. */
export function codeLanguage(fileName: string, mimeType: string): CodeLanguage {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return (extension && BY_EXTENSION[extension]) || BY_MIME[mimeType] || "text";
}

/**
 * Past this much, a file is drawn only in part. The highlighter works on the
 * page's main thread and every line becomes elements, so a megabyte of log or a
 * minified bundle would freeze the page where an editor, which draws only what
 * is on screen, would not.
 */
export const CODE_PREVIEW_MAX_LINES = 5000;
export const CODE_PREVIEW_MAX_CHARS = 300_000;

export interface CodePreview {
  text: string;
  truncated: boolean;
  /** Lines drawn, and lines in the file. */
  shownLines: number;
  totalLines: number;
}

const countLines = (text: string): number => {
  let lines = 1;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) lines++;
  return lines;
};

/** The part of `text` to draw: within the line and character limits, and not ending in the middle of a line where it can help it. */
export function limitCodePreview(
  text: string,
  maxLines = CODE_PREVIEW_MAX_LINES,
  maxChars = CODE_PREVIEW_MAX_CHARS,
): CodePreview {
  const totalLines = countLines(text);
  if (totalLines <= maxLines && text.length <= maxChars) {
    return { text, truncated: false, shownLines: totalLines, totalLines };
  }
  let end = Math.min(text.length, maxChars);
  // Where the last line allowed ends, if that comes before the character limit.
  let lineEnd = -1;
  for (let line = 0; line < maxLines; line++) {
    lineEnd = text.indexOf("\n", lineEnd + 1);
    if (lineEnd === -1) break;
  }
  if (lineEnd !== -1 && lineEnd < end) end = lineEnd;
  let shown = text.slice(0, end);
  if (end < text.length && text[end] !== "\n") {
    const previousLineEnd = shown.lastIndexOf("\n");
    if (previousLineEnd > 0) shown = shown.slice(0, previousLineEnd);
  }
  return { text: shown, truncated: true, shownLines: countLines(shown), totalLines };
}
