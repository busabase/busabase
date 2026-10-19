// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type VaultRow,
  VaultSettingsPanel,
  type VaultSettingsPanelLabels,
} from "./vault-settings-panel";

const labels = new Proxy({} as VaultSettingsPanelLabels, {
  get: (_target, key) => () => String(key),
});

const row = (id: string, kind: VaultRow["kind"] = "secret"): VaultRow => ({
  id,
  kind,
  key: "",
  value: "",
  description: "",
  access: {},
});

const noop = () => undefined;

const panel = (rows: VaultRow[]) => (
  <VaultSettingsPanel
    accessFlags={[]}
    activeItemTab="secrets"
    isError={false}
    isLoading={false}
    isSaving={false}
    labels={labels}
    onActiveItemTabChange={noop}
    onAddRow={noop}
    onClear={noop}
    onRemoveRow={noop}
    onSave={noop}
    onUpdateRow={noop}
    rows={rows}
    showSecrets={false}
  />
);

const focusedId = () => (document.activeElement as HTMLElement | null)?.id ?? "";

afterEach(cleanup);

describe("VaultSettingsPanel added-row focus", () => {
  it("focuses the name of a row appended to the existing ones", () => {
    const { rerender } = render(panel([row("a")]));
    rerender(panel([row("a"), row("b")]));
    expect(focusedId()).toBe("vault-key-b");
  });

  it("leaves focus alone when rows first load", () => {
    const { rerender } = render(panel([]));
    rerender(panel([row("a")]));
    expect(focusedId()).toBe("");
  });

  it("leaves focus alone when the last row is replaced by a fresh empty one", () => {
    const { rerender } = render(panel([row("a")]));
    rerender(panel([row("c")]));
    expect(focusedId()).toBe("");
  });

  it("leaves focus alone when every row is replaced, even with one more than before", () => {
    const { rerender } = render(panel([row("a"), row("b")]));
    rerender(panel([row("c"), row("d", "variable"), row("e")]));
    expect(focusedId()).toBe("");
  });

  it("leaves focus alone when an existing row is edited", () => {
    const { rerender } = render(panel([row("a")]));
    rerender(panel([{ ...row("a"), key: "API_KEY" }]));
    expect(focusedId()).toBe("");
  });
});
