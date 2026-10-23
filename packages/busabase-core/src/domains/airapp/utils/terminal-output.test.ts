import { describe, expect, it } from "vitest";
import { renderTerminalOutput } from "./terminal-output";

// Nodepod's npm spinner, byte for byte: erase line, carriage return, a
// coloured frame, the progress text — repeated every 80ms, then a final line.
const frame = (glyph: string, text: string) => `\x1b[2K\r\x1b[36m${glyph}\x1b[0m ${text}`;

describe("renderTerminalOutput", () => {
  it("collapses a redrawn spinner to the line the terminal ends up showing", () => {
    const raw =
      "$ npm install\n" +
      frame("⠋", "Restoring cached node_modules...") +
      frame("⠙", "Restored 47 cached entries") +
      "\x1b[2K\r\x1b[32m✔\x1b[0m added 0 packages in 0.0s\n" +
      "$ npm run dev\n";

    expect(renderTerminalOutput(raw)).toBe(
      "$ npm install\n✔ added 0 packages in 0.0s\n$ npm run dev\n",
    );
  });

  it("drops colour codes and leaves the text", () => {
    expect(renderTerminalOutput("\x1b[1m\x1b[31mnpm ERR!\x1b[0m missing script")).toBe(
      "npm ERR! missing script",
    );
  });

  it("overwrites from column 0 after a bare carriage return, keeping the longer tail", () => {
    expect(renderTerminalOutput("abcdef\rXY")).toBe("XYcdef");
  });

  it("treats CRLF as a plain line break", () => {
    expect(renderTerminalOutput("one\r\ntwo\r\n")).toBe("one\ntwo\n");
  });

  it("erases to the end of the line and moves to an absolute column", () => {
    expect(renderTerminalOutput("progress 10%\x1b[10G\x1b[K42%")).toBe("progress 42%");
  });

  it("clamps an absurd cursor column instead of padding the line with it", () => {
    const rendered = renderTerminalOutput("x\x1b[99999999Gy");
    expect(rendered.length).toBeLessThanOrEqual(1025);
    expect(rendered.startsWith("x")).toBe(true);
    expect(rendered.endsWith("y")).toBe(true);
  });

  it("drops OSC sequences such as hyperlinks", () => {
    expect(renderTerminalOutput("\x1b]8;;https://example.com\x07docs\x1b]8;;\x1b\\ ok")).toBe(
      "docs ok",
    );
  });

  it("leaves output without control characters untouched", () => {
    const plain = "> node server.js\n\nlistening on port 3000\n";
    expect(renderTerminalOutput(plain)).toBe(plain);
  });
});
