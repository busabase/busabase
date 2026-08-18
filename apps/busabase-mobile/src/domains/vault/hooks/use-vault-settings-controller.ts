import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { VaultItemInput, VaultItemKind } from "busabase-contract/domains/vault/types";
import { useEffect, useRef, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import type { VaultDraft, VaultRow } from "../types/vault-form";
import { createVaultRow, vaultRowsToItems, vaultSettingsToRows } from "../utils/vault-form";

export function useVaultSettingsController() {
  const busabase = useBusabaseOrpc();
  const draftSequence = useRef(0);
  const [rows, setRows] = useState<VaultRow[]>([]);
  const [savedItems, setSavedItems] = useState<VaultItemInput[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [draft, setDraft] = useState<VaultDraft | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const vaultQuery = useQuery(
    busabase
      ? busabase.orpc.vault.get.queryOptions()
      : { queryKey: ["no-connection", "vault"], queryFn: skipToken },
  );

  useEffect(() => {
    if (vaultQuery.data && !hydrated) {
      const nextRows = vaultSettingsToRows(vaultQuery.data);
      setRows(nextRows);
      setSavedItems(vaultRowsToItems(nextRows));
      setHydrated(true);
    }
  }, [vaultQuery.data, hydrated]);

  const updateMutation = useMutation({
    mutationFn: async (items: VaultItemInput[]) => {
      if (!busabase) throw new Error("Not connected");
      return busabase.client.vault.update({ items });
    },
    onSuccess: (data) => {
      const nextRows = vaultSettingsToRows(data);
      setRows(nextRows);
      setSavedItems(vaultRowsToItems(nextRows));
    },
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      if (!busabase) throw new Error("Not connected");
      return busabase.client.vault.clear();
    },
    onSuccess: () => {
      setRows([]);
      setSavedItems([]);
      setClearConfirmOpen(false);
    },
  });

  const openCreate = (kind: VaultItemKind) => {
    draftSequence.current += 1;
    setDraft({
      row: createVaultRow(kind, `${Date.now()}-${draftSequence.current}`),
      isNew: true,
    });
  };
  const openEdit = (row: VaultRow) => setDraft({ row, isNew: false });
  const closeDraft = () => setDraft(null);
  const updateDraftRow = (patch: Partial<VaultRow>) =>
    setDraft((current) => (current ? { ...current, row: { ...current.row, ...patch } } : current));

  const commitDraft = () => {
    if (!draft?.row.key.trim()) return;
    setRows((current) => {
      const exists = current.some((row) => row.id === draft.row.id);
      return exists
        ? current.map((row) => (row.id === draft.row.id ? draft.row : row))
        : [...current, draft.row];
    });
    closeDraft();
  };

  const removeDraft = () => {
    if (!draft) return;
    setRows((current) => current.filter((row) => row.id !== draft.row.id));
    closeDraft();
  };

  const secrets = rows.filter((row) => row.kind === "secret");
  const variables = rows.filter((row) => row.kind === "variable");
  const hasChanges = JSON.stringify(vaultRowsToItems(rows)) !== JSON.stringify(savedItems);

  return {
    clearConfirmOpen,
    clearMutation,
    closeDraft,
    commitDraft,
    draft,
    hasChanges,
    openCreate,
    openEdit,
    removeDraft,
    rows,
    save: () => updateMutation.mutate(vaultRowsToItems(rows)),
    secrets,
    setClearConfirmOpen,
    setShowSecrets,
    showSecrets,
    updateDraftRow,
    updateMutation,
    variables,
    vaultQuery,
  };
}

export type VaultSettingsController = ReturnType<typeof useVaultSettingsController>;
