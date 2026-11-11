import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { readSpreadsheetWorkbook } from "./XlsxPreview";

const firstSheetRows = (workbook: XLSX.WorkBook) =>
  XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0] ?? ""] ?? {}, {
    header: 1,
    raw: false,
  });

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;

describe("readSpreadsheetWorkbook", () => {
  it("keeps UTF-8 Chinese text, ISO dates and leading zeros of a CSV exactly as written", () => {
    const workbook = readSpreadsheetWorkbook(
      bytes("日期,Agency,状态\n2026-10-01,蓝港传媒,已签约\n2026-10-03,Northwind,0012\n"),
      { fileName: "follow-ups.csv" },
    );

    expect(firstSheetRows(workbook)).toEqual([
      ["日期", "Agency", "状态"],
      ["2026-10-01", "蓝港传媒", "已签约"],
      ["2026-10-03", "Northwind", "0012"],
    ]);
  });

  it("decodes a GBK CSV, the encoding Excel on Chinese Windows saves", () => {
    // "日期,状态\n2026-10-01,已签约\n" encoded as GBK.
    const gbk = new Uint8Array([
      0xc8, 0xd5, 0xc6, 0xda, 0x2c, 0xd7, 0xb4, 0xcc, 0xac, 0x0a, 0x32, 0x30, 0x32, 0x36, 0x2d,
      0x31, 0x30, 0x2d, 0x30, 0x31, 0x2c, 0xd2, 0xd1, 0xc7, 0xa9, 0xd4, 0xbc, 0x0a,
    ]);

    expect(firstSheetRows(readSpreadsheetWorkbook(gbk.buffer, { fileName: "export.csv" }))).toEqual(
      [
        ["日期", "状态"],
        ["2026-10-01", "已签约"],
      ],
    );
  });

  it("recognises delimited text by MIME type when the name has no extension", () => {
    const workbook = readSpreadsheetWorkbook(bytes("日期\t状态\n2026-10-01\t已签约\n"), {
      contentType: "text/tab-separated-values; charset=utf-8",
      fileName: "export",
    });

    expect(firstSheetRows(workbook)).toEqual([
      ["日期", "状态"],
      ["2026-10-01", "已签约"],
    ]);
  });

  it("still reads binary workbooks through SheetJS", () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      source,
      XLSX.utils.aoa_to_sheet([
        ["维度", "权重"],
        ["报价", 0.25],
      ]),
      "V5",
    );
    const xlsx = XLSX.write(source, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const workbook = readSpreadsheetWorkbook(xlsx, { fileName: "agency.xlsx" });

    expect(workbook.SheetNames).toEqual(["V5"]);
    expect(firstSheetRows(workbook)).toEqual([
      ["维度", "权重"],
      ["报价", "0.25"],
    ]);
  });
});
