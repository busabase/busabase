// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";

vi.mock("openlib/ui/dashboard", () => ({
  SPALink: ({
    children,
    href,
    className,
  }: {
    children: unknown;
    href: string;
    className?: string;
  }) => (
    <a className={className} href={href}>
      {children as never}
    </a>
  ),
}));
vi.mock("./agent-skill-button", () => ({
  AgentIntegrationDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="integration-dialog" /> : null,
}));

const { EmptyAgentGuide } = await import("./empty-agent-guide");
type Cue = import("./empty-agent-guide").EmptyAgentGuideCue;

const renderGuide = (cue: Cue, locale = "en") =>
  render(
    <CoreI18nProvider locale={locale}>
      <EmptyAgentGuide agentCue={cue} edition="cloud" onCreateNode={() => {}} />
    </CoreI18nProvider>,
  );

afterEach(cleanup);

describe("EmptyAgentGuide connect-agent bubble", () => {
  it("is a described note above the button with a keyboard-operable ×", () => {
    renderGuide({ onDismiss: vi.fn() });
    const bubble = screen.getByRole("note");
    expect(bubble.textContent).toContain("Start here");
    const connect = screen.getByRole("button", { name: /Connect your agent/ });
    expect(connect.getAttribute("aria-describedby")).toBe(bubble.id);
    const close = screen.getByRole("button", { name: "Dismiss tip" });
    expect(close.tagName).toBe("BUTTON");
    expect(close.getAttribute("type")).toBe("button");
  });

  it("× hides only the bubble and reports it; the button and Not now stay", () => {
    const onDismiss = vi.fn();
    const onDismissBubble = vi.fn();
    renderGuide({ onDismiss, onDismissBubble });
    fireEvent.click(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(onDismissBubble).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
    const connect = screen.getByRole("button", { name: /Connect your agent/ });
    expect(connect.hasAttribute("aria-describedby")).toBe(false);
    expect(screen.getByRole("button", { name: /Not now/ })).toBeTruthy();
  });

  it("clicking the button also retires the bubble and opens the dialog", () => {
    const onDismissBubble = vi.fn();
    const onConnectClick = vi.fn();
    renderGuide({ onDismiss: vi.fn(), onDismissBubble, onConnectClick });
    fireEvent.click(screen.getByRole("button", { name: /Connect your agent/ }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(onDismissBubble).toHaveBeenCalledTimes(1);
    expect(onConnectClick).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("integration-dialog")).toBeTruthy();
  });

  it("stays hidden when the host says it was dismissed earlier", () => {
    renderGuide({ onDismiss: vi.fn(), showBubble: false });
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: /Connect your agent/ })).toBeTruthy();
  });

  it("Not now reports the whole-cue dismissal", () => {
    const onDismiss = vi.fn();
    renderGuide({ onDismiss });
    fireEvent.click(screen.getByRole("button", { name: /Not now/ }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("localizes the bubble", () => {
    renderGuide({ onDismiss: vi.fn() }, "zh-CN");
    expect(screen.getByRole("note").textContent).toContain("从这里开始 · 30 秒连上你的 Agent");
    expect(screen.getByRole("button", { name: "关闭提示" })).toBeTruthy();
  });
});
