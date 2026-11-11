import { describe, expect, it } from "vitest";
import { codeLanguage, limitCodePreview } from "./code-preview";

describe("codeLanguage", () => {
  it.each([
    ["app.py", "text/x-python", "python"],
    ["App.TSX", "application/octet-stream", "typescript"],
    ["main.rs", "", "rust"],
    ["run.sh", "", "bash"],
    ["Dockerfile", "", "dockerfile"],
    ["data.jsonl", "", "json"],
    ["header.h", "", "c"],
    ["config.yml", "", "yaml"],
  ])("reads %s as %s by its name", (name, mime, expected) => {
    expect(codeLanguage(name, mime)).toBe(expected);
  });

  it("falls back to the MIME type when the name says nothing", () => {
    expect(codeLanguage("snippet", "application/json")).toBe("json");
    expect(codeLanguage("snippet", "text/x-shellscript")).toBe("bash");
  });

  it("draws what it does not know as plain text, never as a name the highlighter lacks", () => {
    expect(codeLanguage("notes.txt", "text/plain")).toBe("text");
    expect(codeLanguage("a.unknownext", "application/octet-stream")).toBe("text");
    expect(codeLanguage("", "")).toBe("text");
  });
});

describe("limitCodePreview", () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n");

  it("draws a file inside both limits whole", () => {
    const text = lines(10);
    expect(limitCodePreview(text, 100, 10_000)).toEqual({
      text,
      truncated: false,
      shownLines: 10,
      totalLines: 10,
    });
  });

  it("stops at the last line allowed and says how many there are", () => {
    const preview = limitCodePreview(lines(50), 20, 100_000);
    expect(preview.truncated).toBe(true);
    expect(preview.shownLines).toBe(20);
    expect(preview.totalLines).toBe(50);
    expect(preview.text.split("\n")).toHaveLength(20);
    expect(preview.text.endsWith("line 20")).toBe(true);
  });

  it("stops at the character limit, at the end of a line where it can", () => {
    const preview = limitCodePreview(lines(1000), 5000, 100);
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBeLessThanOrEqual(100);
    // No line is cut in two.
    expect(lines(1000).startsWith(`${preview.text}\n`)).toBe(true);
  });

  it("cuts a single enormous line (a minified bundle) where it must", () => {
    const preview = limitCodePreview("x".repeat(2_000), 5000, 300);
    expect(preview).toMatchObject({ truncated: true, shownLines: 1, totalLines: 1 });
    expect(preview.text).toHaveLength(300);
  });

  it("counts a trailing newline's empty last line as the file does", () => {
    expect(limitCodePreview("a\nb\n").totalLines).toBe(3);
    expect(limitCodePreview("").totalLines).toBe(1);
  });
});
