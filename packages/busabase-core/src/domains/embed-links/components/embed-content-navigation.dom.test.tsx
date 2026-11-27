// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Dialog, DialogTitle } from "kui/dialog";
import { NProgressProvider } from "openlib/ui/nprogress";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";
import { useContentNavigationHandler } from "../../dashboard/content-navigation-context";
import type { EmbedTargetNodeVO } from "../types";
import { EmbedContentNavigation } from "./embed-content-navigation";

const progress = vi.hoisted(() => ({
  start: vi.fn(),
  done: vi.fn(),
  configure: vi.fn(),
}));
vi.mock("nprogress", () => ({ default: progress }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/embed/emb_abcdefghijklmnop/node",
  useSearchParams: () => new URLSearchParams("view=iframe"),
}));

const node: EmbedTargetNodeVO = {
  id: "node-delivery",
  type: "doc",
  slug: "delivery",
  name: "Delivery",
};
const physicalPath = "/embed/emb_abcdefghijklmnop/node?view=iframe";

beforeEach(() => {
  window.history.replaceState(null, "", physicalPath);
  progress.start.mockClear();
  progress.done.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function mount(
  children: ReactNode,
  options: { node?: EmbedTargetNodeVO; fixed?: boolean; path?: string; locale?: string } = {},
) {
  const currentNode = options.fixed ? undefined : (options.node ?? node);
  const location = memoryLocation({
    path:
      options.path ??
      (currentNode ? `/${currentNode.type}/${currentNode.slug}` : "/base/orders/rec-1"),
    record: true,
  });
  const mounted = render(
    <>
      {/* The real listener registers on document before the content guard mounts. */}
      <NProgressProvider>{null}</NProgressProvider>
      <a href="/doc/host-link" onClick={(event) => event.preventDefault()}>
        Unrelated host link
      </a>
      <Router hook={location.hook} searchHook={location.searchHook}>
        <EmbedContentNavigation locale={options.locale} node={currentNode}>
          {children}
        </EmbedContentNavigation>
      </Router>
    </>,
  );
  return { ...mounted, location };
}

describe("links authored inside an Embed", () => {
  it("explains an unavailable node link before the real website progress listener runs", () => {
    const authoredClick = vi.fn();
    const { location } = mount(
      <a href="/doc/another-node" onClick={authoredClick}>
        <em>Related document</em>
      </a>,
      { locale: "zh-CN" },
    );

    // Cancellation, not jsdom's lack of navigation, is what a browser honors.
    expect(fireEvent.click(screen.getByText("Related document"))).toBe(false);
    expect(screen.getByRole("status").textContent).toContain("此链接不包含在当前嵌入内容中。");
    expect(location.history).toEqual(["/doc/delivery"]);
    expect(authoredClick).not.toHaveBeenCalled();
    expect(progress.start).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "关闭提示" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }])(
    "keeps unavailable links out of new contexts too: %j",
    (modifiers) => {
      const { location } = mount(
        <a href="/base/secret" target="_top">
          Private base
        </a>,
      );

      const type = modifiers.button === 1 ? "auxclick" : "click";
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...modifiers });
      fireEvent(screen.getByText("Private base"), event);

      expect(event.defaultPrevented).toBe(true);
      expect(screen.getByRole("status").textContent).toContain(
        "This link is not included in the embedded content.",
      );
      expect(location.history).toEqual(["/doc/delivery"]);
      expect(progress.start).not.toHaveBeenCalled();
    },
  );

  it("retains Base view and record reading routes without starting Next navigation", () => {
    const { location } = mount(
      <>
        <Link href="/base/orders/design">Design</Link>
        <Link href="/base/orders/won">Won orders</Link>
        <Link href="/base/orders/rec-1">Open record</Link>
      </>,
      { node: { ...node, type: "base", slug: "orders" } },
    );

    expect(fireEvent.click(screen.getByText("Design"))).toBe(false);
    expect(screen.getByRole("status")).toBeDefined();
    expect(fireEvent.click(screen.getByText("Won orders"))).toBe(false);
    expect(location.history.at(-1)).toBe("/base/orders/won");
    expect(screen.queryByRole("status")).toBeNull();
    expect(fireEvent.click(screen.getByText("Open record"))).toBe(false);
    expect(location.history.at(-1)).toBe("/base/orders/rec-1");
    expect(location.history).toHaveLength(3);
    expect(progress.start).not.toHaveBeenCalled();
  });

  it("resolves a file-selection query against the memory route", () => {
    const { location } = mount(<a href="?file=notes.md">Notes</a>, {
      node: { ...node, type: "drive", slug: "handoff" },
      path: "/drive/handoff?file=README.md",
    });

    expect(fireEvent.click(screen.getByText("Notes"))).toBe(false);
    expect(location.history.at(-1)).toBe("/drive/handoff?file=notes.md");
    expect(progress.start).not.toHaveBeenCalled();
  });

  it("opens external web links safely without replacing the embedded content", () => {
    const { location } = mount(
      <a href="//external.example/guide" target="_parent" rel="nofollow">
        External guide
      </a>,
    );
    const anchor = screen.getByRole("link", { name: "External guide" }) as HTMLAnchorElement;

    expect(fireEvent.click(anchor)).toBe(true);
    expect(anchor.target).toBe("_blank");
    expect(anchor.relList.contains("noopener")).toBe(true);
    expect(anchor.relList.contains("noreferrer")).toBe(true);
    expect(anchor.relList.contains("nofollow")).toBe(true);
    expect(anchor.referrerPolicy).toBe("no-referrer");
    expect(location.history).toEqual(["/doc/delivery"]);
    expect(progress.start).not.toHaveBeenCalled();
  });

  it("retains authorized asset downloads and local document anchors", () => {
    mount(
      <>
        <a href="/embed/emb_abcdefghijklmnop/assets/ast_1/raw?token=fixture&download=1" download>
          Download file
        </a>
        <a href="#appendix" target="_top">
          Appendix
        </a>
        <h2 id="appendix">Appendix content</h2>
      </>,
    );

    expect(fireEvent.click(screen.getByText("Download file"))).toBe(true);
    expect(fireEvent.click(screen.getByText("Appendix"))).toBe(true);
    expect((screen.getByText("Appendix") as HTMLAnchorElement).target).toBe("_self");
    expect(screen.queryByRole("status")).toBeNull();
    expect(progress.start).not.toHaveBeenCalled();
  });

  it.each([
    "javascript:alert(document.cookie)",
    "data:text/html,<h1>another document</h1>",
    "https://user:password@example.com/guide",
    "/embed/emb_otherlink0000000/assets/ast_1/raw?download=1",
  ])("does not let schemes or a download attribute escape the boundary: %s", (href) => {
    mount(
      <a href="/doc/fixture" download>
        Unsupported link
      </a>,
    );
    const anchor = screen.getByText("Unsupported link");
    anchor.setAttribute("href", href);

    expect(fireEvent.click(anchor)).toBe(false);
    expect(screen.getByRole("status")).toBeDefined();
    expect(progress.start).not.toHaveBeenCalled();
  });

  it("does not intercept unrelated host DOM", () => {
    mount(<p>Embedded document</p>);

    fireEvent.click(screen.getByText("Unrelated host link"));

    expect(screen.queryByRole("status")).toBeNull();
    expect(progress.start).toHaveBeenCalledOnce();
  });

  it("covers record and attachment dialog portals and shows feedback inside the modal", () => {
    function RecordPreview() {
      const [open, setOpen] = useState(true);
      return (
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Record details</DialogTitle>
            <a href="/doc/unshared" target="_blank" rel="noopener">
              Markdown field link
            </a>
            <a
              href="/embed/emb_abcdefghijklmnop/assets/ast_1/raw?token=fixture&download=1"
              download
            >
              Attachment download
            </a>
          </DialogContent>
        </Dialog>
      );
    }
    mount(<RecordPreview />);
    const dialog = screen.getByRole("dialog");

    expect(fireEvent.click(within(dialog).getByText("Markdown field link"))).toBe(false);
    expect(within(dialog).getByRole("status").textContent).toContain(
      "This link is not included in the embedded content.",
    );
    // There must not also be a stale notice behind the modal's overlay.
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(progress.start).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
    expect(within(dialog).queryByRole("status")).toBeNull();
    expect(fireEvent.click(within(dialog).getByText("Attachment download"))).toBe(true);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);

    fireEvent.click(within(dialog).getByText("Markdown field link"));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
  });

  it("keeps feedback in the active attachment dialog and clears it when returning to its record", () => {
    function NestedPreviews() {
      const [attachmentOpen, setAttachmentOpen] = useState(false);
      return (
        <Dialog open>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Record preview</DialogTitle>
            <a href="/doc/outer-link">Record field link</a>
            <button onClick={() => setAttachmentOpen(true)} type="button">
              Open attachment
            </button>
            <Dialog onOpenChange={setAttachmentOpen} open={attachmentOpen}>
              <DialogContent aria-describedby={undefined}>
                <DialogTitle>Attachment preview</DialogTitle>
                <a href="/doc/inner-link">Attachment field link</a>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      );
    }
    mount(<NestedPreviews />);
    const record = screen.getByRole("dialog", { name: "Record preview" });
    fireEvent.click(within(record).getByRole("button", { name: "Open attachment" }));
    const attachment = screen.getByRole("dialog", { name: "Attachment preview" });

    fireEvent.click(within(attachment).getByText("Attachment field link"));
    expect(within(attachment).getAllByRole("status")).toHaveLength(1);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(record.querySelector('[role="status"]')).toBeNull();

    fireEvent.click(within(attachment).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Attachment preview" })).toBeNull();
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(0);
    fireEvent.click(within(record).getByText("Record field link"));
    expect(within(record).getAllByRole("status")).toHaveLength(1);
    expect(document.querySelectorAll('[role="status"]')).toHaveLength(1);
  });

  it("applies the same routing decision to validated HTML preview messages", () => {
    let openContentLink: ReturnType<typeof useContentNavigationHandler>;
    function Capture() {
      openContentLink = useContentNavigationHandler();
      return null;
    }
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const { location } = mount(<Capture />);

    // Invoke inside an event to match the preview's user-activation dispatch.
    const trigger = document.createElement("button");
    trigger.onclick = () => openContentLink?.(`${window.location.origin}/doc/x`);
    fireEvent.click(trigger);
    expect(screen.getByRole("status")).toBeDefined();
    expect(open).not.toHaveBeenCalled();
    expect(location.history).toEqual(["/doc/delivery"]);

    trigger.onclick = () => openContentLink?.("https://external.example/guide");
    fireEvent.click(trigger);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "https://external.example/guide",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("keeps safe contact and fragment actions available to the content handler", () => {
    let openContentLink: ReturnType<typeof useContentNavigationHandler>;
    function Capture() {
      openContentLink = useContentNavigationHandler();
      return <h2 id="appendix">Appendix</h2>;
    }
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    mount(<Capture />);
    const trigger = document.createElement("button");
    trigger.onclick = () => openContentLink?.("mailto:reader@example.com");
    fireEvent.click(trigger);
    expect(open).toHaveBeenCalledExactlyOnceWith(
      "mailto:reader@example.com",
      "_blank",
      "noopener,noreferrer",
    );

    trigger.onclick = () => openContentLink?.("#appendix");
    fireEvent.click(trigger);
    expect(window.location.hash).toBe("#appendix");
    expect(screen.queryByRole("status")).toBeNull();
    expect(progress.start).not.toHaveBeenCalled();
  });

  it.each(["record-detail", "change-request"])(
    "provides feedback on a fixed %s surface while preserving assets and local fragments",
    (surface) => {
      const path = `/embed/emb_abcdefghijklmnop/${surface}?view=iframe`;
      window.history.replaceState(null, "", path);
      const { location } = mount(
        <>
          <a href="/base/orders/rec-2">Another record</a>
          <a href="/embed/emb_abcdefghijklmnop/assets/ast_1/raw?token=fixture&download=1" download>
            Download attachment
          </a>
          <a href={`${path}#details`}>This preview section</a>
          <h2 id="details">Details</h2>
        </>,
        { fixed: true, path: "/base/orders/rec-1" },
      );

      expect(fireEvent.click(screen.getByText("Another record"))).toBe(false);
      expect(screen.getByRole("status").textContent).toContain(
        "This link is not included in the embedded content.",
      );
      expect(location.history).toEqual(["/base/orders/rec-1"]);
      expect(progress.start).not.toHaveBeenCalled();

      expect(fireEvent.click(screen.getByText("Download attachment"))).toBe(true);
      const download = screen.getByText("Download attachment") as HTMLAnchorElement;
      expect(download.relList.contains("noreferrer")).toBe(true);
      expect(screen.queryByRole("status")).toBeNull();
      expect(fireEvent.click(screen.getByText("This preview section"))).toBe(true);
      expect(screen.getByText("This preview section").getAttribute("href")).toBe("#details");
      expect(progress.start).not.toHaveBeenCalled();
    },
  );
});
