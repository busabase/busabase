// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import {
  SPACE_INSTRUCTIONS_MAX_BYTES,
  type SpaceInstructionsVO,
  type UpdateSpaceInstructionsInput,
} from "busabase-contract/domains/space-instructions/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceInstructionsSettings } from "./space-instructions-settings";

const state = (
  spaceId = "space-a",
  body = "Serve small teams.",
  version = 1,
): SpaceInstructionsVO => ({
  spaceId,
  body,
  version,
  updatedAt: version === 0 ? null : "2026-10-28T00:00:00.000Z",
});

function setup(initial = state(), canManage = true, readError?: Error) {
  let persisted = initial;
  const read = vi.fn(async () => persisted);
  if (readError) read.mockRejectedValueOnce(readError);
  const write = vi.fn(async (input: UpdateSpaceInstructionsInput) => {
    persisted = { ...persisted, body: input.body, version: persisted.version + 1 };
    return persisted;
  });
  const makeOrpc = (spaceId = initial.spaceId) =>
    ({
      spaceInstructions: {
        get: {
          queryOptions: (options: Record<string, unknown> = {}) => ({
            ...options,
            queryKey: [spaceId, "space-instructions"],
            queryFn: read,
          }),
        },
        update: { mutationOptions: () => ({ mutationFn: write }) },
      },
    }) as unknown as BusabaseQueryUtils;
  const orpc = makeOrpc();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = (props = { canManage, orpc, spaceId: initial.spaceId }) => (
    <QueryClientProvider client={client}>
      <SpaceInstructionsSettings {...props} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  return {
    ...rendered,
    read,
    write,
    client,
    view,
    orpc,
    makeOrpc,
    get persisted() {
      return persisted;
    },
    setPersisted(next: SpaceInstructionsVO) {
      persisted = next;
    },
  };
}

const editor = () =>
  screen.getByRole("textbox", { name: "Instructions (Markdown)" }) as HTMLTextAreaElement;
const save = () => screen.getByRole("button", { name: "Save instructions" }) as HTMLButtonElement;

afterEach(cleanup);

describe("space instructions settings", () => {
  it("saves a user-written background with its loaded version and displays it after re-entry", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), {
      target: { value: "## Vision\nUseful tools for every small team." },
    });
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    expect(test.write.mock.calls[0]?.[0]).toEqual({
      body: "## Vision\nUseful tools for every small team.",
      expectedVersion: 1,
    });
    expect(test.persisted.version).toBe(2);
    test.unmount();
    render(test.view());
    await waitFor(() => expect(editor().value).toBe(test.persisted.body));
  });

  it("keeps the draft after a failed save and allows retry", async () => {
    const test = setup();
    test.write.mockRejectedValueOnce(new Error("Offline"));
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "Prioritize clarity." } });
    fireEvent.click(save());
    await screen.findByText("Could not save. Your changes are still here; try saving again.");
    expect(editor().value).toBe("Prioritize clarity.");
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    expect(test.write).toHaveBeenCalledTimes(2);
    expect(test.persisted.body).toBe("Prioritize clarity.");
  });

  it("restores an unsaved draft after closing and reopening settings", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "A new team vision" } });
    test.unmount();
    const cachedDraft = test.client.getQueryCache().find({
      queryKey: ["space-instructions-draft", "space-a"],
      exact: false,
    });
    expect(cachedDraft?.gcTime).toBe(Number.POSITIVE_INFINITY);
    render(test.view());
    await waitFor(() => expect(editor().value).toBe("A new team vision"));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(test.persisted.body).toBe("Serve small teams.");
  });

  it("restores a failed-save draft after leaving and returning, then forgets it once saved", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    test.write.mockRejectedValueOnce(new Error("Offline"));
    fireEvent.change(editor(), { target: { value: "A recoverable mission" } });
    fireEvent.click(save());
    await screen.findByText("Could not save. Your changes are still here; try saving again.");
    test.unmount();
    const reopened = render(test.view());
    await waitFor(() => expect(editor().value).toBe("A recoverable mission"));
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    expect(
      test.client.getQueryCache().find({ queryKey: ["space-instructions-draft"], exact: false }),
    ).toBeUndefined();
    reopened.unmount();
    test.setPersisted(state("space-a", "Canonical team update", 3));
    render(test.view());
    await waitFor(() => expect(editor().value).toBe("Canonical team update"));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("forgets unsaved text when the session query cache is cleared", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "Private unsaved draft" } });
    test.unmount();
    test.client.clear();
    render(test.view());
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
  });

  it("never shows a cached manager draft in a read-only view", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "Manager draft" } });
    test.rerender(test.view({ canManage: false, orpc: test.orpc, spaceId: "space-a" }));
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    expect(editor().readOnly).toBe(true);
    expect(screen.queryByText("Manager draft")).toBeNull();
    test.rerender(test.view({ canManage: true, orpc: test.orpc, spaceId: "space-a" }));
    await waitFor(() => expect(editor().value).toBe("Manager draft"));
  });

  it("does not put late save responses back into a cleared session cache", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    let resolveSave: ((value: SpaceInstructionsVO) => void) | undefined;
    test.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    fireEvent.change(editor(), { target: { value: "In-flight private draft" } });
    fireEvent.click(save());
    await waitFor(() => expect(resolveSave).toBeDefined());
    test.unmount();
    test.client.clear();
    resolveSave?.(state("space-a", "In-flight private draft", 2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(test.client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("does not replace a newer reopened draft when an earlier save finishes late", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    let resolveSave: ((value: SpaceInstructionsVO) => void) | undefined;
    test.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    fireEvent.change(editor(), { target: { value: "First draft being saved" } });
    fireEvent.click(save());
    await waitFor(() => expect(resolveSave).toBeDefined());
    test.unmount();
    const reopened = render(test.view());
    await waitFor(() => expect(editor().value).toBe("First draft being saved"));
    fireEvent.change(editor(), { target: { value: "More recent draft" } });
    test.setPersisted(state("space-a", "First draft being saved", 2));
    resolveSave?.(test.persisted);
    await waitFor(() =>
      expect(
        test.client.getQueryData<SpaceInstructionsVO>(["space-a", "space-instructions"])?.version,
      ).toBe(2),
    );
    expect(editor().value).toBe("More recent draft");
    reopened.unmount();
    render(test.view());
    await waitFor(() => expect(editor().value).toBe("More recent draft"));
  });

  it("keeps drafts separate when the same workspace is opened through a different query scope", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "Original client draft" } });
    test.rerender(
      test.view({ canManage: true, orpc: test.makeOrpc("other-scope"), spaceId: "space-a" }),
    );
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    test.rerender(test.view());
    await waitFor(() => expect(editor().value).toBe("Original client draft"));
  });

  it("preserves unsaved work during a background refetch and requires a conflict reload before saving", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "My local draft" } });
    test.setPersisted(state("space-a", "A teammate's new mission", 2));
    await test.client.invalidateQueries();
    expect(editor().value).toBe("My local draft");
    test.write.mockRejectedValueOnce(Object.assign(new Error("Changed"), { code: "CONFLICT" }));
    fireEvent.click(save());
    await screen.findByText(/Someone else updated these instructions/);
    expect(editor().value).toBe("My local draft");
    expect(save().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload latest (replaces draft)" }));
    await waitFor(() => expect(editor().value).toBe("A teammate's new mission"));
    expect(test.persisted.body).toBe("A teammate's new mission");
    fireEvent.change(editor(), { target: { value: "Reviewed combined mission" } });
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    expect(test.write.mock.calls.at(-1)?.[0]).toEqual({
      body: "Reviewed combined mission",
      expectedVersion: 2,
    });
  });

  it("does not treat a loading failure as an empty configuration and recovers on retry", async () => {
    setup(state(), true, new Error("Offline"));
    await screen.findByText("Could not load the instructions. Please retry.");
    expect(
      screen.queryByText("No instructions configured. Agents can still work normally."),
    ).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
  });

  it("inserts an optional example without saving, and clearing remains a draft until saved", async () => {
    const test = setup(state("space-a", "", 0));
    await screen.findByText("No instructions configured. Agents can still work normally.");
    fireEvent.click(screen.getByRole("button", { name: "Insert example" }));
    expect(editor().value).toContain("## Design style");
    expect(test.write).not.toHaveBeenCalled();
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    fireEvent.click(screen.getByRole("button", { name: "Clear text" }));
    expect(editor().value).toBe("");
    expect(test.persisted.body).toContain("## Vision");
    fireEvent.click(save());
    await waitFor(() => expect(test.persisted.body).toBe(""));
  });

  it("provides a read-only view to members", async () => {
    setup(state(), false);
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    expect(editor().readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: "Save instructions" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear text" })).toBeNull();
  });

  it("starts a fresh editor when switching spaces, with no previous workspace draft", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), { target: { value: "Space A draft" } });
    test.setPersisted(state("space-b", "Space B values", 3));
    test.rerender(
      test.view({ canManage: true, orpc: test.makeOrpc("space-b"), spaceId: "space-b" }),
    );
    await waitFor(() => expect(editor().value).toBe("Space B values"));
    expect(screen.queryByText("Unsaved changes")).toBeNull();
    expect(test.write).not.toHaveBeenCalled();
    fireEvent.change(editor(), { target: { value: "Space B draft" } });
    test.setPersisted(state("space-a", "Serve small teams.", 1));
    test.rerender(test.view({ canManage: true, orpc: test.orpc, spaceId: "space-a" }));
    await waitFor(() => expect(editor().value).toBe("Space A draft"));
    test.setPersisted(state("space-b", "Space B values", 3));
    test.rerender(
      test.view({ canManage: true, orpc: test.makeOrpc("space-b"), spaceId: "space-b" }),
    );
    await waitFor(() => expect(editor().value).toBe("Space B draft"));
  });

  it("shows a connected local workspace under its tunnel identity", async () => {
    const test = setup(state("local", "Local team's design style"));
    test.rerender(
      <QueryClientProvider client={test.client}>
        <SpaceInstructionsSettings
          canManage
          orpc={test.orpc}
          responseSpaceId="local"
          spaceId="tnl_remote"
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(editor().value).toBe("Local team's design style"));
    fireEvent.change(editor(), { target: { value: "Local updated style" } });
    fireEvent.click(save());
    await screen.findByText("Instructions saved");
    expect(test.persisted.spaceId).toBe("local");
    expect(test.persisted.body).toBe("Local updated style");
  });

  it("uses the UTF-8 byte limit for multilingual text", async () => {
    const test = setup();
    await waitFor(() => expect(editor().value).toBe("Serve small teams."));
    fireEvent.change(editor(), {
      target: { value: "愿".repeat(SPACE_INSTRUCTIONS_MAX_BYTES / 2) },
    });
    expect(screen.getByRole("alert").textContent).toContain("32 KiB");
    expect(save().disabled).toBe(true);
    expect(test.write).not.toHaveBeenCalled();
  });
});
