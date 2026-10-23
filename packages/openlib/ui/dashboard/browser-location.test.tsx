// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { type ReactElement, useInsertionEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate, useSearch as useWouterSearch } from "wouter/use-browser-location";
import { useNextSafeBrowserLocation, useNextSafeSearch } from "./browser-location";

const INSERTION_UPDATE_ERROR = "useInsertionEffect must not schedule updates";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/** What the App Router's HistoryUpdater does on back/forward. */
function NextLikeHistoryWrite({
  url,
  method = "replaceState",
  state = { __NA: true },
}: {
  url: string;
  method?: "pushState" | "replaceState";
  state?: unknown;
}) {
  useInsertionEffect(() => {
    window.history[method](state, "", url);
  }, [url, method, state]);
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
const renderWithNextWrite = async (
  probe: ReactElement,
  writeProps: { method?: "pushState" | "replaceState"; state?: unknown } = {},
) => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let showWrite: (value: boolean) => void = () => undefined;
  function Harness() {
    const [write, setWrite] = useState(false);
    showWrite = setWrite;
    return (
      <>
        {probe}
        {write ? <NextLikeHistoryWrite url="/home?from=next" {...writeProps} /> : null}
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
  it.each(["pushState", "replaceState"] as const)(
    "%s makes wouter's own hook schedule updates inside an insertion effect (the bug)",
    async (method) => {
      const { insertionErrors } = await renderWithNextWrite(<WouterProbe />, { method });
      expect(insertionErrors).toBeGreaterThan(0);
    },
  );

  it.each(["pushState", "replaceState"] as const)(
    "%s reaches the safe hooks only after the commit, so nothing is scheduled inside it",
    async (method) => {
      const { insertionErrors, text } = await renderWithNextWrite(<SafeProbe />, { method });
      expect(insertionErrors).toBe(0);
      expect(text).toBe("/home?from=next");
    },
  );
});

describe("all commit-phase navigation writes", () => {
  it.each([
    { method: "pushState" as const, state: { __NA: true } },
    { method: "pushState" as const, state: null },
    { method: "replaceState" as const, state: null },
  ])("defers $method notifications regardless of Next bookkeeping markers", async (writeProps) => {
    const { insertionErrors, text } = await renderWithNextWrite(<SafeProbe />, writeProps);
    expect(insertionErrors).toBe(0);
    expect(text).toBe("/home?from=next");
  });
});

describe("every other location change", () => {
  it("still re-renders on a navigation", async () => {
    const view = render(<SafeProbe />);
    await act(async () => {
      window.history.pushState(null, "", "/base/tasks?view=grid");
    });
    expect(view.container.textContent).toBe("/base/tasks?view=grid");
  });

  it("still re-renders on an ordinary replaceState", async () => {
    const view = render(<SafeProbe />);
    await act(async () => {
      window.history.replaceState({ app: "state" }, "", "/inbox?view=merged");
    });
    expect(view.container.textContent).toBe("/inbox?view=merged");
  });

  it("still re-renders on back/forward (popstate)", async () => {
    const view = render(<SafeProbe />);
    await act(async () => {
      window.history.pushState(null, "", "/a");
      window.history.pushState(null, "", "/b");
    });
    await act(async () => {
      window.history.replaceState(null, "", "/a");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(view.container.textContent).toBe("/a");
  });
});

describe("location notification timing", () => {
  it("updates the URL synchronously while notifying hooks after a microtask", async () => {
    const view = render(<SafeProbe />);
    await act(async () => {
      navigate("/settings?tab=channels");
      expect(location.pathname + location.search).toBe("/settings?tab=channels");
      expect(view.container.textContent).toBe("/");
    });
    expect(view.container.textContent).toBe("/settings?tab=channels");
    await act(async () => {
      navigate("/settings?tab=billing", { replace: true });
    });
    expect(view.container.textContent).toBe("/settings?tab=billing");
  });

  it("tracks real Back and Forward navigation, including query-only entries", async () => {
    const view = render(<SafeProbe />);
    await act(async () => {
      navigate("/tasks?view=list");
      navigate("/tasks?view=grid");
    });
    expect(view.container.textContent).toBe("/tasks?view=grid");
    await act(async () => {
      const popped = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.back();
      await popped;
    });
    expect(view.container.textContent).toBe("/tasks?view=list");
    await act(async () => {
      const popped = new Promise<void>((resolve) =>
        window.addEventListener("popstate", () => resolve(), { once: true }),
      );
      history.forward();
      await popped;
    });
    expect(view.container.textContent).toBe("/tasks?view=grid");
  });

  it("ignores queued location notifications after the subscriber unmounts", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<SafeProbe />);
    await act(async () => {
      navigate("/gone?tab=channels");
      view.unmount();
    });
    expect(error).not.toHaveBeenCalled();
  });
});
