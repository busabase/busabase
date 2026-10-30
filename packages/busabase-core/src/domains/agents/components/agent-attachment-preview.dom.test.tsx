// @vitest-environment jsdom

import { AcpComposer } from "@acp-ui/web/composer";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { renderAgentAttachment } from "./agent-attachment-preview";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const files = new Map<string, Blob>();
let nextUrl = 0;

beforeEach(() => {
  URL.createObjectURL = vi.fn((file: Blob | MediaSource) => {
    if (!(file instanceof Blob)) throw new Error("Expected an uploaded file");
    const url = `blob:agent-attachment-${nextUrl++}`;
    files.set(url, file);
    return url;
  });
  URL.revokeObjectURL = vi.fn((url: string) => files.delete(url));
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const file = files.get(String(input));
    if (!file) throw new Error(`Unknown local attachment: ${input}`);
    // Return the actual jsdom File so its FileReader reads the uploaded bytes.
    return { blob: async () => file } as Response;
  });
});

afterEach(() => {
  cleanup();
  files.clear();
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  vi.restoreAllMocks();
});

function show() {
  const onSend = vi.fn();
  const result = render(
    <CoreI18nProvider locale="en">
      <AcpComposer disabled={false} onSend={onSend} renderAttachment={renderAgentAttachment} />
    </CoreI18nProvider>,
  );
  const upload = (name = "photo.png", type = "image/png") => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["image-bytes"], name, { type })] } });
  };
  return { ...result, onSend, upload };
}

describe("agent composer attachment previews", () => {
  it("opens the uploaded image without submitting and restores focus after Escape", async () => {
    const { onSend, upload } = show();
    const draft = screen.getByRole("textbox");
    fireEvent.change(draft, { target: { value: "Keep my draft" } });
    upload();
    const opener = screen.getByRole("button", { name: "File preview: photo.png" });
    const localUrl = within(opener).getByRole("img").getAttribute("src");
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "photo.png" })).toBeTruthy();
    expect(within(dialog).getByRole("img").getAttribute("src")).toBe(localUrl);
    expect(within(dialog).getByRole("link", { name: "Download file" }).getAttribute("href")).toBe(
      localUrl,
    );
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect((draft as HTMLTextAreaElement).value).toBe("Keep my draft");
  });

  it("removes the staged file without opening a preview or sending", () => {
    const { onSend, upload } = show();
    upload();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "File preview: photo.png" })).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps a previewed attachment sendable and clears its chip after acceptance", async () => {
    const { onSend, upload } = show();
    upload();
    fireEvent.click(screen.getByRole("button", { name: "File preview: photo.png" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("", [
        { kind: "image", mimeType: "image/png", data: btoa("image-bytes") },
      ]),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "File preview: photo.png" })).toBeNull(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
  });

  it("uses the shared file viewer for non-image uploads and unmounts an open preview", () => {
    const { onSend, upload, unmount } = show();
    upload("brief.pdf", "application/pdf");
    fireEvent.click(screen.getByRole("button", { name: "File preview: brief.pdf" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("iframe")?.getAttribute("src")).toMatch(/^blob:/);
    expect(onSend).not.toHaveBeenCalled();
    unmount();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(files.size).toBe(0);
  });
});
