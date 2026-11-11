import { describe, expect, it } from "vitest";
import { messagesForLocale } from "../i18n";
import { explainError } from "./explain-error";
import { ViewerError } from "./viewer-error";

const zh = messagesForLocale("zh-CN");

describe("explainError", () => {
  it.each([
    ["Failed to fetch file: 404 Not Found", "找不到这个文件，它可能已被移动或删除。"],
    ["Failed to fetch file: 403 Forbidden", "你没有权限访问这个文件。"],
    ["Failed to fetch file: 502 Bad Gateway", "服务器出了点问题，请稍后再试。"],
    ["Failed to fetch: 500", "服务器出了点问题，请稍后再试。"],
    ["Network error while fetching file: Failed to fetch", "无法连接服务器，请检查网络连接。"],
  ])("explains %j by what happened to the request", (message, explanation) => {
    expect(explainError(zh, new Error(message))).toBe(explanation);
  });

  it.each([
    // epub.js, three.js and JSZip, in their own words.
    "No Section Found",
    `Unexpected token 'o', "not a model" is not valid JSON`,
    "End of data reached (data length = 0, asked index = 4). Corrupted zip ?",
    // "not found" in a library's words is about the file, not a missing one.
    "End of central directory not found",
    // A number in the text is not a status.
    "Decode returned empty PCM (sampleRate=24000, len=500)",
  ])("calls a library's own error %j a file it could not read", (message) => {
    expect(explainError(zh, new Error(message))).toBe("文件可能已损坏，或者格式不受支持。");
  });

  it("lets the caller say what else it means", () => {
    expect(explainError(zh, "LibreOffice exited with code 1", "文档转换失败，请重试。")).toBe(
      "文档转换失败，请重试。",
    );
  });

  it("names a viewer's own reason", () => {
    expect(explainError(zh, new ViewerError("errorNetwork"))).toBe(
      "无法连接服务器，请检查网络连接。",
    );
  });
});
