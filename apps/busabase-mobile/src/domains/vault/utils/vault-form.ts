import type {
  VaultItemInput,
  VaultItemKind,
  VaultItemVO,
  VaultSettingsVO,
} from "busabase-contract/domains/vault/types";
import type { VaultRow } from "../types/vault-form";

const DRAFT_PREFIX = "draft-";

export const VAULT_KIND_OPTIONS: Array<{ value: VaultItemKind; label: string }> = [
  { value: "secret", label: "Secret" },
  { value: "variable", label: "Variable" },
];

export const SECRET_MASK = "••••••••";

export function createVaultRow(kind: VaultItemKind, id: string): VaultRow {
  return {
    id: `${DRAFT_PREFIX}${id}`,
    kind,
    key: "",
    value: "",
    description: "",
    runtimeAccess: true,
  };
}

function itemToRow(item: VaultItemVO): VaultRow {
  return {
    id: item.id,
    kind: item.kind,
    key: item.key,
    value: item.value,
    description: item.description,
    runtimeAccess: item.access.runtime,
  };
}

export function vaultSettingsToRows(settings: VaultSettingsVO): VaultRow[] {
  return settings.items.map(itemToRow);
}

function isSecretName(key: string) {
  return /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|WEBHOOK|SIGNING)/i.test(key);
}

function rowToItemInput(row: VaultRow): VaultItemInput {
  return {
    id: row.id.startsWith(DRAFT_PREFIX) ? undefined : row.id,
    kind: row.kind,
    key: row.key.trim().toUpperCase(),
    value: row.value,
    scopeType: "personal",
    scopeId: null,
    environment: "local",
    description: row.description.trim(),
    access: { runtime: row.runtimeAccess, reveal: true, edit: true, share: false },
  };
}

export function vaultRowsToItems(rows: VaultRow[]): VaultItemInput[] {
  return rows
    .map(rowToItemInput)
    .filter((item) => item.key.length > 0)
    .map((item) => ({
      ...item,
      kind: item.kind === "variable" && isSecretName(item.key) ? "secret" : item.kind,
    }));
}
