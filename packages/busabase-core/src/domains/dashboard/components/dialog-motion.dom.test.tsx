// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogTitle,
} from "kui/alert-dialog";
import { Dialog, DialogContent, DialogTitle } from "kui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Sheet, SheetContent, SheetTitle } from "kui/sheet";
import { afterEach, describe, expect, it, vi } from "vitest";

const readStylesheet = (fileName: string) => {
  const style = document.createElement("style");
  style.textContent = readFileSync(new URL(fileName, import.meta.url), "utf8");
  document.head.append(style);
  if (!style.sheet) throw new Error(`Missing stylesheet: ${fileName}`);
  return style.sheet;
};

const matchingRules = (rules: CSSRuleList, element: Element): CSSStyleRule[] =>
  Array.from(rules).flatMap((rule) => {
    if (rule instanceof CSSStyleRule) return element.matches(rule.selectorText) ? [rule] : [];
    return [];
  });

const animationFor = (rules: CSSRuleList, element: Element) =>
  matchingRules(rules, element).at(-1)?.style.getPropertyValue("animation").replace(/\s+/g, " ");

const getOverlay = (content: Element) => {
  const overlay = content.previousElementSibling;
  if (!(overlay instanceof HTMLElement)) throw new Error("Missing modal overlay");
  return overlay;
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.head.querySelectorAll("style").forEach((style) => {
    style.remove();
  });
});

describe("Busabase dialog motion contract", () => {
  it.each(["dialog", "alertdialog"] as const)(
    "fades direct KUI %s content and its overlay in both states",
    (role) => {
      const stylesheet = readStylesheet("./dialog-motion.css");
      render(
        role === "dialog" ? (
          <Dialog defaultOpen>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Ordinary modal</DialogTitle>
            </DialogContent>
          </Dialog>
        ) : (
          <AlertDialog defaultOpen>
            <AlertDialogContent aria-describedby={undefined}>
              <AlertDialogTitle>Confirm action</AlertDialogTitle>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
            </AlertDialogContent>
          </AlertDialog>
        ),
      );
      const content = document.querySelector(`[role="${role}"]`);
      if (!content) throw new Error("Missing modal content");
      const overlay = getOverlay(content);
      for (const state of ["open", "closed"]) {
        content.setAttribute("data-state", state);
        overlay.setAttribute("data-state", state);
        for (const element of [content, overlay]) {
          expect(animationFor(stylesheet.cssRules, element)).toBe(
            state === "open"
              ? "busabase-dialog-in var(--busabase-dialog-enter-duration) var(--busabase-dialog-enter-easing) both"
              : "busabase-dialog-out var(--busabase-dialog-exit-duration) var(--busabase-dialog-exit-easing) both",
          );
          for (const rule of matchingRules(stylesheet.cssRules, element)) {
            expect(rule.style.getPropertyValue("transform")).toBe("");
            expect(rule.style.getPropertyValue("translate")).toBe("");
          }
        }
      }
      expect(content.classList.contains("translate-x-[-50%]")).toBe(true);
      expect(content.classList.contains("translate-y-[-50%]")).toBe(true);
      const reducedMotion = Array.from(stylesheet.cssRules).find(
        (rule): rule is CSSMediaRule => rule instanceof CSSMediaRule,
      );
      if (!reducedMotion) throw new Error("Missing reduced-motion override");
      expect(reducedMotion.conditionText).toBe("(prefers-reduced-motion: reduce)");
      for (const state of ["open", "closed"]) {
        for (const element of [content, overlay]) {
          element.setAttribute("data-state", state);
          expect(animationFor(reducedMotion.cssRules, element)).toBe("none");
        }
      }
    },
  );

  it("defines the approved timings and opacity-only keyframes", () => {
    const stylesheet = readStylesheet("./dialog-motion.css");
    const tokens = matchingRules(stylesheet.cssRules, document.documentElement)[0]?.style;
    expect(tokens?.getPropertyValue("--busabase-dialog-enter-duration")).toBe("120ms");
    expect(tokens?.getPropertyValue("--busabase-dialog-exit-duration")).toBe("100ms");
    expect(tokens?.getPropertyValue("--busabase-dialog-enter-easing")).toBe("ease-out");
    expect(tokens?.getPropertyValue("--busabase-dialog-exit-easing")).toBe("ease-in");
    const keyframes = Array.from(stylesheet.cssRules).filter(
      (rule): rule is CSSKeyframesRule => rule.type === CSSRule.KEYFRAMES_RULE,
    );
    expect(keyframes.map((rule) => rule.name)).toEqual([
      "busabase-dialog-in",
      "busabase-dialog-out",
    ]);
    for (const keyframe of keyframes) {
      const frames = Array.from(keyframe.cssRules) as CSSKeyframeRule[];
      expect(frames.map((frame) => frame.style.getPropertyValue("opacity"))).toEqual(
        keyframe.name === "busabase-dialog-in" ? ["0", "1"] : ["1", "0"],
      );
      for (const frame of frames) {
        expect(frame.style.length).toBe(1);
      }
    }
  });

  it("preserves directional Sheets and requires an exact modal animation token", () => {
    const stylesheet = readStylesheet("./dialog-motion.css");
    render(
      <Sheet defaultOpen>
        <SheetContent aria-describedby={undefined}>
          <SheetTitle>Side panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    const sheet = document.querySelector('[role="dialog"]');
    if (!sheet) throw new Error("Missing sheet");
    expect(sheet.classList.contains("data-[state=open]:slide-in-from-right")).toBe(true);
    for (const state of ["open", "closed"]) {
      for (const element of [sheet, getOverlay(sheet)]) {
        element.setAttribute("data-state", state);
        expect(matchingRules(stylesheet.cssRules, element)).toHaveLength(0);
      }
    }
    for (const role of ["menu", "dialog"]) {
      const surface = document.createElement("div");
      surface.setAttribute("role", role);
      surface.setAttribute("data-state", "open");
      surface.className = "fixed data-[state=open]:animate-in data-[state=open]:zoom-in-95-extra";
      expect(matchingRules(stylesheet.cssRules, surface)).toHaveLength(0);
    }
  });

  it.each([undefined, "fixed"])(
    "excludes real KUI Popover content and adjacent elements with className=%s",
    (className) => {
      vi.stubGlobal(
        "ResizeObserver",
        class {
          observe = vi.fn();
          unobserve = vi.fn();
          disconnect = vi.fn();
        },
      );
      const stylesheet = readStylesheet("./dialog-motion.css");
      render(
        <Popover defaultOpen>
          <PopoverTrigger>Popover trigger</PopoverTrigger>
          <PopoverContent className={className} data-testid="popover-content">
            Popover actions
          </PopoverContent>
        </Popover>,
      );
      const popover = document.querySelector('[data-testid="popover-content"]');
      if (!popover) throw new Error("Missing popover content");
      expect(popover.getAttribute("role")).toBe("dialog");
      expect(popover.classList.contains("data-[state=open]:zoom-in-95")).toBe(true);
      expect(popover.hasAttribute("data-side")).toBe(true);
      expect(popover.classList.contains("fixed")).toBe(className === "fixed");
      const adjacentElement = document.createElement("div");
      popover.before(adjacentElement);
      const ruleGroups = [
        stylesheet.cssRules,
        ...Array.from(stylesheet.cssRules)
          .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
          .map((rule) => rule.cssRules),
      ];
      for (const state of ["open", "closed"]) {
        for (const element of [popover, adjacentElement]) {
          element.setAttribute("data-state", state);
        }
        for (const rules of ruleGroups) {
          for (const element of [popover, adjacentElement]) {
            expect(matchingRules(rules, element)).toHaveLength(0);
          }
        }
      }
    },
  );

  it("never reclassifies record content as an attachment overlay during nested exit", () => {
    const modalStylesheet = readStylesheet("./dialog-motion.css");
    const attachmentStylesheet = readStylesheet("./attachment-preview-dialog.css");
    render(
      <Dialog defaultOpen>
        <DialogContent aria-describedby={undefined}>
          <DialogTitle>Record details</DialogTitle>
          <Dialog defaultOpen>
            <DialogContent aria-describedby={undefined} data-attachment-preview-surface="">
              <DialogTitle>Attachment preview</DialogTitle>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>,
    );
    const attachment = document.querySelector("[data-attachment-preview-surface]");
    const record = document.querySelector('[role="dialog"]:not([data-attachment-preview-surface])');
    if (!attachment || !record) throw new Error("Missing nested modal");
    const overlay = getOverlay(attachment);
    expect(animationFor(attachmentStylesheet.cssRules, overlay)).toBe("none");
    expect(
      matchingRules(attachmentStylesheet.cssRules, overlay)
        .at(-1)
        ?.style.getPropertyValue("background-color"),
    ).toBe("transparent");
    for (const state of ["open", "closed"]) {
      attachment.setAttribute("data-state", state);
      overlay.setAttribute("data-state", state);
      for (const element of [attachment, overlay]) {
        expect(matchingRules(modalStylesheet.cssRules, element)).toHaveLength(0);
      }
      expect(animationFor(attachmentStylesheet.cssRules, attachment)).toContain(
        state === "open" ? "busabase-attachment-preview-in" : "busabase-attachment-preview-out",
      );
    }
    const recordAnimation = animationFor(modalStylesheet.cssRules, record);
    overlay.remove();
    try {
      expect(record.nextElementSibling).toBe(attachment);
      for (const rules of [
        attachmentStylesheet.cssRules,
        ...Array.from(attachmentStylesheet.cssRules)
          .filter((rule): rule is CSSMediaRule => rule instanceof CSSMediaRule)
          .map((rule) => rule.cssRules),
      ]) {
        expect(matchingRules(rules, record)).toHaveLength(0);
      }
      expect(animationFor(modalStylesheet.cssRules, record)).toBe(recordAnimation);
    } finally {
      attachment.before(overlay);
    }
  });
});
