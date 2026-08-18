import type { VaultSettingsVO } from "busabase-contract/domains/vault/types";
import { describe, expect, it } from "vitest";
import { createVaultRow, vaultRowsToItems, vaultSettingsToRows } from "./vault-form";

describe("vault form mapping", () => {
  it("maps saved settings into editable rows without losing access state", () => {
    const settings = {
      items: [
        {
          id: "vault-1",
          kind: "secret",
          key: "API_KEY",
          value: "value",
          description: "Primary key",
          access: { runtime: false, reveal: true, edit: true, share: false },
        },
      ],
    } as VaultSettingsVO;

    expect(vaultSettingsToRows(settings)).toEqual([
      {
        id: "vault-1",
        kind: "secret",
        key: "API_KEY",
        value: "value",
        description: "Primary key",
        runtimeAccess: false,
      },
    ]);
  });

  it("normalizes keys, omits draft ids, and promotes secret-shaped variables", () => {
    const row = createVaultRow("variable", "local-1");

    expect(vaultRowsToItems([{ ...row, key: " api_token ", description: " token " }])).toEqual([
      {
        id: undefined,
        kind: "secret",
        key: "API_TOKEN",
        value: "",
        scopeType: "personal",
        scopeId: null,
        environment: "local",
        description: "token",
        access: { runtime: true, reveal: true, edit: true, share: false },
      },
    ]);
  });
});
