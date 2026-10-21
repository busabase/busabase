import { describe, expect, it } from "vitest";
import {
  isPlainPrimaryClick,
  resolveWorkbenchLinkHref,
  resolveWorkbenchLinkUnderBase,
} from "./workbench-link";

const ORIGIN = "http://localhost:15419";
const BASE = "/dashboard/local";
const resolveUnderBase = (url: URL) => resolveWorkbenchLinkUnderBase(url, BASE, ORIGIN);
const resolve = (href: string) =>
  resolveWorkbenchLinkHref(href, `${ORIGIN}${BASE}/doc/cover`, resolveUnderBase);

describe("workbench links in user content", () => {
  it("opens same-origin links under the router base as workbench routes", () => {
    expect(resolve(`${ORIGIN}/dashboard/local/doc/chapter-1`)).toBe("/doc/chapter-1");
    expect(resolve("/dashboard/local/base/tasks?view=all#row")).toBe("/base/tasks?view=all#row");
    // Relative links resolve against the page they sit on.
    expect(resolve("chapter-2")).toBe("/doc/chapter-2");
    expect(resolve("/dashboard/local")).toBe("/");
  });

  it("leaves every other link to the browser", () => {
    expect(resolve("https://example.com/dashboard/local/doc/x")).toBeNull();
    expect(resolve("/dashboard/localhost/doc/x")).toBeNull();
    expect(resolve("/dashboard/other-space/doc/x")).toBeNull();
    expect(resolve("/pricing")).toBeNull();
    // In-page anchors scroll, and non-web schemes open their own app.
    expect(resolve("#chapter-1")).toBeNull();
    expect(resolve("mailto:hi@example.com")).toBeNull();
    expect(resolve("")).toBeNull();
    expect(resolveWorkbenchLinkUnderBase(new URL(`${ORIGIN}/doc/x`), "", ORIGIN)).toBeNull();
  });

  it("only takes over a plain primary click", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isPlainPrimaryClick(click)).toBe(true);
    expect(isPlainPrimaryClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainPrimaryClick({ ...click, altKey: true })).toBe(false);
  });
});
