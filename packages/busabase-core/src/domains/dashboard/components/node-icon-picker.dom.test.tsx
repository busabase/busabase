// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeIcon } from "busabase-contract/types";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { NodeIconPicker } from "./node-icon-picker";

// jsdom cannot measure the crop frame. Keep the upload hook and real mutations,
// supplying only the crop rectangle that the browser cropper would report.
vi.mock("react-easy-crop", () => ({
  default: ({ onCropComplete }: { onCropComplete: (area: unknown, pixels: unknown) => void }) => {
    useEffect(() => {
      onCropComplete({}, { x: 0, y: 0, width: 100, height: 100 });
    }, [onCropComplete]);
    return <div>Measured image crop</div>;
  },
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;

const orpc = {
  nodes: {
    icon: {
      createUploadUrl: {
        mutationOptions: () => ({ mutationFn: async () => ({}) }),
      },
      confirm: {
        mutationOptions: () => ({ mutationFn: async () => ({}) }),
      },
    },
  },
} as unknown as BusabaseQueryUtils;

const emojiIcon: NodeIcon = { type: "emoji", value: "📁" };
const imageIcon: NodeIcon = {
  type: "attachment",
  url: "https://example.com/folder.png",
  attachmentId: "folder-icon",
};

const renderPicker = (icon: NodeIcon | null, onChange = vi.fn(), queryUtils = orpc) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <NodeIconPicker
          icon={icon}
          nodeId="nod_folder"
          nodeType="folder"
          onChange={onChange}
          orpc={queryUtils}
        />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
  return onChange;
};

describe("NodeIconPicker restore default", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([emojiIcon, imageIcon])("clears a custom $type icon from the existing picker", (icon) => {
    const onChange = renderPicker(icon);
    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));

    fireEvent.click(screen.getByRole("button", { name: /Restore default icon/ }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("hides restore when the node already uses the type icon", () => {
    renderPicker(null);
    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));

    expect(screen.getByRole("button", { name: /Upload image/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Restore default icon/ })).toBeNull();
  });

  it("waits for a pending upload before restoring so its late completion cannot replace the default", async () => {
    vi.stubGlobal(
      "Image",
      class {
        onload: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
      callback(new Blob(["crop"], { type: "image/jpeg" }));
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-crop");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    let finishUpload: ((result: unknown) => void) | undefined;
    const requested = vi.fn(
      () =>
        new Promise((resolve) => {
          finishUpload = resolve;
        }),
    );
    const queryUtils = {
      nodes: {
        icon: {
          createUploadUrl: { mutationOptions: () => ({ mutationFn: requested }) },
          confirm: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
        },
      },
    } as unknown as BusabaseQueryUtils;
    const onChange = renderPicker(imageIcon, vi.fn(), queryUtils);
    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.click(screen.getByRole("button", { name: /Upload image/ }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Edit icon" })).getByRole("button", {
        name: "Apply",
      }),
    );
    await waitFor(() => expect(requested).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    const restore = screen.getByRole("button", { name: /Restore default icon/ });
    expect((restore as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(restore);
    expect(onChange).not.toHaveBeenCalled();

    finishUpload?.({
      duplicate: true,
      publicUrl: "https://example.com/cropped.jpg",
      attachmentId: "cropped-icon",
    });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "attachment", attachmentId: "cropped-icon" }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Change icon" }));
    fireEvent.click(screen.getByRole("button", { name: /Restore default icon/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
