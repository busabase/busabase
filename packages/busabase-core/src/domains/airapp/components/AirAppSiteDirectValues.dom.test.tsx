// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AirAppSiteDirectValueInput,
  AirAppSiteEnvironmentBinding,
  AirAppSiteEnvironmentVO,
  AirAppSiteStateVO,
} from "busabase-contract/domains/airapp/contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CoreI18nProvider } from "../../../i18n";
import { coreMessagesEn } from "../../../i18n/messages";
import { AirAppSiteEnvironment } from "./AirAppSiteEnvironment";

const copy = coreMessagesEn.airapp.site.environment;
const clients: QueryClient[] = [];
const empty = (): AirAppSiteEnvironmentVO => ({
  available: true,
  sources: [],
  bindings: [],
  directValues: [],
  vaultLinks: {
    space: "/dashboard/team/home?settings=account&tab=vault&vaultScope=workspace&vaultScopeId=team",
  },
});
type SaveInput = {
  nodeId: string;
  bindings: AirAppSiteEnvironmentBinding[];
  directValues?: AirAppSiteDirectValueInput[];
};

function mount(initial = empty()) {
  let stored = initial;
  let nextId = 0;
  const read = vi.fn(async () => stored);
  const save = vi.fn(async (input: SaveInput) => {
    const previous = [...(stored.directValues ?? []), ...(stored.unboundDirectValues ?? [])];
    stored = {
      ...stored,
      bindings: input.bindings.map((binding) => ({
        ...binding,
        sourceKey: "SPACE_VALUE",
        kind: "variable" as const,
        status: "ready" as const,
      })),
      ...(input.directValues
        ? {
            directValues: input.directValues.map((entry) => ({
              vaultItemId: entry.vaultItemId ?? `direct-${++nextId}`,
              envName: entry.envName,
              kind: entry.kind,
              hasValue:
                entry.value !== undefined
                  ? entry.value.length > 0
                  : (previous.find((row) => row.vaultItemId === entry.vaultItemId)?.hasValue ??
                    false),
              status: "ready" as const,
            })),
            unboundDirectValues: stored.unboundDirectValues?.filter(
              (entry) => !input.directValues?.some((row) => row.vaultItemId === entry.vaultItemId),
            ),
          }
        : {}),
    };
    return stored;
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const orpc = {
    airapps: {
      siteEnvironment: {
        queryOptions: () => ({ queryKey: ["siteEnvironment", "node"], queryFn: read }),
      },
      siteSaveEnvironment: { call: save },
      siteState: {
        queryOptions: () => ({ queryKey: ["siteState", "node"], queryFn: async () => ({}) }),
      },
    },
  } as unknown as BusabaseQueryUtils;
  const view = render(
    <CoreI18nProvider locale="en">
      <QueryClientProvider client={client}>
        <AirAppSiteEnvironment
          orpc={orpc}
          nodeId="node"
          state={{ engine: "available" } as AirAppSiteStateVO}
        />
      </QueryClientProvider>
    </CoreI18nProvider>,
  );
  return {
    ...view,
    read,
    save,
    client,
    setStored: (next: AirAppSiteEnvironmentVO) => {
      stored = next;
    },
  };
}
const directRows = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-airapp-site-direct-row]"));
const control = <T extends HTMLElement>(index: number, selector: string): T => {
  const element = directRows()[index]?.querySelector<T>(selector);
  if (!element) throw new Error(`Expected direct value control: ${selector}`);
  return element;
};
const directName = (index = 0) =>
  control<HTMLInputElement>(index, "[data-airapp-site-direct-name]");
const directValue = (index = 0) =>
  control<HTMLInputElement>(index, "[data-airapp-site-direct-value]");
const saveButton = () => screen.getByRole<HTMLButtonElement>("button", { name: copy.save });
const addDirect = async (name = "SERVICE_TOKEN", value?: string) => {
  fireEvent.click(await screen.findByRole("button", { name: copy.addVariable }));
  fireEvent.change(directName(directRows().length - 1), { target: { value: name } });
  if (value !== undefined)
    fireEvent.change(directValue(directRows().length - 1), { target: { value } });
};

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("Direct Site environment values", () => {
  it("adopts a saved website item by identity without mixing it into Space binding choices", async () => {
    const view = mount({
      ...empty(),
      sources: [{ id: "space-label", key: "PRODUCTNAME", kind: "variable" }],
      unboundDirectValues: [
        {
          vaultItemId: "vault_saved_blog_date",
          envName: "BLOG_DATE",
          kind: "secret",
          hasValue: true,
          status: "ready",
        },
      ],
    });
    await screen.findByText(copy.unboundTitle);
    const manifest = document.querySelector<HTMLElement>("[data-airapp-site-deployment-list]");
    if (!manifest) throw new Error("Expected deployment configuration list");
    expect(manifest.textContent).not.toContain("BLOG_DATE");
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    const source = screen.getByRole<HTMLSelectElement>("combobox", { name: copy.source });
    expect(Array.from(source.options).map((option) => option.value)).toEqual(["", "space-label"]);
    fireEvent.change(source, { target: { value: "space-label" } });
    fireEvent.click(screen.getByRole("button", { name: copy.adoptExisting }));
    expect(directName().value).toBe("BLOG_DATE");
    expect(directValue().value).toBe("");
    expect(directValue().type).toBe("password");
    expect(manifest.textContent).toContain(`BLOG_DATE · ${copy.secret} · ${copy.directSource}`);
    expect(manifest.textContent).toContain(`${copy.spaceSource}: PRODUCTNAME`);
    expect(screen.queryByText(copy.unboundTitle)).toBeNull();
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenLastCalledWith({
      nodeId: "node",
      bindings: [{ envName: "PRODUCTNAME", vaultItemId: "space-label" }],
      directValues: [
        { vaultItemId: "vault_saved_blog_date", envName: "BLOG_DATE", kind: "secret" },
      ],
    });
    await screen.findByText(copy.valueSaved);
    expect(JSON.stringify(view.client.getQueriesData({}))).not.toContain('"value":');
  });

  it("requires confirmation before deleting the last selected item and keeps unrelated saved items visible", async () => {
    const view = mount({
      ...empty(),
      directValues: [
        {
          vaultItemId: "selected",
          envName: "COMPANY_NAME",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
      ],
      unboundDirectValues: [
        {
          vaultItemId: "unbound",
          envName: "BLOG_DATE",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
      ],
    });
    await screen.findByText(copy.unboundTitle);
    fireEvent.click(control<HTMLButtonElement>(0, "[data-airapp-site-direct-remove]"));
    const dialog = await screen.findByRole("alertdialog", { name: copy.directRemovalTitle });
    expect(dialog.textContent).toContain(copy.directRemovalDescription);
    fireEvent.click(within(dialog).getByRole("button", { name: copy.cancel }));
    expect(directRows()).toHaveLength(1);
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(control<HTMLButtonElement>(0, "[data-airapp-site-direct-remove]"));
    fireEvent.click(await screen.findByRole("button", { name: copy.confirmRemove }));
    expect(directRows()).toHaveLength(0);
    await screen.findByText(copy.deploymentEmpty);
    expect(screen.getByText(copy.unboundTitle)).toBeTruthy();
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenLastCalledWith({ nodeId: "node", bindings: [], directValues: [] });
    expect(screen.getByRole("button", { name: copy.adoptExisting })).toBeTruthy();
  });

  it("preserves blank saved values across renames and protects saved Secret types", async () => {
    const view = mount({
      ...empty(),
      directValues: [
        {
          vaultItemId: "secret",
          envName: "SERVICE_TOKEN",
          kind: "secret",
          hasValue: true,
          status: "ready",
        },
        {
          vaultItemId: "variable",
          envName: "LABEL",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
      ],
    });
    await screen.findByText(copy.secretTypeLocked);
    expect(
      control<HTMLSelectElement>(
        0,
        "[data-airapp-site-direct-kind]",
      ).querySelector<HTMLOptionElement>('option[value="variable"]')?.disabled,
    ).toBe(true);
    fireEvent.change(directValue(1), { target: { value: "replacement" } });
    fireEvent.change(directValue(1), { target: { value: "" } });
    fireEvent.change(directName(1), { target: { value: "RENAMED_LABEL" } });
    fireEvent.change(control<HTMLSelectElement>(1, "[data-airapp-site-direct-kind]"), {
      target: { value: "secret" },
    });
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save.mock.calls[0][0].directValues).toEqual([
      { vaultItemId: "secret", envName: "SERVICE_TOKEN", kind: "secret" },
      { vaultItemId: "variable", envName: "RENAMED_LABEL", kind: "secret" },
    ]);
  });

  it("keeps invalid, colliding and runtime-disabled saved items out of the deployable selection", async () => {
    mount({
      ...empty(),
      directValues: [
        {
          vaultItemId: "selected",
          envName: "EXISTING",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
      ],
      unboundDirectValues: [
        {
          vaultItemId: "invalid",
          envName: "CLOUDFLARE_TOKEN",
          kind: "secret",
          hasValue: true,
          status: "ready",
        },
        {
          vaultItemId: "colliding",
          envName: "EXISTING",
          kind: "variable",
          hasValue: true,
          status: "ready",
        },
        {
          vaultItemId: "disabled",
          envName: "DISABLED",
          kind: "variable",
          hasValue: true,
          status: "runtime-disabled",
        },
      ],
    });
    const buttons = await screen.findAllByRole<HTMLButtonElement>("button", {
      name: copy.adoptExisting,
    });
    expect(buttons).toHaveLength(3);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(directRows()).toHaveLength(1);
  });

  it("keeps an adopted draft while refreshing its Vault runtime permission", async () => {
    const item = {
      vaultItemId: "unbound",
      envName: "BLOG_DATE",
      kind: "variable" as const,
      hasValue: true,
      status: "ready" as const,
    };
    const view = mount({ ...empty(), unboundDirectValues: [item] });
    fireEvent.click(await screen.findByRole("button", { name: copy.adoptExisting }));
    expect(saveButton().disabled).toBe(false);
    view.setStored({ ...empty(), unboundDirectValues: [{ ...item, status: "runtime-disabled" }] });
    window.dispatchEvent(new Event("focus"));
    await screen.findByText(copy.directRuntimeDisabled);
    expect(directName().value).toBe("BLOG_DATE");
    expect(saveButton().disabled).toBe(true);
    expect(view.save).not.toHaveBeenCalled();
  });

  it("saves without Space sources, forgets typed values, retains by identity and explicitly saves empty", async () => {
    const view = mount();
    const link = await screen.findByRole<HTMLAnchorElement>("link", { name: /Open Vault/ });
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    await addDirect();
    expect(directValue().type).toBe("password");
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(directValue(), { target: { value: "typed-secret-sentinel" } });
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenLastCalledWith({
      nodeId: "node",
      bindings: [],
      directValues: [{ envName: "SERVICE_TOKEN", kind: "secret", value: "typed-secret-sentinel" }],
    });
    expect(directValue().value).toBe("");
    expect(await screen.findByText(copy.valueSaved)).toBeTruthy();
    await waitFor(() => expect(view.client.getMutationCache().getAll()).toHaveLength(0));
    expect(JSON.stringify(view.client.getQueriesData({}))).not.toContain("typed-secret-sentinel");
    fireEvent.change(directName(), { target: { value: "RENAMED_TOKEN" } });
    fireEvent.click(saveButton());
    await waitFor(() =>
      expect(view.save).toHaveBeenLastCalledWith({
        nodeId: "node",
        bindings: [],
        directValues: [{ vaultItemId: "direct-1", envName: "RENAMED_TOKEN", kind: "secret" }],
      }),
    );
    await waitFor(() => expect(saveButton().disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: copy.clearValue }));
    await screen.findByText(copy.valueCleared);
    fireEvent.click(saveButton());
    await screen.findByText(copy.valueSavedEmpty);
    expect(view.save.mock.calls.at(-1)?.[0].directValues?.[0].value).toBe("");
    expect(directValue().value).toBe("");
  });

  it("keeps binding aliases and direct fields together after failure and validates both name sets", async () => {
    const view = mount({
      ...empty(),
      sources: [{ id: "space-value", key: "SPACE_VALUE", kind: "variable" }],
    });
    await addDirect("SHARED_NAME", "draft-sentinel");
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(screen.getByRole("combobox", { name: copy.source }), {
      target: { value: "space-value" },
    });
    const alias = document.querySelector<HTMLInputElement>("[data-airapp-site-environment-name]");
    if (!alias) throw new Error("Expected binding alias input");
    fireEvent.change(alias, { target: { value: "SHARED_NAME" } });
    expect(saveButton().disabled).toBe(true);
    await screen.findByText(copy.invalid);
    fireEvent.change(alias, { target: { value: "mixedCaseAlias" } });
    fireEvent.change(directName(), { target: { value: "lowercase" } });
    expect(saveButton().disabled).toBe(true);
    await screen.findByText(copy.directInvalid);
    fireEvent.change(directName(), { target: { value: "BUSABASE_KEY" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(directName(), { target: { value: "SERVICE_TOKEN" } });
    view.save.mockRejectedValueOnce(new Error("provider-secret-must-not-display"));
    fireEvent.click(saveButton());
    await screen.findByText(copy.saveFailed);
    expect(directValue().value).toBe("draft-sentinel");
    expect(alias.value).toBe("mixedCaseAlias");
    expect(document.body.textContent).not.toContain("provider-secret-must-not-display");
    await waitFor(() => expect(view.client.getMutationCache().getAll()).toHaveLength(0));
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save).toHaveBeenLastCalledWith({
      nodeId: "node",
      bindings: [{ envName: "mixedCaseAlias", vaultItemId: "space-value" }],
      directValues: [{ envName: "SERVICE_TOKEN", kind: "secret", value: "draft-sentinel" }],
    });
  });

  it("distinguishes saved empty from missing and disabled values without revealing either kind", async () => {
    mount({
      ...empty(),
      directValues: [
        {
          vaultItemId: "empty",
          envName: "PUBLIC_EMPTY",
          kind: "variable",
          hasValue: false,
          status: "ready",
        },
        {
          vaultItemId: "missing",
          envName: "MISSING_TOKEN",
          kind: "secret",
          hasValue: false,
          status: "missing",
        },
        {
          vaultItemId: "disabled",
          envName: "DISABLED_TOKEN",
          kind: "secret",
          hasValue: true,
          status: "runtime-disabled",
        },
      ],
    });
    await screen.findByText(copy.valueSavedEmpty);
    expect(screen.getAllByText(copy.valueSavedEmpty)).toHaveLength(1);
    await screen.findByText(copy.directMissing);
    await screen.findByText(copy.directRuntimeDisabled);
    expect(directValue(0).value).toBe("");
    expect(directValue(1).value).toBe("");
    fireEvent.change(directValue(1), { target: { value: "replacement" } });
    expect(saveButton().disabled).toBe(true);
    fireEvent.click(control<HTMLButtonElement>(2, "[data-airapp-site-direct-remove]"));
    fireEvent.click(await screen.findByRole("button", { name: copy.confirmRemove }));
    expect(saveButton().disabled).toBe(false);
  });

  it("refreshes Vault metadata on return and notifications while preserving unsaved value and binding drafts", async () => {
    const channels: Array<{ onmessage?: (event: MessageEvent) => void; close: () => void }> = [];
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        onmessage?: (event: MessageEvent) => void;
        close = vi.fn();
        constructor() {
          channels.push(this);
        }
      },
    );
    const view = mount();
    await addDirect("DRAFT_VALUE", "unsaved-sensitive-value");
    view.setStored({
      ...empty(),
      sources: [{ id: "new-source", key: "NEW_SOURCE", kind: "variable" }],
    });
    const before = view.read.mock.calls.length;
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(view.read.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>("button", { name: copy.add }).disabled).toBe(
        false,
      ),
    );
    expect(directValue().value).toBe("unsaved-sensitive-value");
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(screen.getByRole("combobox", { name: copy.source }), {
      target: { value: "new-source" },
    });
    const beforeMessage = view.read.mock.calls.length;
    channels[0].onmessage?.(
      new MessageEvent("message", {
        data: { type: "vault-saved", scopeType: "workspace", scopeId: "team" },
      }),
    );
    await waitFor(() => expect(view.read.mock.calls.length).toBeGreaterThan(beforeMessage));
    expect(directValue().value).toBe("unsaved-sensitive-value");
    expect((screen.getByRole("combobox", { name: copy.source }) as HTMLSelectElement).value).toBe(
      "new-source",
    );
    expect(view.save).not.toHaveBeenCalled();
    expect(JSON.stringify(view.client.getQueriesData({}))).not.toContain("unsaved-sensitive-value");
  });

  it("submits Variable values deliberately, and preserves drafts when a background metadata refresh fails", async () => {
    const view = mount();
    await addDirect("PUBLIC_LABEL", "public-label-value");
    fireEvent.change(control<HTMLSelectElement>(0, "[data-airapp-site-direct-kind]"), {
      target: { value: "variable" },
    });
    expect(directValue().type).toBe("text");
    view.read.mockRejectedValueOnce(new Error("refresh unavailable"));
    window.dispatchEvent(new Event("focus"));
    await screen.findByText(copy.loadFailed);
    expect(directValue().value).toBe("public-label-value");
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save.mock.calls[0][0].directValues).toEqual([
      { envName: "PUBLIC_LABEL", kind: "variable", value: "public-label-value" },
    ]);
    expect(directValue().value).toBe("");
    await screen.findByText(copy.valueSaved);
    expect(JSON.stringify(view.client.getQueriesData({}))).not.toContain("public-label-value");
  });

  it("keeps old hosts binding-only and does not send a direct array", async () => {
    const view = mount({
      available: true,
      sources: [{ id: "source", key: "VALUE", kind: "secret" }],
      bindings: [],
    });
    await screen.findByRole("button", { name: copy.add });
    expect(screen.queryByRole("button", { name: copy.addVariable })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.add }));
    fireEvent.change(screen.getByRole("combobox", { name: copy.source }), {
      target: { value: "source" },
    });
    fireEvent.click(saveButton());
    await screen.findByText(copy.saved);
    expect(view.save.mock.calls[0][0]).toEqual({
      nodeId: "node",
      bindings: [{ envName: "VALUE", vaultItemId: "source" }],
    });
  });
});
