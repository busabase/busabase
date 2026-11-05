// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { ListWorkflowRunsOutput, WorkflowRun } from "busabase-contract/domains/workflow/run";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesByLocale } from "../../../i18n/catalog";
import type { WorkflowRunStepState } from "../utils/run-view";
import { WorkflowRunsPanel } from "./workflow-runs-panel";

const messages = coreMessagesByLocale.en;

const run = (overrides: Partial<WorkflowRun>): WorkflowRun => ({
  id: "run",
  spaceId: "space-1",
  workflowNodeId: "workflow-1",
  status: "completed",
  trigger: "manual",
  startedBy: "user-1",
  startedVia: null,
  cancelledBy: null,
  cursorNodeId: null,
  previousNodeId: null,
  outputs: {},
  recordId: null,
  payload: {},
  pause: null,
  error: null,
  freshness: "snapshot-steps-plus-explicit-reread",
  startedAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
  ...overrides,
});

const completedRun = run({
  id: "run-completed",
  startedAt: "2026-10-30T12:00:00.000Z",
  outputs: {
    end: {
      kind: "end",
      capturedAt: "2026-10-30T12:00:02.000Z",
      record: null,
      data: { outcome: "completed" },
    },
    trigger: {
      kind: "trigger",
      capturedAt: "2026-10-30T12:00:01.000Z",
      record: {
        recordId: "rec-1",
        baseId: "base-1",
        headCommitId: "commit-1",
        fields: { score: 91 },
      },
      data: { eventName: "manual", payload: {} },
    },
  },
});

const waitingRun = run({
  id: "run-waiting",
  status: "waiting",
  trigger: "event",
  startedAt: "2026-10-30T11:00:00.000Z",
  cursorNodeId: "wait",
  outputs: {
    trigger: {
      kind: "trigger",
      capturedAt: "2026-10-30T11:00:01.000Z",
      record: null,
      data: {},
    },
  },
  pause: { kind: "wait", nodeId: "wait", resumeAt: "2026-10-31T11:00:00.000Z" },
});

const approvalRun = run({
  id: "run-approval",
  status: "waiting_approval",
  startedAt: "2026-10-30T10:00:00.000Z",
  cursorNodeId: "review",
  pause: { kind: "approval", nodeId: "review", resumeAt: null },
});

const failedRun = run({
  id: "run-failed",
  status: "failed",
  startedAt: "2026-10-30T09:00:00.000Z",
  cursorNodeId: "hook",
  error: 'Webhook step "Notify" failed: 500',
});

const steps = [
  { id: "trigger", label: "New lead" },
  { id: "wait", label: "Cool-off" },
  { id: "review", label: "Manager review" },
  { id: "end", label: "Done" },
];

function setup(
  initialRuns: WorkflowRun[],
  { canRun = true, decidable }: { canRun?: boolean; decidable?: string[] } = {},
) {
  let serverRuns = initialRuns;
  const list = vi.fn(
    async (_input: unknown): Promise<ListWorkflowRunsOutput> => ({
      runs: serverRuns,
      canRun,
      // By default an editor may decide every approval that names nobody.
      decidableRunIds:
        decidable ??
        (canRun ? serverRuns.filter((r) => r.status === "waiting_approval").map((r) => r.id) : []),
      nextCursor: null,
      queuedCount: serverRuns.filter((r) => r.status === "queued").length,
      actorNames: { "user-1": "Ada Lovelace" },
    }),
  );
  const start = vi.fn(async (input: { nodeId: string }) => {
    const started = run({
      id: "run-started",
      status: "running",
      startedAt: "2026-10-30T13:00:00.000Z",
    });
    serverRuns = [started, ...serverRuns];
    return { ...started, workflowNodeId: input.nodeId };
  });
  const resume = vi.fn(async (input: { runId: string }) => {
    const resumed = { ...waitingRun, id: input.runId, status: "completed" as const, pause: null };
    serverRuns = serverRuns.map((entry) => (entry.id === input.runId ? resumed : entry));
    return resumed;
  });
  const decide = vi.fn(async (input: { runId: string }) => {
    const decided = { ...approvalRun, id: input.runId, status: "completed" as const, pause: null };
    serverRuns = serverRuns.map((entry) => (entry.id === input.runId ? decided : entry));
    return decided;
  });
  const cancel = vi.fn(async (input: { runId: string }) => {
    const target = serverRuns.find((entry) => entry.id === input.runId) ?? waitingRun;
    const cancelled = {
      ...target,
      status: "cancelled" as const,
      cancelledBy: "user-1",
      pause: null,
    };
    serverRuns = serverRuns.map((entry) => (entry.id === input.runId ? cancelled : entry));
    return cancelled;
  });
  const cancelQueued = vi.fn(async () => ({ cancelled: 0 }));
  const orpc = {
    workflows: {
      list: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ["workflows", "list", input],
          queryFn: () => list(input),
        }),
      },
      start: { mutationOptions: () => ({ mutationFn: start }) },
      resume: { mutationOptions: () => ({ mutationFn: resume }) },
      decide: { mutationOptions: () => ({ mutationFn: decide }) },
      cancel: { mutationOptions: () => ({ mutationFn: cancel }) },
      cancelQueued: { mutationOptions: () => ({ mutationFn: cancelQueued }) },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const highlights: (ReadonlyMap<string, WorkflowRunStepState> | null)[] = [];
  const onHighlightChange = (states: ReadonlyMap<string, WorkflowRunStepState> | null) => {
    highlights.push(states);
  };
  const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">{children}</CoreI18nProvider>
    </QueryClientProvider>
  );
  const renderPanel = (hasUnsavedChanges = false) =>
    render(
      <Providers>
        <WorkflowRunsPanel
          hasUnsavedChanges={hasUnsavedChanges}
          onHighlightChange={onHighlightChange}
          orpc={orpc}
          steps={steps}
          workflowNodeId="workflow-1"
        />
      </Providers>,
    );
  return { cancel, cancelQueued, client, decide, highlights, list, renderPanel, resume, start };
}

const runItem = (container: HTMLElement, runId: string) => {
  const item = container.querySelector<HTMLButtonElement>(
    `[data-workflow-run-item][data-run-id="${runId}"]`,
  );
  if (!item) throw new Error(`run item ${runId} not rendered`);
  return item;
};

afterEach(() => {
  cleanup();
});

describe("WorkflowRunsPanel", () => {
  it("lists runs newest first with their status, trigger and failure reason", async () => {
    const { list, renderPanel } = setup([completedRun, waitingRun, approvalRun, failedRun]);
    const { container } = renderPanel();
    await waitFor(() =>
      expect(container.querySelectorAll("[data-workflow-run-item]")).toHaveLength(4),
    );
    expect(list).toHaveBeenCalledWith({ nodeId: "workflow-1", limit: 20 });
    const items = [...container.querySelectorAll<HTMLElement>("[data-workflow-run-item]")];
    expect(items.map((item) => item.dataset.status)).toEqual([
      "completed",
      "waiting",
      "waiting_approval",
      "failed",
    ]);
    expect(runItem(container, "run-approval").textContent).toContain(
      messages.workflowRuns.statusWaitingApproval,
    );
    expect(runItem(container, "run-waiting").textContent).toContain(
      messages.workflowRuns.triggerEvent,
    );
    expect(runItem(container, "run-failed").textContent).toContain(
      'Webhook step "Notify" failed: 500',
    );
  });

  it("shows the newest run's steps in execution order with their saved names and data", async () => {
    const { highlights, renderPanel } = setup([completedRun, waitingRun]);
    const { container } = renderPanel();
    await waitFor(() =>
      expect(container.querySelectorAll("[data-workflow-run-step]")).toHaveLength(2),
    );
    const stepElements = [...container.querySelectorAll<HTMLElement>("[data-workflow-run-step]")];
    expect(stepElements.map((step) => step.dataset.stepId)).toEqual(["trigger", "end"]);
    expect(stepElements[0]?.textContent).toContain("New lead");
    expect(stepElements[0]?.textContent).toContain('"score": 91');
    const latest = highlights.at(-1);
    expect(latest && Object.fromEntries(latest)).toEqual({ trigger: "done", end: "done" });
  });

  it("continues a waiting run now with force", async () => {
    const { highlights, renderPanel, resume } = setup([completedRun, waitingRun]);
    const { container } = renderPanel();
    await waitFor(() => runItem(container, "run-waiting"));
    fireEvent.click(runItem(container, "run-waiting"));
    const continueButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>("[data-workflow-run-continue]");
      if (!button) throw new Error("continue button missing");
      return button;
    });
    const latest = highlights.at(-1);
    expect(latest && Object.fromEntries(latest)).toEqual({ trigger: "done", wait: "paused" });
    fireEvent.click(continueButton);
    await waitFor(() => expect(resume).toHaveBeenCalledTimes(1));
    expect(resume.mock.calls[0]?.[0]).toEqual({ runId: "run-waiting", force: true });
    await waitFor(() => expect(runItem(container, "run-waiting").dataset.status).toBe("completed"));
    expect(container.querySelector("[data-workflow-run-continue]")).toBeNull();
  });

  it("approves a run that waits for a decision, next to a Reject button", async () => {
    const { decide, renderPanel } = setup([approvalRun]);
    const { container } = renderPanel();
    const approve = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>("[data-workflow-run-approve]");
      if (!button) throw new Error("approve button missing");
      return button;
    });
    expect(container.querySelector("[data-workflow-run-pause='approval']")?.textContent).toContain(
      "Manager review",
    );
    expect(container.querySelector("[data-workflow-run-reject]")).not.toBeNull();
    fireEvent.click(approve);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    expect(decide.mock.calls[0]?.[0]).toEqual({ runId: "run-approval", decision: "approved" });
  });

  it("shows a viewer the runs but no way to start, continue, or decide one", async () => {
    const { renderPanel } = setup([approvalRun, waitingRun], { canRun: false });
    const { container } = renderPanel();
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-readonly]")?.textContent).toContain(
        "needs edit access",
      ),
    );
    expect(container.querySelectorAll("[data-workflow-run-item]")).toHaveLength(2);
    expect(container.querySelector("[data-workflow-run-pause='approval']")?.textContent).toContain(
      "Manager review",
    );
    expect(container.querySelector("[data-workflow-run-start]")).toBeNull();
    expect(container.querySelector("[data-workflow-run-approve]")).toBeNull();
    expect(container.querySelector("[data-workflow-run-reject]")).toBeNull();
    expect(container.querySelector("[data-workflow-run-cannot-decide]")?.textContent).toContain(
      "Only the approvers named on this step",
    );
    fireEvent.click(runItem(container, "run-waiting"));
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-pause='wait']")).not.toBeNull(),
    );
    expect(container.querySelector("[data-workflow-run-continue]")).toBeNull();
  });

  it("gives a named approver who cannot edit the workflow Approve and Reject, and nothing else", async () => {
    const { decide, renderPanel } = setup([approvalRun, waitingRun], {
      canRun: false,
      decidable: ["run-approval"],
    });
    const { container } = renderPanel();
    const approve = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>("[data-workflow-run-approve]");
      if (!button) throw new Error("approve button missing");
      return button;
    });
    expect(container.querySelector("[data-workflow-run-start]")).toBeNull();
    expect(container.querySelector("[data-workflow-run-cannot-decide]")).toBeNull();
    fireEvent.click(approve);
    await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
    fireEvent.click(runItem(container, "run-waiting"));
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-pause='wait']")).not.toBeNull(),
    );
    expect(container.querySelector("[data-workflow-run-continue]")).toBeNull();
  });

  it("cancels a run only after confirming, and shows who did it", async () => {
    const { renderPanel, cancel } = setup([waitingRun]);
    const { container } = renderPanel();
    const button = await waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>("[data-workflow-run-cancel]");
      if (!found) throw new Error("cancel button missing");
      return found;
    });
    expect(container.querySelector("[data-workflow-run-started-by]")?.textContent).toContain(
      "Ada Lovelace",
    );
    fireEvent.click(button);
    expect(cancel).not.toHaveBeenCalled();
    const confirm = await waitFor(() => {
      const found = document.querySelector<HTMLButtonElement>("[data-workflow-run-cancel-confirm]");
      if (!found) throw new Error("confirm missing");
      return found;
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-cancelled]")?.textContent).toContain(
        "Ada Lovelace",
      ),
    );
    expect(container.querySelector("[data-workflow-run-cancel]")).toBeNull();
  });

  it("offers to cancel everything queued once there is more than one", async () => {
    const queued = (id: string) => run({ id, status: "queued" });
    const { renderPanel, cancelQueued } = setup([queued("q1"), queued("q2")]);
    const { container } = renderPanel();
    const button = await waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>("[data-workflow-run-cancel-queued]");
      if (!found) throw new Error("bulk cancel missing");
      return found;
    });
    expect(button.textContent).toContain("Cancel 2 queued runs");
    fireEvent.click(button);
    fireEvent.click(
      await waitFor(() => {
        const found = document.querySelector<HTMLButtonElement>(
          "[data-workflow-run-cancel-confirm]",
        );
        if (!found) throw new Error("confirm missing");
        return found;
      }),
    );
    await waitFor(() => expect(cancelQueued).toHaveBeenCalledTimes(1));
  });

  it("loads older runs on request and adds them below the newest", async () => {
    const { renderPanel, list } = setup([completedRun]);
    list.mockImplementation(async (input: unknown) => {
      const { cursor } = input as { cursor?: string };
      return {
        runs: cursor ? [failedRun] : [completedRun],
        canRun: true,
        decidableRunIds: [],
        nextCursor: cursor ? null : "page-2",
        queuedCount: 0,
        actorNames: {},
      };
    });
    const { container } = renderPanel();
    const more = await waitFor(() => {
      const found = container.querySelector<HTMLButtonElement>("[data-workflow-run-load-older]");
      if (!found) throw new Error("load older missing");
      return found;
    });
    fireEvent.click(more);
    await waitFor(() => expect(runItem(container, "run-failed")).toBeTruthy());
    expect(runItem(container, "run-completed")).toBeTruthy();
    expect(container.querySelector("[data-workflow-run-load-older]")).toBeNull();
  });

  it("hides cancelling from a viewer", async () => {
    const { renderPanel } = setup([waitingRun], { canRun: false });
    const { container } = renderPanel();
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-readonly]")).not.toBeNull(),
    );
    expect(container.querySelector("[data-workflow-run-cancel]")).toBeNull();
    expect(container.querySelector("[data-workflow-run-cancel-queued]")).toBeNull();
  });

  it("opens the run a notification link names", async () => {
    window.location.hash = "#approval-run-waiting";
    try {
      const { renderPanel } = setup([approvalRun, waitingRun]);
      const { container } = renderPanel();
      await waitFor(() =>
        expect(
          container.querySelector("[data-workflow-run-details]")?.getAttribute("data-run-id"),
        ).toBe("run-waiting"),
      );
    } finally {
      window.location.hash = "";
    }
  });

  it("shows the server's reason when continuing fails", async () => {
    const { renderPanel, resume } = setup([waitingRun]);
    resume.mockRejectedValueOnce(new Error("This run is not waiting on a Wait step"));
    const { container } = renderPanel();
    const continueButton = await waitFor(() => {
      const button = container.querySelector<HTMLButtonElement>("[data-workflow-run-continue]");
      if (!button) throw new Error("continue button missing");
      return button;
    });
    fireEvent.click(continueButton);
    await waitFor(() =>
      expect(container.querySelector("[data-workflow-run-error]")?.textContent).toBe(
        "This run is not waiting on a Wait step",
      ),
    );
  });

  it("blocks Start on a payload that is not a JSON object, and sends a valid one", async () => {
    const { renderPanel, start } = setup([]);
    const { container } = renderPanel();
    await screen.findByText(messages.workflowRuns.empty);
    const startButton = container.querySelector<HTMLButtonElement>("[data-workflow-run-start]");
    const payload = container.querySelector<HTMLTextAreaElement>("[data-workflow-run-payload]");
    const recordId = container.querySelector<HTMLInputElement>("[data-workflow-run-record-id]");
    if (!startButton || !payload || !recordId) throw new Error("start form not rendered");

    fireEvent.change(payload, { target: { value: "[1, 2]" } });
    expect(container.querySelector("[data-workflow-run-payload-error]")?.textContent).toBe(
      messages.workflowRuns.payloadInvalid,
    );
    expect(startButton.disabled).toBe(true);
    fireEvent.click(startButton);
    fireEvent.submit(startButton.closest("form") as HTMLFormElement);
    expect(start).not.toHaveBeenCalled();

    fireEvent.change(payload, { target: { value: '{"score": 80}' } });
    fireEvent.change(recordId, { target: { value: "  rec-9  " } });
    expect(container.querySelector("[data-workflow-run-payload-error]")).toBeNull();
    expect(startButton.disabled).toBe(false);
    fireEvent.click(startButton);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0]?.[0]).toEqual({
      nodeId: "workflow-1",
      recordId: "rec-9",
      payload: { score: 80 },
    });
    await waitFor(() => expect(runItem(container, "run-started").dataset.status).toBe("running"));
  });

  it("does not start while the canvas has unsaved changes", async () => {
    const { renderPanel, start } = setup([]);
    const { container } = renderPanel(true);
    await screen.findByText(messages.workflowRuns.empty);
    expect(screen.getByText(messages.workflowRuns.unsavedBlocked)).not.toBeNull();
    const startButton = container.querySelector<HTMLButtonElement>("[data-workflow-run-start]");
    expect(startButton?.disabled).toBe(true);
    fireEvent.submit(startButton?.closest("form") as HTMLFormElement);
    expect(start).not.toHaveBeenCalled();
  });

  it("clears the canvas highlight when it goes away", async () => {
    const { highlights, renderPanel } = setup([waitingRun]);
    const { container, unmount } = renderPanel();
    await waitFor(() => runItem(container, "run-waiting"));
    unmount();
    expect(highlights.at(-1)).toBeNull();
  });
});
