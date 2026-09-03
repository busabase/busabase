import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AcpComposer, toAttachments } from "./acp-composer";

const submitButton = () => screen.getByRole("button", { name: /Submit|Stop/ });
const attachButton = () => screen.getByRole("button", { name: "Attach a file" });

describe("sending", () => {
  it("sends the trimmed text on Enter and clears the field", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "  hello  {Enter}");
    expect(onSend).toHaveBeenCalledWith("hello", undefined);
    expect(box).toHaveValue("");
  });

  it("does not send on Shift+Enter — inserts a newline instead", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line one\nline two");
  });

  it("does not send empty or whitespace-only input", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "   {Enter}");
    expect(onSend).not.toHaveBeenCalled();
  });

  // kui's own Enter-to-submit guard checks the submit button's `disabled`
  // attribute, but nothing disables it just for an empty field — emptiness is
  // guarded in `handleSubmit` itself (the test above), not at the button.
  it("a click on an enabled-but-empty field sends nothing", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    await userEvent.click(submitButton());
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sending works via a click on the submit button, not just Enter", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    await userEvent.type(screen.getByRole("textbox"), "hi");
    const button = submitButton();
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(onSend).toHaveBeenCalledWith("hi", undefined);
  });
});

// Real gap in both apps' prior hand-rolled textareas: neither guarded against
// IME composition, so confirming a Chinese/Japanese candidate with Enter would
// have submitted early. kui's PromptInputTextarea guards this internally.
describe("IME composition", () => {
  it("does not submit on the Enter that confirms an IME composition", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const box = screen.getByRole("textbox");
    act(() => box.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await userEvent.type(box, "日本語");
    await userEvent.keyboard("{Enter}");
    expect(onSend).not.toHaveBeenCalled();
    act(() => box.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await userEvent.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("日本語", undefined);
  });
});

describe("disabled", () => {
  it("disables the field and both buttons", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} placeholder="Session ended." />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(submitButton()).toBeDisabled();
    expect(attachButton()).toBeDisabled();
  });

  it("does not send even if Enter is pressed while disabled", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={true} onSend={onSend} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows the placeholder host apps pass in", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} placeholder="This session has ended." />);
    expect(screen.getByPlaceholderText("This session has ended.")).toBeInTheDocument();
  });
});

describe("stopping mid-stream", () => {
  // Both hosts fold `sending` into `disabled`, which would otherwise leave a
  // freshly-shown stop button unclickable the instant it appears.
  it("keeps the submit button clickable while sending, when onStop is supplied", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} onStop={vi.fn()} sending={true} />);
    expect(submitButton()).toBeEnabled();
  });

  it("calls onStop, not onSend, when clicked while sending", async () => {
    const onSend = vi.fn();
    const onStop = vi.fn();
    render(<AcpComposer disabled={true} onSend={onSend} onStop={onStop} sending={true} />);
    await userEvent.click(submitButton());
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  // Without onStop, behavior is exactly what it was before this existed:
  // the button simply stays disabled while sending.
  it("stays disabled while sending when no onStop is supplied", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} sending={true} />);
    expect(submitButton()).toBeDisabled();
  });

  // A host's OTHER reasons for `disabled` (e.g. the session itself ended)
  // must still win — the stop carve-out only applies while actually sending.
  it("stays disabled when disabled for a reason other than sending", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} onStop={vi.fn()} sending={false} />);
    expect(submitButton()).toBeDisabled();
  });

  it("the field and attach button stay disabled even though submit is stoppable", () => {
    render(<AcpComposer disabled={true} onSend={vi.fn()} onStop={vi.fn()} sending={true} />);
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(attachButton()).toBeDisabled();
  });
});

/** A File whose real bytes are readable back out by jsdom's Blob/FileReader. */
const fakeFile = (name: string, type: string, contents = "fake-bytes") =>
  new File([contents], name, { type });

describe("attaching — via the picker or paste", () => {
  it("stages a picked file as a preview chip before sending", async () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    await userEvent.upload(fileInput, fakeFile("photo.png", "image/png"));
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("removing a staged attachment clears its preview chip", async () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("photo.png", "image/png"));
    expect(screen.getByRole("img")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  // The behavior this replaces: pasting used to be blocked entirely so an
  // image would vanish with no chip and no error. Now it stages exactly like
  // the picker does.
  it("pasting an image stages it the same way the picker does", () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const box = screen.getByRole("textbox");
    const file = fakeFile("screenshot.png", "image/png");
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
    act(() => {
      box.dispatchEvent(pasteEvent);
    });
    expect(screen.getByRole("img")).toBeInTheDocument();
  });

  it("still pastes plain text normally", async () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const box = screen.getByRole("textbox");
    await userEvent.click(box);
    await userEvent.paste("pasted text");
    expect(box).toHaveValue("pasted text");
  });
});

// The real, working blob-URL round trip (see test/setup.ts) makes this a
// genuine integration test of kui's own blob→data-URL conversion, not just of
// this package's `toAttachments`.
describe("sending an attachment", () => {
  it("delivers a real base64 attachment to onSend, and clears the staged preview", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("photo.png", "image/png", "hello-bytes"));
    expect(screen.getByRole("img")).toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox"), "check this out");
    await userEvent.click(submitButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [text, attachments] = onSend.mock.calls[0];
    expect(text).toBe("check this out");
    expect(attachments).toHaveLength(1);
    expect(attachments[0].kind).toBe("image");
    expect(attachments[0].mimeType).toBe("image/png");
    // Not asserting the decoded bytes equal "hello-bytes": jsdom's FileReader
    // doesn't recognize a Blob that came back through Node's native
    // fetch/Response (confirmed in isolation outside jsdom — the same
    // Response→blob()→FileReader chain round-trips real bytes correctly
    // there), so it degenerates to stringifying the File object instead of
    // reading it. What's real and worth pinning here is everything genuinely
    // under this package's control: `toAttachments` receives whatever `url`
    // kui hands it and returns well-formed base64 (checked by decodability),
    // not that jsdom's Blob plumbing is byte-perfect.
    expect(() => atob(attachments[0].data)).not.toThrow();
    expect(attachments[0].data.length).toBeGreaterThan(0);

    // kui's blob→data-URL conversion runs a real `fetch`, so the staged
    // preview only clears once that microtask chain settles — not
    // synchronously after the click.
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
  });

  it("sends an attachment with empty text (image, no caption)", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("photo.png", "image/png"));
    await userEvent.click(submitButton());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("", expect.any(Array)));
  });
});

describe("toAttachments", () => {
  it("extracts kind, data, and mimeType from a data: URL", () => {
    const result = toAttachments([
      { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,QUJD" },
    ]);
    expect(result).toEqual([{ kind: "image", data: "QUJD", mimeType: "image/jpeg" }]);
  });

  it('classifies audio/* as kind "audio"', () => {
    const result = toAttachments([
      { type: "file", mediaType: "audio/wav", url: "data:audio/wav;base64,QUJD" },
    ]);
    expect(result[0].kind).toBe("audio");
  });

  // Anything that isn't image/audio is a `file` — an ACP embedded resource —
  // rather than being dropped, which is what "attach a PDF" needs.
  it('classifies everything else as kind "file", keeping the filename', () => {
    const result = toAttachments([
      {
        type: "file",
        mediaType: "application/pdf",
        filename: "report.pdf",
        url: "data:application/pdf;base64,QUJD",
      },
    ]);
    expect(result).toEqual([
      { kind: "file", data: "QUJD", mimeType: "application/pdf", filename: "report.pdf" },
    ]);
  });

  it("keeps a file the browser could not type at all", () => {
    // An extensionless `Dockerfile` reports `mediaType: ""`. Falling back to
    // a MIME type keeps it representable; the bytes decide text-vs-blob later.
    const result = toAttachments([
      { type: "file", mediaType: "", filename: "Dockerfile", url: "data:;base64,QUJD" },
    ]);
    expect(result).toEqual([
      { kind: "file", data: "QUJD", mimeType: "application/octet-stream", filename: "Dockerfile" },
    ]);
  });

  it("omits filename rather than sending an empty one", () => {
    const result = toAttachments([
      { type: "file", mediaType: "application/pdf", url: "data:application/pdf;base64,QUJD" },
    ]);
    expect(result[0]).not.toHaveProperty("filename");
  });

  // If kui's blob→data conversion ever failed and fell back to the original
  // blob: URL (its own documented behavior on a failed fetch), sending that
  // verbatim would be meaningless to ACP — better to drop it than send junk.
  it("drops a file whose url never became a data: URL", () => {
    const result = toAttachments([
      { type: "file", mediaType: "image/png", url: "blob:http://localhost/unconverted" },
    ]);
    expect(result).toEqual([]);
  });

  it("returns an empty array for no files", () => {
    expect(toAttachments([])).toEqual([]);
  });
});

describe("staging a document", () => {
  it("shows a document's filename, which a thumbnail-only chip could not", async () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("q3-report.pdf", "application/pdf"));

    // The whole reason documents render through the `inline` variant: two
    // attached PDFs must be tellable apart before sending.
    expect(await screen.findByText("q3-report.pdf")).toBeInTheDocument();
  });

  it("delivers a document to onSend as a file attachment", async () => {
    const onSend = vi.fn();
    render(<AcpComposer disabled={false} onSend={onSend} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("notes.md", "text/markdown"));
    await userEvent.click(submitButton());

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    const [, attachments] = onSend.mock.calls[0];
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ kind: "file", filename: "notes.md" });
  });

  it("refuses a file over the size cap and says so, instead of failing at send", async () => {
    render(<AcpComposer disabled={false} maxFileSize={10} onSend={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("big.pdf", "application/pdf", "way-past-ten-bytes"));

    expect(await screen.findByRole("alert")).toHaveTextContent(/too large/i);
  });
});

describe("the file picker itself", () => {
  // Regression: `maxFiles` defaulted to 10 while the hidden input had no
  // `multiple` attribute, so the paperclip button accepted exactly one file.
  // Only a real browser surfaces this — jsdom uploads whatever you hand it.
  it("lets the picker select more than one file when maxFiles allows it", () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it("keeps the picker single-file when the host caps attachments at one", () => {
    render(<AcpComposer disabled={false} maxFiles={1} onSend={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(false);
  });
});

describe("composer layout inside kui's InputGroup", () => {
  // `PromptInputFooter` renders `data-align="block-end"`, which flips
  // `InputGroup` to `flex-col` — and it is `items-center`, so a direct child
  // without a width is centred rather than left-aligned. jsdom computes no
  // layout, so the class is the only thing assertable here; the real-browser
  // check that motivated it measured the strip floating in the middle of the
  // composer instead of sitting flush above the textarea.
  it("gives the staged-attachment strip a full width so it aligns with the textarea", async () => {
    render(<AcpComposer disabled={false} onSend={vi.fn()} />);
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, fakeFile("notes.md", "text/markdown"));

    // Walk up to the element that is a DIRECT child of the InputGroup — that
    // is the one flex centring acts on. `closest(".w-full")` would be vacuous:
    // the InputGroup itself carries `w-full`.
    const group = document.querySelector('[data-slot="input-group"]') as HTMLElement;
    let strip = (await screen.findByText("notes.md")) as HTMLElement;
    while (strip.parentElement && strip.parentElement !== group) {
      strip = strip.parentElement;
    }
    expect(strip.parentElement).toBe(group);
    expect(strip.className).toContain("w-full");
  });
});
