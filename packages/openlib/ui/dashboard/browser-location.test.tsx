// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { type ReactElement, useInsertionEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSearch as useWouterSearch } from "wouter/use-browser-location";
import { useNextSafeBrowserLocation, useNextSafeSearch } from "./browser-location";

const INSERTION_UPDATE_ERROR = "useInsertionEffect must not schedule updates";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/** What the App Router's HistoryUpdater does on back/forward. */
function NextLikeHistoryWrite({ url }: { url: string }) {
  useInsertionEffect(() => {
    window.history.replaceState({ __NA: true }, "", url);
  }, [url]);
  return null;
}

function SafeProbe() {
  const [path] = useNextSafeBrowserLocation();
  const search = useNextSafeSearch();
  return <output>{`${path}${search}`}</output>;
}

function WouterProbe() {
  return <output>{useWouterSearch()}</output>;
}

/** Mounts `probe`, then commits a Next-style history write that changes the URL. */
const renderWithNextWrite = async (probe: ReactElement) => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let showWrite: (value: boolean) => void = () => undefined;
  function Harness() {
    const [write, setWrite] = useState(false);
    showWrite = setWrite;
    return (
      <>
        {probe}
        {write ? <NextLikeHistoryWrite url="/home?from=next" /> : null}
      </>
    );
  }
  const view = render(<Harness />);
  await act(async () => {
    showWrite(true);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const insertionErrors = consoleError.mock.calls.filter((call) =>
    call.some((arg) => String(arg).includes(INSERTION_UPDATE_ERROR)),
  ).length;
  return { insertionErrors, text: view.container.textContent };
};

describe("Next.js router bookkeeping writes", () => {
  it("make wouter's own hook schedule updates inside an insertion effect (the bug)", async () => {
    const { insertionErrors } = await renderWithNextWrite(<WouterProbe />);
    expect(insertionErrors).toBeGreaterThan(0);
  });

  it("reach the safe hooks only after the commit, so nothing is scheduled inside it", async () => {
    const { insertionErrors, text } = await renderWithNextWrite(<SafeProbe />);
    expect(insertionErrors).toBe(0);
    expect(text).toBe("/home?from=next");
  });
});

describe("every other location change", () => {
  it("still re-renders on a navigation", () => {
    const view = render(<SafeProbe />);
    act(() => {
      window.history.pushState(null, "", "/base/tasks?view=grid");
    });
    expect(view.container.textContent).toBe("/base/tasks?view=grid");
  });

  it("still re-renders on an ordinary replaceState", () => {
    const view = render(<SafeProbe />);
    act(() => {
      window.history.replaceState({ app: "state" }, "", "/inbox?view=merged");
    });
    expect(view.container.textContent).toBe("/inbox?view=merged");
  });

  it("still re-renders on back/forward (popstate)", () => {
    const view = render(<SafeProbe />);
    act(() => {
      window.history.pushState(null, "", "/a");
      window.history.pushState(null, "", "/b");
    });
    act(() => {
      window.history.replaceState(null, "", "/a");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(view.container.textContent).toBe("/a");
  });
});
