import { render, screen, waitFor } from "@testing-library/react";
import videojs from "video.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessagesProvider, messagesForLocale, viewerLanguage } from "../i18n";
import { ErrorState } from "./ErrorState";
import { LoadingState } from "./LoadingState";
import TiffViewer from "./TiffViewer";
import { videoJsLanguage } from "./video-languages";
import { ViewerError } from "./viewer-error";

// A two-page TIFF, so the viewer shows its page navigation.
vi.mock("utif", () => ({
  default: {
    decode: () => [
      { width: 4, height: 2 },
      { width: 4, height: 2 },
    ],
    decodeImage: () => {},
    toRGBA8: () => new Uint8Array(4 * 2 * 4),
  },
}));

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => new ArrayBuffer(8),
  })) as unknown as typeof fetch;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    putImageData: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    },
  );
});

describe("viewer chrome speaks the host's language", () => {
  it.each([
    ["ko", "문서를 불러오는 중..."],
    ["pt-BR", "Carregando documento..."],
    ["de", "Dokument wird geladen..."],
    ["es-MX", "Cargando documento..."],
    ["fr", "Chargement du document..."],
    ["vi", "Đang tải tài liệu..."],
  ])("says what it is waiting for in %s", (locale, text) => {
    render(
      <MessagesProvider locale={locale}>
        <LoadingState message={messagesForLocale(locale).loadingDocument()} />
      </MessagesProvider>,
    );
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("names a viewer's own error in the host's language, keeping the English for the details", () => {
    render(
      <MessagesProvider locale="zh-CN">
        <ErrorState error={new ViewerError("tiffNoPages")} onRetry={() => {}} />
      </MessagesProvider>,
    );
    expect(screen.getByText("文件加载失败")).toBeTruthy();
    expect(screen.getByText("TIFF 文件里没有页面")).toBeTruthy();
    expect(screen.getByRole("button", { name: "重试" })).toBeTruthy();
    expect(screen.getByText("技术细节")).toBeTruthy();
    expect(screen.getByText("No pages found in TIFF file")).toBeTruthy();
  });

  it("explains a technical error in the host's language", () => {
    render(
      <MessagesProvider locale="ja">
        <ErrorState error={new Error("Network request failed")} />
      </MessagesProvider>,
    );
    expect(
      screen.getByText("サーバーに接続できません。インターネット接続を確認してください。"),
    ).toBeTruthy();
  });

  it.each([
    ["Failed to fetch file: 404 Not Found", "找不到这个文件，它可能已被移动或删除。"],
    ["Failed to fetch file: 403 Forbidden", "你没有权限访问这个文件。"],
    ["Network error while fetching file: Failed to fetch", "无法连接服务器，请检查网络连接。"],
  ])('explains %j by its status, not by the word "fetch" in it', (message, explanation) => {
    render(
      <MessagesProvider locale="zh-CN">
        <ErrorState error={new Error(message)} />
      </MessagesProvider>,
    );
    expect(screen.getByText(explanation)).toBeTruthy();
  });

  it("says what it is waiting for in the host's language", () => {
    render(
      <MessagesProvider locale="zh-TW">
        <LoadingState variant="queued" />
      </MessagesProvider>,
    );
    expect(screen.getByText("正在排隊等待轉換...")).toBeTruthy();
  });

  it("labels the TIFF toolbar, pages and tip in the host's language", async () => {
    render(
      <MessagesProvider locale="zh-CN">
        <TiffViewer fileName="scan.tiff" fileUrl="/scan.tiff" />
      </MessagesProvider>,
    );
    await waitFor(() => expect(screen.getByText("第 1 页，共 2 页")).toBeTruthy());
    expect(screen.getByTitle("放大（Ctrl/Cmd + +）")).toBeTruthy();
    expect(screen.getByTitle("下一页（→）")).toBeTruthy();
    expect(screen.getByRole("option", { name: "适合宽度" })).toBeTruthy();
    expect(screen.getByText("💡 提示：按住 Ctrl/Cmd 滚动鼠标可缩放 • 用方向键翻页")).toBeTruthy();
    expect(screen.queryByText(/Tip:|Page 1 of/)).toBeNull();
  });

  it("keeps English without a host language", async () => {
    render(<TiffViewer fileName="scan.tiff" fileUrl="/scan.tiff" />);
    await waitFor(() => expect(screen.getByText("Page 1 of 2")).toBeTruthy());
    expect(screen.getByTitle("Zoom in (Ctrl/Cmd + +)")).toBeTruthy();
  });
});

describe("the language the viewers speak", () => {
  it.each([
    ["zh-CN", "zh-CN"],
    ["zh", "zh-CN"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh-TW", "zh-TW"],
    ["zh-Hant", "zh-TW"],
    ["zh-HK", "zh-TW"],
    ["ja-JP", "ja"],
    ["ko", "ko"],
    ["ko-KR", "ko"],
    ["pt", "pt"],
    ["pt-BR", "pt"],
    ["pt-PT", "pt"],
    ["de", "de"],
    ["de-AT", "de"],
    ["es", "es"],
    ["es-419", "es"],
    ["fr", "fr"],
    ["fr-CA", "fr"],
    ["vi", "vi"],
    ["VI-vn", "vi"],
    ["ar", "en"],
    ["en-US", "en"],
    ["", "en"],
    [undefined, "en"],
  ])("%s -> %s", (tag, language) => {
    expect(viewerLanguage(tag)).toBe(language);
  });

  it.each([
    ["en", "3 tables"],
    ["zh-CN", "3 个数据表"],
    ["zh-TW", "3 張資料表"],
    ["ja", "3 個のテーブル"],
    ["ko", "테이블 3개"],
    ["pt", "3 tabelas"],
    ["de", "3 Tabellen"],
    ["es", "3 tablas"],
    ["fr", "3 tables"],
    ["vi", "3 bảng"],
  ])("counts a database's tables in %s", (locale, text) => {
    expect(messagesForLocale(locale).sqliteTableCount({ count: 3 })).toBe(text);
  });

  it("teaches video.js those languages, including the skip buttons it has no text for", () => {
    for (const language of ["zh-CN", "zh-TW", "ja", "ko", "pt", "de", "es", "fr", "vi"] as const) {
      videoJsLanguage(language);
    }
    // video.js files a pack under its lower-cased code.
    const languages = videojs.options.languages as Record<string, Record<string, string>>;
    expect(languages["zh-cn"]?.["Play Video"]).toBe("播放视频");
    expect(languages["zh-tw"]?.Mute).toBe("靜音");
    expect(languages.ja?.Fullscreen).toBe("フルスクリーン");
    expect(languages["zh-cn"]?.["Skip Forward"]).toBe("快进");
    expect(languages.ko?.Fullscreen).toBe("전체 화면");
    expect(languages.pt?.Mute).toBe("Mudo");
    expect(languages.de?.["Skip Forward"]).toBe("Vorspringen");
  });
});
