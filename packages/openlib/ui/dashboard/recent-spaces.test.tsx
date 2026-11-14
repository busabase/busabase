/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  orderSpacesByRecent,
  RECENT_SPACES_LIMIT,
  RecentSpaceIdsProvider,
  rememberRecentSpace,
  useAccountRecentSpaceIds,
  useCookieRecentSpaceIds,
  useRecentSpaceIds,
  useStoredRecentSpaceIds,
} from "./recent-spaces";

const COOKIE = "test-recent-spaces";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  // biome-ignore lint/suspicious/noDocumentCookie: test cleanup of the cookie under test
  document.cookie = `${COOKIE}=; path=/; max-age=0`;
});

const spaces = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase() }));
const ids = (list: { id?: string }[]) => list.map((space) => space.id);

describe("orderSpacesByRecent", () => {
  it("puts recently active spaces first and keeps the host's order for the rest", () => {
    expect(ids(orderSpacesByRecent(spaces, ["d", "b"]))).toEqual(["d", "b", "a", "c", "e"]);
  });

  it("keeps the host's order without a history, and ignores ids of spaces no longer listed", () => {
    expect(ids(orderSpacesByRecent(spaces, []))).toEqual(["a", "b", "c", "d", "e"]);
    expect(ids(orderSpacesByRecent(spaces, ["gone", "c"]))).toEqual(["c", "a", "b", "d", "e"]);
  });

  it("leaves a space without an id where the host put it among the unvisited", () => {
    const withAnonymous = [{ id: undefined, name: "No id" }, ...spaces];
    expect(ids(orderSpacesByRecent(withAnonymous, ["e"]))).toEqual([
      "e",
      undefined,
      "a",
      "b",
      "c",
      "d",
    ]);
  });
});

describe("rememberRecentSpace", () => {
  it("moves the space to the front without duplicating it, bounded to the limit", () => {
    expect(rememberRecentSpace(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(rememberRecentSpace(["a", "b", "c"], "z", 3)).toEqual(["z", "a", "b"]);
    const full = Array.from({ length: RECENT_SPACES_LIMIT }, (_, index) => `s${index}`);
    expect(rememberRecentSpace(full, "new")).toHaveLength(RECENT_SPACES_LIMIT);
  });
});

describe("useRecentSpaceIds", () => {
  it("records each space that becomes active, most recent first, and keeps it across reloads", () => {
    const { result, rerender, unmount } = renderHook(({ active }) => useRecentSpaceIds(active), {
      initialProps: { active: "a" as string | undefined },
    });
    expect(result.current).toEqual(["a"]);

    rerender({ active: "c" });
    rerender({ active: "b" });
    expect(result.current).toEqual(["b", "c", "a"]);
    unmount();

    // A fresh mount (page reload) before the host knows the active space.
    const reloaded = renderHook(() => useRecentSpaceIds(undefined));
    expect(reloaded.result.current).toEqual(["b", "c", "a"]);
  });

  it("starts empty when storage holds something it did not write", () => {
    window.localStorage.setItem("openlib:recent-space-ids", "{not json");
    expect(renderHook(() => useRecentSpaceIds(undefined)).result.current).toEqual([]);
    window.localStorage.setItem("openlib:recent-space-ids", JSON.stringify([1, "", "a"]));
    expect(renderHook(() => useRecentSpaceIds(undefined)).result.current).toEqual(["a"]);
  });

  it("uses the host's history when one is provided, and leaves localStorage alone", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RecentSpaceIdsProvider value={["x", "y"]}>{children}</RecentSpaceIdsProvider>
    );
    const { result } = renderHook(() => useRecentSpaceIds("a"), { wrapper });

    expect(result.current).toEqual(["x", "y"]);
    expect(window.localStorage.getItem("openlib:recent-space-ids")).toBeNull();
  });
});

describe("useCookieRecentSpaceIds", () => {
  const useHistory = (props: { userId?: string; activeSpaceId?: string; cookieDomain?: string }) =>
    useCookieRecentSpaceIds({
      cookieName: COOKIE,
      userId: props.userId,
      activeSpaceId: props.activeSpaceId,
      cookieDomain: props.cookieDomain,
    });

  it("keeps the history in a cookie, so a page on another host of the domain reads it back", () => {
    const first = renderHook((props) => useHistory(props), {
      initialProps: { userId: "u1", activeSpaceId: "a" } as {
        userId?: string;
        activeSpaceId?: string;
      },
    });
    first.rerender({ userId: "u1", activeSpaceId: "b" });
    expect(first.result.current).toEqual(["b", "a"]);
    first.unmount();

    // A fresh page (another workspace subdomain) before its active space resolves.
    expect(renderHook(() => useHistory({ userId: "u1" })).result.current).toEqual(["b", "a"]);
    expect(window.localStorage.getItem("openlib:recent-space-ids")).toBeNull();
  });

  it("gives another account its own history and records nothing without a user", () => {
    renderHook(() => useHistory({ userId: "u1", activeSpaceId: "a" }));
    expect(renderHook(() => useHistory({ userId: "u2" })).result.current).toEqual([]);
    expect(renderHook(() => useHistory({ activeSpaceId: "z" })).result.current).toEqual([]);
    expect(renderHook(() => useHistory({ userId: "u1" })).result.current).toEqual(["a"]);
  });

  it("sets the cookie on the workspace base domain, without its port, and host-only on localhost", () => {
    const writes: string[] = [];
    vi.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
      writes.push(value);
    });
    renderHook(() => useHistory({ userId: "u1", activeSpaceId: "a", cookieDomain: "lvh.me:3000" }));
    renderHook(() =>
      useHistory({ userId: "u1", activeSpaceId: "a", cookieDomain: "localhost:3000" }),
    );
    renderHook(() => useHistory({ userId: "u1", activeSpaceId: "a" }));

    expect(writes[0]).toContain("; domain=.lvh.me");
    expect(writes[1]).not.toContain("domain=");
    expect(writes[2]).not.toContain("domain=");
  });
});

describe("useAccountRecentSpaceIds", () => {
  type Props = {
    activeSpaceId?: string;
    enabled?: boolean;
    account?: readonly string[];
    seed?: readonly string[];
  };
  const setup = (recordVisit: ReturnType<typeof vi.fn>, initial: Props = {}) =>
    renderHook(
      ({ activeSpaceId, enabled = true, account, seed = [] }: Props) =>
        useAccountRecentSpaceIds({
          activeSpaceId,
          enabled,
          accountRecentSpaceIds: account,
          recordVisit: recordVisit as never,
          seedRecentSpaceIds: seed,
        }),
      { initialProps: initial },
    );

  it("records each space that becomes active, with the browser history as the seed", async () => {
    const recordVisit = vi.fn(async ({ id }: { id: string }) => [id, "old"]);
    const { rerender } = setup(recordVisit, { activeSpaceId: "a", seed: ["x", "y"] });
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1));
    expect(recordVisit).toHaveBeenLastCalledWith({ id: "a", seedRecentSpaceIds: ["x", "y"] });

    rerender({ activeSpaceId: "b", seed: ["x", "y"] });
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(2));
    expect(recordVisit).toHaveBeenLastCalledWith({ id: "b", seedRecentSpaceIds: ["x", "y"] });

    // Re-rendering with the same space and the same seed records nothing more.
    rerender({ activeSpaceId: "b", seed: ["x", "y"] });
    expect(recordVisit).toHaveBeenCalledTimes(2);
  });

  it("lists the account's spaces, falls back to the seed, and keeps the active one first", async () => {
    const recordVisit = vi.fn(async () => ["s2", "s9"]);
    const none = setup(recordVisit, { activeSpaceId: undefined, seed: ["x", "y"], account: [] });
    expect(none.result.current).toEqual(["x", "y"]);

    const loaded = setup(recordVisit, { activeSpaceId: "s5", account: ["s1", "s2"], seed: ["x"] });
    // Before the server answers, the space on screen leads the account's list.
    expect(loaded.result.current).toEqual(["s5", "s1", "s2"]);
    // After, the server's list wins, still with the space on screen first.
    await waitFor(() => expect(loaded.result.current).toEqual(["s5", "s2", "s9"]));
  });

  it("does nothing when disabled or when the server refuses, and orders from what it has", async () => {
    const recordVisit = vi.fn(async () => {
      throw new Error("offline");
    });
    const disabled = setup(recordVisit, { activeSpaceId: "a", enabled: false, seed: ["x"] });
    expect(recordVisit).not.toHaveBeenCalled();
    expect(disabled.result.current).toEqual(["x"]);

    const failing = setup(recordVisit, { activeSpaceId: "a", account: ["b"] });
    await waitFor(() => expect(recordVisit).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(failing.result.current).toEqual(["a", "b"]);
  });
});

describe("useStoredRecentSpaceIds", () => {
  it("reads the browser's older history after mount", async () => {
    window.localStorage.setItem("openlib:recent-space-ids", JSON.stringify(["a", "b"]));
    const { result } = renderHook(() => useStoredRecentSpaceIds());
    await waitFor(() => expect(result.current).toEqual(["a", "b"]));
  });
});
