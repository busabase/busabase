// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useAirAppBrowserLogs } from "../hooks/use-airapp-browser-logs";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const payload = (message: unknown, level = "log") => ({
  channel: "busabase-airapp-console",
  level,
  message,
});

function mount() {
  const privateFrame = document.createElement("iframe");
  privateFrame.src = "/api/airapp-preview/app/?__busabase_site_version=v1";
  const deployedFrame = document.createElement("iframe");
  deployedFrame.src = "https://published.sites.test/";
  document.body.append(privateFrame, deployedFrame);
  const frameRef = { current: privateFrame };
  let url: string | null = privateFrame.getAttribute("src");
  const hook = renderHook(() => useAirAppBrowserLogs({ frameRef, url }));
  const send = (
    data: unknown,
    source = privateFrame.contentWindow,
    origin = window.location.origin,
  ) => window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
  return {
    ...hook,
    privateFrame,
    deployedFrame,
    send,
    changeUrl: (next: string | null) => {
      url = next;
      hook.rerender();
    },
  };
}

describe("private preview browser console output", () => {
  it("accepts only the current private frame and exact workspace origin with the console schema", () => {
    const hook = mount();
    act(() => {
      hook.send(payload("private console"));
      hook.send(payload("public frame"), hook.deployedFrame.contentWindow);
      hook.send(
        payload("spoofed origin"),
        hook.privateFrame.contentWindow,
        "https://attacker.test",
      );
      hook.send(payload("opaque origin"), hook.privateFrame.contentWindow, "null");
      hook.send({ ...payload("wrong channel"), channel: "other" });
      hook.send(payload("wrong level", "trace"));
      hook.send(payload({ secret: "not a console message string" }));
      hook.send(payload("x".repeat(8193)));
      hook.send(null);
    });
    expect(hook.result.current.lines).toEqual(["[log] private console\n"]);
    act(() => hook.send(payload("checkout failed", "error")));
    expect(hook.result.current.lines[1]).toBe("[error] checkout failed\n");
  });

  it("keeps only the latest 200 messages and supports explicit clearing", () => {
    const hook = mount();
    act(() => {
      for (let index = 0; index < 210; index += 1) hook.send(payload(String(index)));
    });
    expect(hook.result.current.lines).toHaveLength(200);
    expect(hook.result.current.lines[0]).toBe("[log] 10\n");
    expect(hook.result.current.lines.at(-1)).toBe("[log] 209\n");
    act(() => hook.result.current.clear());
    expect(hook.result.current.lines).toEqual([]);
  });

  it("resets output on preview changes and never subscribes to a deployed or absent URL", () => {
    const hook = mount();
    act(() => hook.send(payload("first version")));
    expect(hook.result.current.lines).toHaveLength(1);
    hook.changeUrl("/api/airapp-preview/app/?__busabase_site_version=v2");
    expect(hook.result.current.lines).toEqual([]);
    act(() => hook.send(payload("next version")));
    expect(hook.result.current.lines).toEqual(["[log] next version\n"]);
    hook.changeUrl("https://published.sites.test/");
    act(() => hook.send(payload("not a private preview")));
    expect(hook.result.current.lines).toEqual([]);
    hook.changeUrl(null);
    act(() => hook.send(payload("no preview")));
    expect(hook.result.current.lines).toEqual([]);
  });
});
