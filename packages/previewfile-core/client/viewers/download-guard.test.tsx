import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDownloadGuard } from "./download-guard";
import { ViewerLayoutProvider } from "./viewer-layout";

function Viewer({ noDownload }: { noDownload?: boolean }) {
  const guard = useDownloadGuard(noDownload);
  return <div data-guard={String(guard)} />;
}

const blocked = (event: Event) => {
  document.dispatchEvent(event);
  return event.defaultPrevented;
};
const save = () => new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true });
const menu = () => new MouseEvent("contextmenu", { cancelable: true });

describe("useDownloadGuard", () => {
  it("guards a share link that forbids downloading", () => {
    const { container, unmount } = render(<Viewer noDownload />);
    expect(container.querySelector("[data-guard]")?.getAttribute("data-guard")).toBe("true");
    expect(blocked(save())).toBe(true);
    expect(blocked(menu())).toBe(true);

    unmount();
    expect(blocked(save())).toBe(false);
  });

  it("leaves the host's page alone when embedded", () => {
    const { container } = render(
      <ViewerLayoutProvider layout="fill">
        <Viewer noDownload />
      </ViewerLayoutProvider>,
    );
    expect(container.querySelector("[data-guard]")?.getAttribute("data-guard")).toBe("false");
    expect(blocked(save())).toBe(false);
    expect(blocked(menu())).toBe(false);
  });

  it("does nothing when downloading is allowed", () => {
    render(<Viewer />);
    expect(blocked(menu())).toBe(false);
  });
});
