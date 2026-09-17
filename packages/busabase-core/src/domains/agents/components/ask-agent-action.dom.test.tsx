// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import type { AgentTarget } from "../utils/agent-targets";

const setLocation = vi.fn();
const useAskAgent = vi.fn();

vi.mock("wouter", () => ({ useLocation: () => ["/", setLocation] }));
vi.mock("../hooks/use-ask-agent", () => ({
  useAskAgent: (...args: unknown[]) => useAskAgent(...args),
}));

const { AskAgentAction } = await import("./ask-agent-action");

const target = (slug: string, name: string): AgentTarget => ({
  slug,
  name,
  transport: "remote-websocket",
  catalogSlug: slug,
  connectorName: undefined,
});

const baseAsk = {
  ask: vi.fn(),
  targets: null as AgentTarget[] | null,
  pickTarget: vi.fn(),
  retry: vi.fn(),
  reset: vi.fn(),
  isActive: false,
  isLoading: false,
  loadError: false,
  startError: null as string | null,
  isStarting: false,
};

const renderAction = (onClose = vi.fn()) =>
  render(
    <CoreI18nProvider locale="en">
      <AskAgentAction
        onClose={onClose}
        orpc={{} as BusabaseQueryUtils}
        promptText="do the thing"
        sessionScopeId="nod_report"
      />
    </CoreI18nProvider>,
  );

afterEach(() => {
  cleanup();
  setLocation.mockClear();
  useAskAgent.mockReset();
});

describe("AskAgentAction cancel and focus restoration", () => {
  it("renders Ask Agent as a tooltip-free primary action", () => {
    useAskAgent.mockReturnValue({ ...baseAsk });
    renderAction();

    const trigger = screen.getByRole("button", { name: "Ask Agent" });
    expect(trigger.className).toContain("bg-primary");
    expect(trigger.hasAttribute("title")).toBe(false);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("keeps target choices exposed as native buttons inside the named list", () => {
    useAskAgent.mockReturnValue({
      ...baseAsk,
      targets: [target("buda:research", "Research"), target("buda:writer", "Writer")],
    });
    renderAction();

    expect(screen.getByRole("list", { name: "Which agent should take this?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Research/ }).getAttribute("role")).toBeNull();
    expect(screen.getByRole("button", { name: /Writer/ }).getAttribute("role")).toBeNull();
  });

  it("offers an explicit Cancel control while picking a target", () => {
    useAskAgent.mockReturnValue({
      ...baseAsk,
      targets: [target("buda:research", "Research"), target("buda:writer", "Writer")],
    });
    renderAction();

    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Research/ })).toBeTruthy();
  });

  it("calls reset when Cancel is clicked, without picking a target", () => {
    const reset = vi.fn();
    useAskAgent.mockReturnValue({
      ...baseAsk,
      targets: [target("buda:research", "Research")],
      reset,
    });
    renderAction();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reset).toHaveBeenCalledTimes(1);
    expect(baseAsk.pickTarget).not.toHaveBeenCalled();
  });

  it("returns focus to the Ask Agent trigger once the picker closes", () => {
    useAskAgent.mockReturnValue({ ...baseAsk, targets: null });
    const { rerender } = render(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Ask Agent" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Simulate the picker opening (multiple targets resolved)...
    useAskAgent.mockReturnValue({
      ...baseAsk,
      targets: [target("buda:research", "Research"), target("buda:writer", "Writer")],
    });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(document.activeElement).not.toBe(trigger);

    // ...then cancelling collapses back to the trigger button, which is a fresh
    // DOM node (the two branches render different trees) but the same role/name
    // — and it is the one that ends up focused.
    useAskAgent.mockReturnValue({ ...baseAsk, targets: null });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Agent" }));
  });

  it("collapses the picker instead of handing the new prompt to the stale one when the selected prompt changes underneath it", () => {
    const reset = vi.fn();
    const targets = [target("buda:research", "Research"), target("buda:writer", "Writer")];
    useAskAgent.mockReturnValue({ ...baseAsk, reset, targets });
    const { rerender } = render(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt A"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    // Picker is open for prompt A — the parent's prompt list is still fully
    // interactive underneath it (nothing here disables it), so the user picks
    // a different prompt (B) via a click or an ArrowDown in that list before
    // choosing a target.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(reset).not.toHaveBeenCalled();

    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    // The hook is told to drop the handoff it was holding for A — the target
    // list still renders (state lives in the mock) until the real hook reacts
    // to the reset, but nothing is allowed to hand prompt A to a target picked
    // for B.
    expect(reset).toHaveBeenCalledTimes(1);

    // Once the hook reflects that reset (targets cleared), the trigger is back
    // and takes focus — the same collapse-and-refocus path Cancel uses, so a
    // prompt swap can never leave a picker open for a payload that no longer
    // matches what's on screen.
    useAskAgent.mockReturnValue({ ...baseAsk, reset, targets: null });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Agent" }));
  });

  it("invalidates the stale prompt synchronously within the commit that changed it", () => {
    // `AskAgentAction`'s prompt-change invalidation runs in `useLayoutEffect`
    // so it wins the race against `useAskAgent`'s own resolution effect (a
    // `useEffect`) when a prompt change and a catalog/session settle land in
    // the same commit — React flushes every layout effect before any passive
    // effect, regardless of hook call order. Testing Library's `rerender`
    // flushes both kinds of effect synchronously before returning, so a DOM
    // test cannot observe layout-vs-passive scheduling directly — that
    // guarantee is what makes this component-level contract true, not
    // something this test can re-derive on its own. What IS provable here:
    // `reset()` for a same-commit prompt change is never deferred past a
    // sibling passive effect reacting to that same commit, which is the
    // externally-visible half of the fix.
    const order: string[] = [];
    const reset = vi.fn(() => order.push("reset"));
    const targets = [target("buda:research", "Research")];
    useAskAgent.mockReturnValue({ ...baseAsk, reset, targets });

    function PassiveObserver({ tick }: { tick: number }) {
      useEffect(() => {
        order.push(`observed:${tick}:reset-calls=${reset.mock.calls.length}`);
      }, [tick]);
      return null;
    }

    const Harness = ({ promptText, tick }: { promptText: string; tick: number }) => (
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText={promptText}
          sessionScopeId="nod_report"
        />
        <PassiveObserver tick={tick} />
      </CoreI18nProvider>
    );

    const { rerender } = render(<Harness promptText="prompt A" tick={0} />);
    expect(order).toEqual(["observed:0:reset-calls=0"]);

    // Same commit: the prompt changes AND the sibling passive observer re-runs
    // (its own dependency ticked) — standing in for a resolution effect that
    // would otherwise see the stale prompt in this same flush.
    rerender(<Harness promptText="prompt B" tick={1} />);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["observed:0:reset-calls=0", "reset", "observed:1:reset-calls=1"]);
  });

  it("invalidates a cached handoff even when it never exposes a loading state or picker", () => {
    const reset = vi.fn();
    useAskAgent.mockReturnValue({ ...baseAsk, isActive: true, reset });
    const { rerender } = render(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt A"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not collapse a locked-in target while its session is starting, even if the prompt list changes underneath it", () => {
    const reset = vi.fn();
    const targets = [target("buda:research", "Research")];
    useAskAgent.mockReturnValue({ ...baseAsk, isStarting: true, reset, targets });
    const { rerender } = render(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt A"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    // The target was already picked alongside a specific prompt, and the
    // picker is disabled while its session starts — nothing later in this
    // render can retroactively change what was sent, so there's nothing to
    // collapse.
    expect(reset).not.toHaveBeenCalled();
  });

  it("resets exactly once if a locked-in start fails after the prompt changed underneath it", () => {
    // The prompt-change marker must NOT catch up to the new prompt while
    // `isStarting` is true (the picker is disabled and nothing should reset
    // yet) — but it must also not be forgotten by the time starting ends. If
    // the ref updated during the `isStarting` window, the mismatch would be
    // invisible once starting finished and the stale flow would be left
    // sitting there instead of collapsing.
    const reset = vi.fn();
    const targets = [target("buda:research", "Research")];
    useAskAgent.mockReturnValue({ ...baseAsk, isStarting: true, reset, targets });
    const { rerender } = render(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt A"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    // Prompt changes while the locked-in target's session is starting.
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );
    expect(reset).not.toHaveBeenCalled();

    // The start fails: `isStarting` drops back to `false`, targets remain (a
    // `startError` is shown) and the picker becomes interactive again — with
    // the prompt still at "prompt B", already stale relative to the target
    // that was picked for "prompt A".
    useAskAgent.mockReturnValue({
      ...baseAsk,
      reset,
      startError: "Could not start",
      targets,
    });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(reset).toHaveBeenCalledTimes(1);

    // Re-rendering again with nothing else changed must not fire a second
    // reset — the marker has now caught up, so this is a stable resting state.
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="prompt B"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("autofocuses the first target so keyboard users land directly in the list", () => {
    useAskAgent.mockReturnValue({
      ...baseAsk,
      targets: [target("buda:research", "Research"), target("buda:writer", "Writer")],
    });
    renderAction();

    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Research/ }));
  });

  it("shows a reversible live loading state and restores trigger focus after Back", () => {
    const reset = vi.fn();
    useAskAgent.mockReturnValue({ ...baseAsk, isLoading: true, reset });
    const { rerender } = renderAction();

    expect(screen.getByRole("status").textContent).toContain("Finding your agents…");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(reset).toHaveBeenCalledTimes(1);

    useAskAgent.mockReturnValue({ ...baseAsk });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Agent" }));
  });

  it("offers Retry and Back after lookup failure, then restores trigger focus", () => {
    const reset = vi.fn();
    const retry = vi.fn();
    useAskAgent.mockReturnValue({ ...baseAsk, loadError: true, reset, retry });
    const { rerender } = renderAction();

    expect(screen.getByText("Couldn't reach your agents. Nothing was sent.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(reset).toHaveBeenCalledTimes(1);

    useAskAgent.mockReturnValue({ ...baseAsk });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Ask Agent" }));
  });

  it("announces the selected target while a multi-target session starts", () => {
    const pickTarget = vi.fn();
    const targets = [target("buda:research", "Research"), target("buda:writer", "Writer")];
    useAskAgent.mockReturnValue({ ...baseAsk, pickTarget, targets });
    const { rerender } = renderAction();

    fireEvent.click(screen.getByRole("button", { name: /Research/ }));
    expect(pickTarget).toHaveBeenCalledTimes(1);

    useAskAgent.mockReturnValue({ ...baseAsk, isStarting: true, pickTarget, targets });
    rerender(
      <CoreI18nProvider locale="en">
        <AskAgentAction
          onClose={vi.fn()}
          orpc={{} as BusabaseQueryUtils}
          promptText="do the thing"
          sessionScopeId="nod_report"
        />
      </CoreI18nProvider>,
    );

    expect(screen.getByRole("status").textContent).toBe("Research — Opening a session…");
    const researchButton = screen.getByRole("button", { name: /Research/ }) as HTMLButtonElement;
    expect(researchButton.disabled).toBe(true);
    fireEvent.click(researchButton);
    expect(pickTarget).toHaveBeenCalledTimes(1);
  });
});
