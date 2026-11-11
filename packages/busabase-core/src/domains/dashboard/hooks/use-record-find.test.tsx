// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordFindState } from "../helpers/record-find-url";
import { useRecordFind } from "./use-record-find";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const initial = { query: "", fieldId: "" };
function setup(value = initial) {
  const commits = vi.fn();
  const hook = renderHook(
    ({ scope }) => {
      const [committed, setCommitted] = useState(value);
      const onCommit = useCallback((next: RecordFindState) => {
        commits(next);
        setCommitted(next);
      }, []);
      return useRecordFind({ scope, value: committed, onCommit });
    },
    { initialProps: { scope: "base:view" } },
  );
  return { ...hook, commits };
}

describe("record find request lifecycle", () => {
  it("prepares empty and whitespace-only field choices without pending or committing", () => {
    const { result, commits } = setup();
    act(() => result.current.setFieldId("fld_customer"));
    expect(result.current.fieldId).toBe("fld_customer");
    expect(result.current.isPending).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
    act(() => result.current.setQuery("   "));
    act(() => result.current.setFieldId("fld_json"));
    expect(result.current.isPending).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
    expect(result.current.fieldId).toBe("fld_json");

    act(() => result.current.setQuery(" Acme "));
    expect(result.current.isPending).toBe(true);
    act(() => vi.advanceTimersByTime(499));
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toHaveBeenCalledExactlyOnceWith({ query: "Acme", fieldId: "fld_json" });
  });

  it("restarts find when a committed keyword's field changes", () => {
    const { result, commits } = setup({ query: "Acme", fieldId: "" });
    act(() => result.current.setFieldId("fld_customer"));
    expect(result.current.isPending).toBe(true);
    act(() => vi.advanceTimersByTime(499));
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toHaveBeenCalledExactlyOnceWith({
      query: "Acme",
      fieldId: "fld_customer",
    });
  });

  it("removes an active keyword even when its draft becomes empty before selecting a field", () => {
    const { result, commits } = setup({ query: "Acme", fieldId: "" });
    act(() => result.current.setQuery("  "));
    act(() => result.current.setFieldId("fld_customer"));
    expect(result.current.isPending).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    expect(commits).toHaveBeenCalledExactlyOnceWith({ query: "", fieldId: "fld_customer" });
    expect(result.current.isPending).toBe(false);
    act(() => result.current.setFieldId("fld_json"));
    expect(result.current.isPending).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it("retains an empty shared-link field choice without committing a different empty choice", () => {
    const { result, commits } = setup({ query: "", fieldId: "fld_json" });
    expect(result.current.fieldId).toBe("fld_json");
    act(() => result.current.setFieldId("fld_customer"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.fieldId).toBe("fld_customer");
    expect(result.current.isPending).toBe(false);
    expect(commits).not.toHaveBeenCalled();
  });

  it("waits 500 ms after the final ordinary input and submits trimmed text once", () => {
    const { result, commits } = setup();
    act(() => result.current.setQuery(" A"));
    act(() => vi.advanceTimersByTime(400));
    act(() => result.current.setQuery(" Acme "));
    act(() => vi.advanceTimersByTime(499));
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toHaveBeenCalledExactlyOnceWith({ query: "Acme", fieldId: "" });
    expect(result.current.isPending).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending request at composition start and never submits intermediate pinyin", () => {
    const { result, commits } = setup();
    act(() => result.current.setQuery("h"));
    act(() => vi.advanceTimersByTime(450));
    act(() => {
      result.current.startComposition();
      result.current.setQuery("huaxing");
    });
    act(() => vi.advanceTimersByTime(1500));
    expect(commits).not.toHaveBeenCalled();
    act(() => result.current.endComposition("华星"));
    act(() => result.current.setQuery("华星"));
    act(() => vi.advanceTimersByTime(499));
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toHaveBeenCalledExactlyOnceWith({ query: "华星", fieldId: "" });
  });

  it("immediately clears the word and cancels a pending composition", () => {
    const { result, commits } = setup({ query: "old", fieldId: "fld_customer" });
    act(() => {
      result.current.startComposition();
      result.current.setQuery("xin");
    });
    act(() => result.current.clear());
    expect(commits).toHaveBeenCalledExactlyOnceWith({ query: "", fieldId: "fld_customer" });
    act(() => result.current.endComposition("新"));
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).toHaveBeenCalledTimes(1);
    expect(result.current.query).toBe("");
  });

  it("submits the final field and word together", () => {
    const { result, commits } = setup();
    act(() => result.current.setQuery("Acme"));
    act(() => vi.advanceTimersByTime(300));
    act(() => result.current.setFieldId("fld_customer"));
    act(() => vi.advanceTimersByTime(499));
    expect(commits).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(commits).toHaveBeenCalledExactlyOnceWith({
      query: "Acme",
      fieldId: "fld_customer",
    });
  });

  it("does not request again for an unchanged committed term", () => {
    const { result, commits } = setup({ query: "Acme", fieldId: "" });
    act(() => result.current.setQuery("  Acme  "));
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
  });

  it("cancels an uncommitted term when the view changes or the component unmounts", () => {
    const { result, commits, rerender, unmount } = setup();
    act(() => result.current.setQuery("old draft"));
    rerender({ scope: "base:another" });
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
    expect(result.current.query).toBe("");
    act(() => result.current.setQuery("new draft"));
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(commits).not.toHaveBeenCalled();
  });
});
