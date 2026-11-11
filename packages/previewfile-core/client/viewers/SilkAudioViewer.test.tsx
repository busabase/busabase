import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagesProvider } from "../i18n";
import SilkAudioViewer from "./SilkAudioViewer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SilkAudioViewer", () => {
  it("says the browser cannot play the voice note when it lacks wasm SIMD, without calling the file damaged", async () => {
    // WebKit on x86_64 (Buda Desktop on Linux) cannot compile the SIMD decoder.
    vi.spyOn(WebAssembly, "validate").mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(
      <MessagesProvider locale="zh-CN">
        <SilkAudioViewer fileUrl="/voice.silk" fileName="voice.silk" />
      </MessagesProvider>,
    );

    expect(await screen.findByText("当前浏览器无法播放微信语音")).toBeInTheDocument();
    expect(screen.queryByText(/已损坏/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载原文件" })).toHaveAttribute(
      "download",
      "voice.silk",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the download to the host when embedded with noDownload", async () => {
    vi.spyOn(WebAssembly, "validate").mockReturnValue(false);

    render(<SilkAudioViewer fileUrl="/voice.silk" fileName="voice.silk" noDownload />);

    expect(
      await screen.findByText("This browser can't play WeChat voice notes"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
