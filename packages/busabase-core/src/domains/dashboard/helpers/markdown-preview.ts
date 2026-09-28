/**
 * Markdown as a PREVIEW should read it: leading YAML frontmatter shown as a
 * `yaml` code block instead of being parsed as prose.
 *
 * Without this, every `SKILL.md` preview opened with a large heading reading
 * "name: … description: …". CommonMark has no frontmatter: the opening `---` is
 * a thematic break, and the lines above the closing `---` become a SETEXT
 * heading. Web (Streamdown) and the phone (react-native-markdown-display) both
 * did exactly that. The frontmatter is still shown — it is the skill's name and
 * description — just as the metadata it is.
 *
 * Only the rendered preview changes; a "Source" view keeps the file as written.
 */
const FRONTMATTER = /^﻿?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export const markdownPreviewSource = (text: string): string => {
  const match = FRONTMATTER.exec(text);
  if (!match) return text;
  const yaml = match[1] ?? "";
  const rest = text.slice(match[0].length).replace(/^\s*\n/, "");
  if (!yaml.trim()) return rest;
  // A fence longer than any backtick run inside, so the block cannot close early.
  const longestRun = Math.max(2, ...(yaml.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return `${fence}yaml\n${yaml}\n${fence}\n\n${rest}`;
};
