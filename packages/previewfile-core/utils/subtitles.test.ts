import { describe, expect, it } from "vitest";
import { isWebVtt, vttToSrt } from "./subtitles";

describe("vttToSrt", () => {
  it("turns WebVTT cues into SRT cues", () => {
    const vtt = [
      "WEBVTT - quarterly review",
      "",
      "NOTE written for the test",
      "",
      "STYLE",
      "::cue { color: yellow }",
      "",
      "intro",
      "00:00:01.000 --> 00:00:03.000 line:0 position:10%",
      "<v Ada>季度回顾（合成数据）</v>",
      "",
      "00:03.500 --> 00:06.000",
      "Contoso <c.loud>跟进中</c>",
      "second line",
    ].join("\n");

    expect(vttToSrt(vtt)).toBe(
      [
        "1",
        "00:00:01,000 --> 00:00:03,000",
        "季度回顾（合成数据）",
        "",
        "2",
        "00:00:03,500 --> 00:00:06,000",
        "Contoso 跟进中",
        "second line",
      ].join("\n"),
    );
  });

  it("copes with CRLF and a byte-order mark, and skips broken cues", () => {
    const vtt =
      "﻿WEBVTT\r\n\r\n00:00:01.000 --> nonsense\r\nbroken\r\n\r\n00:00:02.000 --> 00:00:03.000\r\nok\r\n";
    expect(vttToSrt(vtt)).toBe("1\n00:00:02,000 --> 00:00:03,000\nok");
  });
});

describe("isWebVtt", () => {
  it("recognises the WEBVTT signature only on the first line", () => {
    expect(isWebVtt("WEBVTT\n\n00:01.000 --> 00:02.000\nhi")).toBe(true);
    expect(isWebVtt("﻿WEBVTT Kind: captions\n")).toBe(true);
    expect(isWebVtt("1\n00:00:01,000 --> 00:00:02,000\nWEBVTT is mentioned\n")).toBe(false);
  });
});
