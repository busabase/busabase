// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  SpaceWelcomeVO,
  UpdateSpaceWelcomeInput,
} from "busabase-contract/domains/space-welcome/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { SpaceWelcomeSettings } from "./space-welcome-settings";

const node = (id: string, type: "doc" | "html", name: string) => ({
  id,
  parentId: null,
  type,
  slug: id,
  name,
  description: "",
  metadata: {},
  settings: {},
  explicitVisibility: null,
  icon: null,
  position: 0,
  createdAt: "2026-10-30T00:00:00.000Z",
  updatedAt: "2026-10-30T00:00:00.000Z",
  baseId: null,
  children: [],
});

const CANDIDATES = [
  node("nod_guide", "doc", "Customer guide"),
  node("nod_portal", "html", "Portal page"),
  node("nod_notes", "doc", "Meeting notes"),
];

function setup({
  initial = { spaceId: "local", nodeId: null, version: 0, updatedAt: null } as SpaceWelcomeVO,
  canManage = true,
  readable = new Set(CANDIDATES.map((candidate) => candidate.id)),
}: {
  initial?: SpaceWelcomeVO;
  canManage?: boolean;
  readable?: Set<string>;
} = {}) {
  let persisted = initial;
  const read = vi.fn(async () => persisted);
  const write = vi.fn(async (input: UpdateSpaceWelcomeInput) => {
    if (input.expectedVersion !== persisted.version) {
      throw Object.assign(new Error("Conflict"), { code: "CONFLICT" });
    }
    persisted = {
      ...persisted,
      nodeId: input.nodeId,
      version: persisted.version + 1,
      updatedAt: "2026-10-30T01:00:00.000Z",
    };
    return persisted;
  });
  const list = vi.fn(async () => CANDIDATES);
  const orpc = {
    spaceWelcome: {
      get: {
        queryOptions: (options: Record<string, unknown> = {}) => ({
          ...options,
          queryKey: [["spaceWelcome", "get"]],
          queryFn: read,
        }),
      },
      update: { mutationOptions: () => ({ mutationFn: write }) },
    },
    nodes: {
      get: {
        queryOptions: ({ input }: { input: { nodeId: string } }) => ({
          queryKey: ["nodes.get", input.nodeId],
          queryFn: async () => {
            const found = CANDIDATES.find((candidate) => candidate.id === input.nodeId);
            if (!found || !readable.has(found.id)) {
              throw Object.assign(new Error("Forbidden"), { code: "FORBIDDEN" });
            }
            return { type: found.type, node: found };
          },
        }),
      },
      list: {
        queryOptions: ({ input }: { input: unknown }) => ({
          queryKey: ["nodes.list", input],
          queryFn: list,
        }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CoreI18nProvider locale="en">
        <SpaceWelcomeSettings canManage={canManage} orpc={orpc} spaceId="local" />
      </CoreI18nProvider>
    </QueryClientProvider>,
  );
  return {
    read,
    write,
    list,
    setPersisted(next: SpaceWelcomeVO) {
      persisted = next;
    },
  };
}

const saveButton = () =>
  screen.getByRole("button", { name: "Use as welcome page" }) as HTMLButtonElement;

afterEach(cleanup);

describe("space welcome settings", () => {
  it("lets a manager search Docs and HTML pages, choose one, and save it with the loaded version", async () => {
    const { write, list } = setup();
    await screen.findByText("No welcome page is set. Home shows Getting started instead.");
    await screen.findByRole("radio", { name: /Customer guide/ });
    expect(list).toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);

    fireEvent.change(screen.getByRole("searchbox", { name: "Choose a Doc or HTML page" }), {
      target: { value: "portal" },
    });
    expect(screen.queryByRole("radio", { name: /Customer guide/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Portal page/ }));
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());

    await screen.findByText("Welcome page saved");
    expect(write.mock.calls[0]?.[0]).toEqual({ nodeId: "nod_portal", expectedVersion: 0 });
    await waitFor(() =>
      expect(document.querySelector("[data-space-welcome-current]")?.textContent).toContain(
        "Portal page",
      ),
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("No pages match “zzz”.")).toBeTruthy();
  });

  it("removes the welcome page in one click", async () => {
    const { write } = setup({
      initial: { spaceId: "local", nodeId: "nod_guide", version: 3, updatedAt: null },
    });
    await waitFor(() =>
      expect(document.querySelector("[data-space-welcome-current]")?.textContent).toContain(
        "Customer guide",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove welcome page" }));
    await screen.findByText("No welcome page is set. Home shows Getting started instead.");
    expect(write.mock.calls[0]?.[0]).toEqual({ nodeId: null, expectedVersion: 3 });
  });

  it("refuses to overwrite another manager's change and reloads the latest choice", async () => {
    const { write, setPersisted } = setup();
    fireEvent.click(await screen.findByRole("radio", { name: /Customer guide/ }));
    // Someone else chose a page after this editor loaded.
    setPersisted({ spaceId: "local", nodeId: "nod_notes", version: 1, updatedAt: null });
    fireEvent.click(saveButton());
    await screen.findByText(
      "Someone else changed the welcome page. Reload to see the latest choice.",
    );
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    await waitFor(() =>
      expect(document.querySelector("[data-space-welcome-current]")?.textContent).toContain(
        "Meeting notes",
      ),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect((screen.getByRole("radio", { name: /Meeting notes/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("shows members the current choice read-only, and never the name of a page they cannot open", async () => {
    const { list } = setup({
      canManage: false,
      initial: { spaceId: "local", nodeId: "nod_guide", version: 1, updatedAt: null },
      readable: new Set(),
    });
    await screen.findByText(
      "The chosen page is missing, archived, or not visible to you, so members see Getting started instead.",
    );
    expect(document.body.textContent).not.toContain("Customer guide");
    expect(
      screen.getByText("Only space owners and admins can change the welcome page."),
    ).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Use as welcome page" })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });
});
