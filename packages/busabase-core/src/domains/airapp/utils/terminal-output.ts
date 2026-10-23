const ESC = "\x1b";
const BEL = "\x07";
// Cursor moves past this are clamped: the console re-renders on every chunk,
// and `ESC[99999999G` would otherwise pad one line with ~100M spaces.
const MAX_COLUMN = 1024;

/**
 * Renders raw process output as a terminal would display it, for a plain
 * `<pre>` log console.
 *
 * Package managers draw spinners and progress by rewriting the current line:
 * Nodepod's npm writes `ESC[2K` (erase line) + `\r` + the next frame every
 * 80ms, coloured with SGR codes. Joined as plain text that is hundreds of
 * frames run together with `[2K[36m` littered through them, so a restore from
 * cache that took 0.3s reads like a long reinstall. Only the screen state is
 * kept: `\r` returns to column 0 and later text overwrites, `ESC[K` erases,
 * `ESC[nG` moves the cursor, and every other escape sequence (colours, OSC
 * titles/links) is dropped.
 */
export const renderTerminalOutput = (raw: string): string => {
  const lines: string[] = [];
  let line: string[] = [];
  let col = 0;
  const chars = Array.from(raw);

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ESC) {
      const kind = chars[i + 1];
      if (kind === "[") {
        let j = i + 2;
        let params = "";
        while (j < chars.length && !/[@-~]/.test(chars[j])) params += chars[j++];
        const final = chars[j];
        const n = Number.parseInt(params, 10);
        if (final === "K") {
          if (params === "" || n === 0) line.length = Math.min(line.length, col);
          else if (n === 1) line.fill(" ", 0, Math.min(col + 1, line.length));
          else if (n === 2) line = [];
        } else if (final === "G") {
          col = Number.isNaN(n) ? 0 : Math.min(MAX_COLUMN, Math.max(0, n - 1));
        }
        i = j;
      } else if (kind === "]") {
        // OSC runs until BEL or ST (`ESC \`).
        let j = i + 2;
        while (j < chars.length && chars[j] !== BEL && !(chars[j] === ESC && chars[j + 1] === "\\"))
          j++;
        i = chars[j] === ESC ? j + 1 : j;
      } else {
        i++;
      }
    } else if (ch === "\n") {
      lines.push(line.join(""));
      line = [];
      col = 0;
    } else if (ch === "\r") {
      col = 0;
    } else if (ch === "\b") {
      col = Math.max(0, col - 1);
    } else {
      while (line.length < col) line.push(" ");
      line[col++] = ch;
    }
  }
  lines.push(line.join(""));
  return lines.join("\n");
};
