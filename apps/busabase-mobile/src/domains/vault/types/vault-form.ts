import type { VaultItemKind } from "busabase-contract/domains/vault/types";

export interface VaultRow {
  id: string;
  kind: VaultItemKind;
  key: string;
  value: string;
  description: string;
  runtimeAccess: boolean;
}

export interface VaultDraft {
  row: VaultRow;
  isNew: boolean;
}
