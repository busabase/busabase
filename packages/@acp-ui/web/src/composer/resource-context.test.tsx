import type { AcpResourceContext } from "@acp-ui/core/reduce";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcpComposer } from "./acp-composer";

const context = (id: string): AcpResourceContext => ({
  id,
  name: `Find records · Visits ${id}`,
  uri: `context:///${id}`,
  mimeType: "text/plain",
  text: `<script>unsafe()</script>\n\n完整上下文 ${id}`,
});
const paste = () => {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: () => "whole prompt" } });
  fireEvent(screen.getByRole("textbox"), event);
  return event;
};
const submit = () => screen.getByRole("button", { name: "Submit" });

describe("resource context drafts", () => {
  it("intercepts only decoded metadata, preserves text/files, inspects escaped full content, and removes by keyboard", async () => {
    const onSend = vi.fn();
    const first = context("one");
    const decodePaste = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce([first]);
    render(<AcpComposer disabled={false} onSend={onSend} decodePaste={decodePaste} />);
    await userEvent.type(screen.getByRole("textbox"), "Keep typed text");
    const upload = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(upload, new File(["notes"], "notes.md", { type: "text/markdown" }));
    expect(paste().defaultPrevented).toBe(false);
    expect(paste().defaultPrevented).toBe(true);
    expect(screen.getByRole("textbox")).toHaveValue("Keep typed text");
    expect(screen.getByText("notes.md")).toBeVisible();
    const inspect = screen.getByRole("button", { name: `Inspect context: ${first.name}` });
    inspect.focus();
    await userEvent.keyboard("{Enter}");
    expect(inspect).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("region", { name: `Context content: ${first.name}` }).textContent).toBe(
      first.text,
    );
    expect(document.querySelector("script")).toBeNull();
    screen.getByRole("button", { name: "Remove context" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("Keep typed text");
    expect(screen.getByText("notes.md")).toBeVisible();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("keeps repeated paste insertions ordered and supports context-only submit with a third argument", async () => {
    const onSend = vi.fn();
    const first = context("first");
    const second = context("second");
    const change = vi.fn();
    const decodePaste = vi.fn().mockReturnValueOnce([first]).mockReturnValueOnce([second]);
    render(
      <AcpComposer
        disabled={false}
        onSend={onSend}
        decodePaste={decodePaste}
        onResourceContextChange={change}
      />,
    );
    paste();
    paste();
    expect(
      screen
        .getAllByRole("button", { name: /^Inspect context:/ })
        .map((button) => button.textContent),
    ).toEqual([first.name, second.name]);
    await userEvent.click(submit());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", undefined, [first, second]));
    expect(screen.queryByRole("button", { name: /^Inspect context:/ })).not.toBeInTheDocument();
    expect(change).toHaveBeenLastCalledWith([]);
  });

  it("merges one-shot handoffs, including old ids reappearing, without adding blank text", async () => {
    const onSend = vi.fn();
    const applied = vi.fn();
    const first = { id: "handoff-1", text: "", resourceContext: [context("first")] };
    const second = { id: "handoff-2", text: "", resourceContext: [context("second")] };
    const { rerender } = render(
      <AcpComposer disabled={false} onSend={onSend} draft={first} onDraftApplied={applied} />,
    );
    await userEvent.type(screen.getByRole("textbox"), "My instruction");
    rerender(
      <AcpComposer disabled={false} onSend={onSend} draft={second} onDraftApplied={applied} />,
    );
    rerender(
      <AcpComposer disabled={false} onSend={onSend} draft={first} onDraftApplied={applied} />,
    );
    expect(applied).toHaveBeenCalledTimes(2);
    expect(onSend).not.toHaveBeenCalled();
    await userEvent.click(submit());
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith("My instruction", undefined, [
        ...first.resourceContext,
        ...second.resourceContext,
      ]),
    );
  });

  it("preserves contexts on rejection and a newer handoff after successful retry", async () => {
    let reject: (error: unknown) => void = () => undefined;
    let accept: () => void = () => undefined;
    const onSend = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, rejectSend) => {
            reject = rejectSend;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            accept = resolve;
          }),
      );
    const first = { id: "one", text: "original", resourceContext: [context("first")] };
    const second = { id: "two", text: "new", resourceContext: [context("second")] };
    const { rerender } = render(<AcpComposer disabled={false} onSend={onSend} draft={first} />);
    await userEvent.click(submit());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Remove context" })).toBeDisabled();
    await act(async () => reject(new Error("not accepted")));
    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("original"));
    await userEvent.click(submit());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    rerender(<AcpComposer disabled={false} onSend={onSend} draft={second} />);
    await act(async () => accept());
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: `Inspect context: ${context("first").name}` }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: `Inspect context: ${context("second").name}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("new");
  });

  it("does not stage disabled pastes and tolerates decoder failures", () => {
    const decoder = vi.fn(() => {
      throw new Error("bad clipboard");
    });
    const { rerender } = render(
      <AcpComposer disabled={false} onSend={vi.fn()} decodePaste={decoder} />,
    );
    expect(paste().defaultPrevented).toBe(false);
    rerender(<AcpComposer disabled onSend={vi.fn()} decodePaste={decoder} />);
    paste();
    expect(decoder).toHaveBeenCalledTimes(1);
  });

  it("localizes context controls and keeps long labels constrained", async () => {
    const long = { ...context("long"), name: "很长的上下文名称".repeat(80) };
    render(
      <AcpComposer
        disabled={false}
        onSend={vi.fn()}
        draft={{ id: "localized", text: "", resourceContext: [long] }}
        labels={{
          inspectContext: "检查上下文",
          removeContext: "移除上下文",
          contextContent: "完整内容",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: `检查上下文: ${long.name}` }));
    expect(screen.getByRole("region", { name: `完整内容: ${long.name}` }).textContent).toBe(
      long.text,
    );
    expect(screen.getByText(long.name)).toHaveClass("truncate", "max-w-60");
    expect(screen.getByRole("button", { name: "移除上下文" })).toBeInTheDocument();
  });
});

describe("host context admission limits", () => {
  it("keeps existing 20 contexts/files/text and falls back to complete handoff text for the 21st", async () => {
    const existing = Array.from({ length: 20 }, (_, index) => context(`existing-${index}`));
    const incoming = context("incoming");
    const onSend = vi.fn();
    const applied = vi.fn();
    const validateResourceContext = (contexts: readonly AcpResourceContext[]) =>
      contexts.length <= 20;
    const props = { disabled: false, onSend, onDraftApplied: applied, validateResourceContext };
    const { rerender } = render(
      <AcpComposer
        {...props}
        draft={{ id: "first-twenty", text: "Keep my instruction", resourceContext: existing }}
      />,
    );
    const upload = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(upload, new File(["notes"], "notes.md", { type: "text/markdown" }));
    rerender(
      <AcpComposer
        {...props}
        draft={{ id: "twenty-first", text: "Additional instruction", resourceContext: [incoming] }}
      />,
    );
    expect(screen.getAllByRole("button", { name: /^Inspect context:/ })).toHaveLength(20);
    expect(screen.getByRole("textbox")).toHaveValue(
      `Keep my instruction\nAdditional instruction\n${incoming.text}`,
    );
    expect(screen.getByText("notes.md")).toBeVisible();
    expect(applied).toHaveBeenCalledWith("twenty-first");
    await userEvent.click(submit());
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0]?.[0]).toBe(
      `Keep my instruction\nAdditional instruction\n${incoming.text}`,
    );
    expect(onSend.mock.calls[0]?.[2]).toEqual(existing);
  });

  it("leaves a paste native when the combined contexts exceed a host limit or validation throws", () => {
    const existing = [context("existing")];
    const incoming = context("incoming");
    const decodePaste = () => [incoming];
    const validate = vi.fn((contexts: readonly AcpResourceContext[]) => contexts.length <= 1);
    const props = {
      disabled: false,
      onSend: vi.fn(),
      decodePaste,
      validateResourceContext: validate,
    };
    const { rerender } = render(
      <AcpComposer
        {...props}
        draft={{ id: "existing", text: "preserved", resourceContext: existing }}
      />,
    );
    expect(paste().defaultPrevented).toBe(false);
    expect(validate).toHaveBeenLastCalledWith([...existing, incoming]);
    expect(screen.getAllByRole("button", { name: /^Inspect context:/ })).toHaveLength(1);
    expect(screen.getByRole("textbox")).toHaveValue("preserved");
    rerender(
      <AcpComposer
        {...props}
        validateResourceContext={() => {
          throw new Error("Cannot validate");
        }}
      />,
    );
    expect(paste().defaultPrevented).toBe(false);
  });
});
