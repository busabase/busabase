import type { AcpResource } from "@acp-ui/core/reduce";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AcpResourceView } from "./resource-view";

afterEach(() => vi.restoreAllMocks());
const version = (fingerprint: string): AcpResource => ({
  id: "report",
  uri: "https://files.example/report.txt",
  name: "report.txt",
  mimeType: "text/plain",
  _meta: { "buda.im": { projectionFingerprint: fingerprint } },
});

describe("resource content revisions", () => {
  it("invalidates an open text preview when the same physical URI gets new content", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("First revision"))
      .mockResolvedValueOnce(new Response("Second revision"));
    const { rerender } = render(<AcpResourceView resource={version("first")} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("First revision")).toBeVisible();
    rerender(<AcpResourceView resource={version("second")} />);
    expect(screen.queryByText("First revision")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Second revision")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("https://files.example/report.txt");
    expect(fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store" });
  });
  it("ignores an old resolver completion and refreshes media for a new version with the same identity", async () => {
    let first: (value: AcpResource) => void = () => {};
    let second: (value: AcpResource) => void = () => {};
    const resolve = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<AcpResource>((done) => {
            first = done;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AcpResource>((done) => {
            second = done;
          }),
      );
    const original = {
      ...version("first"),
      uri: "buda://resource/report",
      mimeType: "image/png",
      name: "report.png",
    };
    const { rerender } = render(<AcpResourceView resource={original} resolveResource={resolve} />);
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    rerender(
      <AcpResourceView
        resource={{ ...original, _meta: { "buda.im": { projectionFingerprint: "second" } } }}
        resolveResource={resolve}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    await act(async () => first({ ...original, uri: "https://files.example/old.png" }));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeDisabled();
    await act(async () => second({ ...original, uri: "https://files.example/new.png" }));
    expect(await screen.findByRole("img", { name: "report.png" })).toHaveAttribute(
      "src",
      "https://files.example/new.png",
    );
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      "https://files.example/new.png",
    );
    expect(resolve).toHaveBeenCalledTimes(2);
  });
  it("clears a stale preview failure but keeps unchanged descriptors open", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Old version unavailable"))
      .mockResolvedValueOnce(new Response("Recovered revision"));
    const first = version("first");
    const next = version("second");
    const { rerender } = render(<AcpResourceView resource={first} />);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Old version unavailable");
    rerender(<AcpResourceView resource={next} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Recovered revision")).toBeVisible();
    rerender(<AcpResourceView resource={{ ...next }} />);
    expect(screen.getByText("Recovered revision")).toBeVisible();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
