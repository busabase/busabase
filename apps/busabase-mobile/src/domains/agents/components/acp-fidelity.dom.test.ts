// @vitest-environment jsdom

import type { AcpBlock, AcpInputBlock, AcpPermissionBlock, AcpResource } from "@acp-ui/core/reduce";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "~/i18n/en";
import { AcpInputCard, AcpResourceCard } from "./AcpFidelityBlocks";
import { AcpPermissionCard } from "./AcpPermissionCard";
import { AcpTranscript } from "./AcpTranscript";

const { openURL } = vi.hoisted(() => ({ openURL: vi.fn().mockResolvedValue(undefined) }));
// RN Web's installed peers must share the renderer's React instance. Expo's
// separate React copy otherwise produces an invalid-hook error in Node tests.
vi.mock("react", async () => {
  const { createRequire } = await import("node:module");
  const fromWeb = createRequire(createRequire(import.meta.url).resolve("react-native-web"));
  return vi.importActual(fromWeb.resolve("react"));
});
vi.mock("react-dom/client", async () => {
  const { createRequire } = await import("node:module");
  const fromWeb = createRequire(createRequire(import.meta.url).resolve("react-native-web"));
  return vi.importActual(fromWeb.resolve("react-dom/client"));
});
vi.mock("react-native", async () => {
  const native = await vi.importActual<typeof import("react-native")>("react-native-web");
  return { ...native, Linking: { ...native.Linking, openURL } };
});
vi.mock("expo-haptics", () => ({
  impactAsync: vi.fn(),
  notificationAsync: vi.fn(),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Warning: "warning" },
}));
vi.mock("lucide-react-native", () => ({
  CheckCircle: () => null,
  ChevronDown: () => null,
  ChevronRight: () => null,
  Circle: () => null,
  Clock: () => null,
  Wrench: () => null,
  XCircle: () => null,
  Paperclip: () => null,
  Check: () => null,
  LoaderCircle: () => null,
}));
vi.mock("~/i18n", () => ({
  useI18n: () => ({ t: en }),
  fmt: (text: string, values: Record<string, unknown>) =>
    text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? "")),
}));
vi.mock("~/components/MarkdownView", () => ({
  MarkdownView: ({ children }: { children: string }) => createElement("span", null, children),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
const roots: Root[] = [];
const containers: HTMLElement[] = [];
function mount(node: ReturnType<typeof createElement>) {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(node));
  return {
    container,
    rerender: (next: ReturnType<typeof createElement>) => act(() => root.render(next)),
  };
}
function click(container: HTMLElement, label: string) {
  const element = [
    ...container.querySelectorAll('[role="button"], [role="radio"], [role="checkbox"]'),
  ].find((item) => item.textContent?.replace(/^✓\s*/, "") === label);
  expect(element, label).toBeTruthy();
  act(() => element?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}
afterEach(() => {
  act(() =>
    roots.splice(0).forEach((root) => {
      root.unmount();
    }),
  );
  containers.splice(0).forEach((container) => {
    container.remove();
  });
  vi.clearAllMocks();
});

const request: AcpInputBlock = {
  kind: "input_request",
  id: "q1",
  message: "Choose report output",
  resolution: "pending",
  requestedSchema: {
    type: "object",
    required: ["format", "sections", "title"],
    properties: {
      format: { type: "string", enum: ["Markdown", "PDF"] },
      sections: {
        type: "array",
        minItems: 1,
        items: { type: "string", enum: ["Summary", "Details"] },
      },
      title: { type: "string", default: "Mobile report" },
    },
  },
};
const permission: AcpPermissionBlock = {
  kind: "permission",
  id: "p1",
  title: "Write report?",
  resolution: "pending",
  options: [
    { optionId: "allow", name: "Allow once", kind: "allow_once" },
    { optionId: "reject", name: "Reject", kind: "reject_once" },
  ],
};

describe("native ACP fidelity binding", () => {
  it("renders every added core block, including actual plan and output facts", () => {
    const blocks: AcpBlock[] = [
      {
        kind: "turn",
        id: "turn",
        startedAt: "2026-10-27T01:00:00Z",
        status: "completed",
        stopReason: "end_turn",
        usage: { totalTokens: 42 },
      },
      {
        kind: "step",
        id: "step",
        startedAt: "2026-10-27T01:00:01Z",
        endedAt: "2026-10-27T01:00:02Z",
        label: "Inspect report",
      },
      {
        kind: "plan",
        id: "plan",
        entries: [{ content: "Review source", priority: "high", status: "completed" }],
      },
      {
        kind: "job",
        id: "job",
        job: {
          id: "job",
          title: "Prepare video",
          status: "succeeded",
          message: "Render ready",
          resourceIds: ["video"],
        },
      },
      {
        kind: "resource",
        id: "video",
        resource: {
          id: "video",
          name: "report.mp4",
          uri: "buda://resource/video",
          mimeType: "video/mp4",
        },
      },
      request,
    ];
    const { container } = mount(
      createElement(AcpTranscript, {
        blocks,
        streaming: false,
        onAnswerPermission: vi.fn(),
        onAnswerInput: vi.fn(),
      }),
    );
    for (const text of [
      "Process · Completed",
      "Total tokens: 42",
      "Inspect report",
      "Completed · Review source",
      "Prepare video · Completed",
      "Render ready",
      "report.mp4",
      "Choose report output",
    ])
      expect(container.textContent).toContain(text);
  });
  it("submits the selected single/multiple choices through the host callback", () => {
    const answer = vi.fn();
    const { container } = mount(createElement(AcpInputCard, { block: request, onAnswer: answer }));
    click(container, "Send answer");
    expect(answer).not.toHaveBeenCalled();
    click(container, "Markdown");
    click(container, "Summary");
    click(container, "Details");
    click(container, "Send answer");
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      action: "accept",
      content: { format: "Markdown", sections: ["Summary", "Details"], title: "Mobile report" },
    });
  });
  it("locks an uncertain answer and retries only the original response", () => {
    const answer = vi.fn();
    const original = {
      action: "accept" as const,
      content: { title: "Original", format: "PDF", sections: ["Details"] },
    };
    const { container } = mount(
      createElement(AcpInputCard, {
        block: { ...request, confirmationUnknown: true, submittedResponse: original },
        onAnswer: answer,
      }),
    );
    const input = container.querySelector('input[aria-label="title *"]');
    expect(input).not.toBeNull();
    expect(input?.hasAttribute("readonly")).toBe(true);
    click(container, "Retry the same decision");
    expect(answer).toHaveBeenCalledExactlyOnceWith(original);
    expect(container.textContent).not.toContain("Send answer");
  });
  it("shows cancelled permission as terminal without authorization buttons", () => {
    const answer = vi.fn();
    const { container } = mount(
      createElement(AcpPermissionCard, {
        block: { ...permission, resolution: "cancelled" },
        onAnswer: answer,
      }),
    );
    expect(container.textContent).toContain("Cancelled");
    expect(container.textContent).not.toContain("Allow once");
    expect(container.textContent).not.toContain("Reject");
  });
  it("offers an immutable permission retry when delivery is unknown", () => {
    const answer = vi.fn();
    const { container } = mount(
      createElement(AcpPermissionCard, {
        block: { ...permission, confirmationUnknown: true, submittedOptionId: "reject" },
        onAnswer: answer,
      }),
    );
    click(container, "Retry the same decision");
    expect(answer).toHaveBeenCalledExactlyOnceWith("reject");
    expect(container.textContent).not.toContain("Allow once");
  });
  it("resolves private resources through the host and opens only an authorized HTTP URL", async () => {
    const resource: AcpResource = {
      id: "report",
      name: "report.pdf",
      uri: "buda://resource/report",
    };
    const resolveResource = vi
      .fn()
      .mockResolvedValue({ ...resource, uri: "https://example.test/signed-report" });
    const { container } = mount(createElement(AcpResourceCard, { resource, resolveResource }));
    await act(async () => click(container, "Open resource"));
    expect(resolveResource).toHaveBeenCalledExactlyOnceWith(resource);
    expect(openURL).toHaveBeenCalledExactlyOnceWith("https://example.test/signed-report");
  });
  it("never opens a custom or script scheme returned by a resolver", async () => {
    const resource: AcpResource = { id: "bad", name: "report", uri: "javascript:alert(1)" };
    const { container } = mount(createElement(AcpResourceCard, { resource }));
    await act(async () => click(container, "Open resource"));
    expect(openURL).not.toHaveBeenCalled();
    expect(container.textContent).toContain("not available");
  });
  it("discards a stale authorized result after the resource descriptor changes", async () => {
    let release: ((value: AcpResource) => void) | undefined;
    const resolveResource = () =>
      new Promise<AcpResource>((resolve) => {
        release = resolve;
      });
    const first: AcpResource = { id: "report", name: "Draft", uri: "buda://resource/old" };
    const next: AcpResource = { ...first, name: "Current", uri: "buda://resource/new" };
    const { container, rerender } = mount(
      createElement(AcpResourceCard, { resource: first, resolveResource }),
    );
    click(container, "Open resource");
    rerender(createElement(AcpResourceCard, { resource: next, resolveResource }));
    await act(async () => release?.({ ...first, uri: "https://example.test/stale" }));
    expect(openURL).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Current");
  });
});
