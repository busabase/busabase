// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BaseFieldVO, UserRefVO } from "busabase-contract/types";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./identity";
import { MemberFieldEditor, SPACE_MEMBERS_QUERY_KEY } from "./member-field";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const member = (id: string, name: string, email = `${id}@example.com`): UserRefVO => ({
  id,
  name,
  email,
  image: null,
  role: null,
});
const alice = member("alice", "Alice");
const bob = member("bob", "Bob");
const former = member("former", "Former colleague");
const field = { id: "owners", slug: "owners", type: "member", options: {} } as BaseFieldVO;

function mount({
  initial = [] as unknown,
  multiple = true,
  load = vi.fn().mockResolvedValue([bob, alice]),
  users = {} as Record<string, UserRefVO>,
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const changed = vi.fn();
  const submitted = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted();
        }}
      >
        <MemberFieldEditor
          ariaDescribedBy="members-help"
          client={{ listSpaceMembers: load }}
          field={{ ...field, options: { multiple } }}
          fieldName="Members"
          inputId="members"
          onChange={(next) => {
            changed(next);
            setValue(next);
          }}
          users={users}
          value={value}
        />
        <span id="members-help">Choose the people responsible</span>
        <output data-testid="value">{JSON.stringify(value)}</output>
        <button type="submit">Save</button>
      </form>
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { queryClient, changed, submitted, load };
}
const open = () => fireEvent.click(screen.getByRole("button", { name: "Members" }));
const pick = async (name: string) => fireEvent.click(await screen.findByRole("option", { name }));
const value = () => screen.getByTestId("value").textContent;

describe("MemberFieldEditor", () => {
  it("starts collapsed and exposes independent add and accessible removal buttons", async () => {
    mount({ initial: ["alice"] });
    expect(screen.queryByRole("listbox")).toBeNull();
    const remove = await screen.findByRole("button", { name: "Remove Alice" });
    expect(remove.closest("button")?.parentElement?.closest("button")).toBeNull();
    expect(screen.getByRole("button", { name: "Members" }).getAttribute("aria-describedby")).toBe(
      "members-help",
    );
    fireEvent.click(remove);
    expect(value()).toBe("[]");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("toggles multiple people without modifiers or reordering and does not submit the form", async () => {
    const { changed, submitted } = mount();
    open();
    await pick("Alice · alice@example.com");
    await pick("Bob · bob@example.com");
    expect(value()).toBe('["alice","bob"]');
    expect(screen.getByRole("listbox").getAttribute("aria-multiselectable")).toBe("true");
    expect(
      screen.getAllByRole("option").map((option) => option.getAttribute("aria-label")),
    ).toEqual(["Alice · alice@example.com", "Bob · bob@example.com"]);
    expect(screen.getByRole("option", { name: /Alice/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await pick("Alice · alice@example.com");
    expect(value()).toBe('["bob"]');
    expect(changed).toHaveBeenLastCalledWith(["bob"]);
    expect(submitted).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toBe(document.activeElement);
  });

  it("filters name/email immediately while preserving selected and former members outside results", async () => {
    mount({ initial: ["alice", "former"], users: { former } });
    open();
    await screen.findByRole("option", { name: /Alice/ });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "BOB@EXAMPLE" } });
    expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Former colleague" })).toBeTruthy();
    await pick("Bob · bob@example.com");
    expect(value()).toBe('["alice","former","bob"]');
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "nobody" } });
    expect(screen.getByText("No matches")).toBeTruthy();
    expect(value()).toBe('["alice","former","bob"]');
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("replaces single-select with a scalar, closes and supports Unassigned and removal", async () => {
    const { changed } = mount({ initial: "alice", multiple: false });
    open();
    await pick("Bob · bob@example.com");
    expect(changed).toHaveBeenLastCalledWith("bob");
    expect(screen.queryByRole("combobox")).toBeNull();
    open();
    await pick("Unassigned");
    expect(changed).toHaveBeenLastCalledWith("");
    open();
    await pick("Alice · alice@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Remove Alice" }));
    expect(changed).toHaveBeenLastCalledWith("");
  });

  it("distinguishes keyboard activity from selection and Enter never submits", async () => {
    const { submitted, changed } = mount();
    open();
    const search = screen.getByRole("combobox");
    await screen.findByRole("option", { name: /Alice/ });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    const bobOption = screen.getByRole("option", { name: /Bob/ });
    expect(search.getAttribute("aria-activedescendant")).toBe(bobOption.id);
    expect(bobOption.getAttribute("aria-selected")).toBe("false");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(bobOption.getAttribute("aria-selected")).toBe("true");
    expect(value()).toBe('["bob"]');
    expect(submitted).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Members" })),
    );
    open();
    expect(screen.getByRole("option", { name: /Bob/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("shows loading without marking preserved selections as former", async () => {
    mount({
      initial: ["former"],
      users: { former },
      load: vi.fn(() => new Promise<UserRefVO[]>(() => {})),
    });
    open();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove Former colleague" })).toBeTruthy();
    expect(screen.queryByText(/No longer in this space/)).toBeNull();
    expect(value()).toBe('["former"]');
  });

  it("does not select a person when Enter commits an IME composition", async () => {
    const { changed } = mount();
    open();
    await screen.findByRole("option", { name: /Alice/ });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter", isComposing: true });
    expect(changed).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toBeTruthy();
  });

  it("distinguishes empty space from no search matches", async () => {
    mount({ load: vi.fn().mockResolvedValue([]) });
    open();
    await screen.findByText("No members to choose from");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Alice" } });
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("offers retry after failure and retains values through recovery", async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([alice, bob]);
    mount({ initial: ["former"], users: { former }, load });
    open();
    expect((await screen.findByRole("alert")).textContent).toContain("Could not load members.");
    expect(screen.queryByText(/No longer in this space/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await pick("Alice · alice@example.com");
    expect(value()).toBe('["former","alice"]');
    expect(screen.getByText("(No longer in this space)")).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Former colleague/ })).toBeNull();
  });

  it("hides stale assignment candidates on permission denial, preserves record identities, and does not retry", async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce([alice, bob])
      .mockRejectedValue(Object.assign(new Error("denied"), { code: "FORBIDDEN", status: 403 }));
    const { queryClient } = mount({ initial: ["alice"], users: { alice }, load });
    open();
    await screen.findByRole("option", { name: /Bob/ });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: SPACE_MEMBERS_QUERY_KEY });
    });
    expect((await screen.findByRole("alert")).textContent).toContain("You do not have permission");
    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove Alice" })).toBeTruthy();
    expect(screen.queryByText(/No longer in this space/)).toBeNull();
    expect(value()).toBe('["alice"]');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps unknown IDs editable and collapses more than two rows without hidden focusable controls", async () => {
    mount({ initial: ["alice", "bob", "unknown1", "unknown2", "unknown3", "unknown4"] });
    await screen.findByRole("button", { name: "Remove Alice" });
    const collapsedRemovals = screen.getAllByRole("button", { name: /^Remove / });
    expect(collapsedRemovals).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "2 more members" }));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "Show fewer members" }));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(4);
    open();
    await pick("Bob · bob@example.com");
    expect(value()).toBe('["alice","unknown1","unknown2","unknown3","unknown4"]');
  });

  it("renders name and secondary email separately, without duplicating an email-only name", async () => {
    mount({ load: vi.fn().mockResolvedValue([alice, member("email", "", "only@example.com")]) });
    open();
    const option = await screen.findByRole("option", { name: /Alice/ });
    expect(within(option).getByText("Alice")).toBeTruthy();
    expect(within(option).getByText("alice@example.com")).toBeTruthy();
    expect(
      within(screen.getByRole("option", { name: "only@example.com" })).getAllByText(
        "only@example.com",
      ),
    ).toHaveLength(1);
  });

  it("isolates inputless roster queries for two spaces sharing a QueryClient", async () => {
    const queryClient = new QueryClient();
    const first = { listSpaceMembers: vi.fn().mockResolvedValue([alice]) };
    const second = { listSpaceMembers: vi.fn().mockResolvedValue([bob]) };
    const editor = (client: typeof first) => (
      <QueryClientProvider client={queryClient}>
        <MemberFieldEditor
          client={client}
          field={field}
          fieldName="Members"
          inputId="members"
          onChange={vi.fn()}
          value={[]}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(editor(first));
    open();
    await screen.findByRole("option", { name: /Alice/ });
    rerender(editor(second));
    await screen.findByRole("option", { name: /Bob/ });
    expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull();
    rerender(editor(first));
    await screen.findByRole("option", { name: /Alice/ });
    expect(first.listSpaceMembers).toHaveBeenCalledTimes(1);
    expect(second.listSpaceMembers).toHaveBeenCalledTimes(1);
  });

  it("shows email-only selected identities by email while retaining unresolved IDs", async () => {
    mount({
      initial: ["email", "unknown"],
      load: vi.fn().mockResolvedValue([member("email", "", "only@example.com")]),
    });
    await screen.findByRole("button", { name: "Remove only@example.com" });
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    expect(value()).toBe('["email","unknown"]');
  });

  it("loads and isolates roster caches without secure-context Web Crypto", async () => {
    vi.stubGlobal("crypto", undefined);
    const queryClient = new QueryClient();
    const first = { listSpaceMembers: vi.fn().mockResolvedValue([alice]) };
    const second = { listSpaceMembers: vi.fn().mockResolvedValue([bob]) };
    const editor = (client: typeof first) => (
      <QueryClientProvider client={queryClient}>
        <MemberFieldEditor
          client={client}
          field={field}
          fieldName="Members"
          inputId="members"
          onChange={vi.fn()}
          value={[]}
        />
      </QueryClientProvider>
    );
    const { rerender } = render(editor(first));
    open();
    await screen.findByRole("option", { name: /Alice/ });
    rerender(editor(second));
    await screen.findByRole("option", { name: /Bob/ });
    expect(screen.queryByRole("option", { name: /Alice/ })).toBeNull();
  });
});

describe("UserAvatar", () => {
  it.each([
    ["李明", "李"],
    ["山田 太郎", "山"],
    ["김민수", "김"],
    ["Alice Brown", "AB"],
    ["Élodie Noël", "ÉN"],
    ["😀", "?"],
  ])("uses readable Unicode initials for %s", (name, expected) => {
    render(<UserAvatar user={{ ...alice, name }} />);
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it("uses stable initials when an image fails and attempts a replacement URL", () => {
    const user = { ...alice, image: "/broken.png" };
    const { rerender } = render(<UserAvatar user={user} />);
    fireEvent.error(screen.getByRole("img", { name: "Alice" }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("AL")).toBeTruthy();
    rerender(<UserAvatar user={{ ...user, image: "/new.png" }} />);
    expect(screen.getByRole("img").getAttribute("src")).toBe("/new.png");
  });
});
