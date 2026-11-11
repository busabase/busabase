// WebVTT → SRT, so one SRT parser shows both subtitle formats. Pure; used by
// the subtitle viewer before parsing.

/** True when the text is a WebVTT file (its first line starts with WEBVTT). */
export const isWebVtt = (text: string): boolean =>
  /^﻿?WEBVTT(?:[ \t].*)?$/m.test(text.split(/\r?\n/, 1)[0] ?? "");

/** `mm:ss.ttt` / `hh:mm:ss.ttt` (VTT) → `hh:mm:ss,ttt` (SRT). */
const toSrtTimestamp = (value: string): string | null => {
  const match = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/.exec(value.trim());
  if (!match) return null;
  const [, hours = "0", minutes, seconds, millis] = match;
  return `${hours.padStart(2, "0")}:${minutes}:${seconds},${millis}`;
};

/**
 * The cues of a WebVTT file as SRT: header, NOTE/STYLE/REGION blocks, cue
 * identifiers, cue settings and voice/class tags (`<v Ada>`, `<c.loud>`) are
 * dropped; text is kept. Blocks that are not valid cues are skipped.
 */
export function vttToSrt(vtt: string): string {
  const blocks = vtt
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n{2,}/);
  const cues: string[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue; // header, NOTE, STYLE, REGION
    const [start, rest = ""] = (lines[timing] as string).split("-->");
    const end = rest.trim().split(/\s+/)[0] ?? "";
    const from = toSrtTimestamp(start ?? "");
    const to = toSrtTimestamp(end);
    if (!from || !to) continue;
    const text = lines
      .slice(timing + 1)
      .map((line) => line.replace(/<[^>]+>/g, ""))
      .join("\n");
    cues.push(`${cues.length + 1}\n${from} --> ${to}\n${text}`);
  }
  return cues.join("\n\n");
}
