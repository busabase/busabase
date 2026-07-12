"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  VaultItemKind,
  VaultItemVO,
  VaultSettingsVO,
} from "busabase-contract/domains/vault/types";
import { VaultSettingsPanel } from "busabase-core/domains/vault/components";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { DialogFooter } from "kui/dialog";
import { Eye, EyeOff, Loader2, LockKeyhole, Plus, Save, ShieldCheck, Variable } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

export type VaultSettingsLabels = TranslationFunctions["vaultSettings"];

interface Props {
  labels: VaultSettingsLabels;
  /** Whether this tab is the active one — gates the underlying query. */
  active: boolean;
}

type VaultTab = "secrets" | "variables";

interface VaultRow {
  id: string;
  kind: VaultItemKind;
  key: string;
  value: string;
  description: string;
  access: { runtime: boolean };
}

const isSecretName = (key: string) =>
  /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|WEBHOOK|SIGNING)/i.test(key);

const makeRow = (kind: VaultItemKind, key = "", value = ""): VaultRow => ({
  id: `vault-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  kind,
  key,
  value,
  description: "",
  access: { runtime: true },
});

const rowToItem = (row: VaultRow) => ({
  id: row.id.startsWith("vault_") ? row.id : undefined,
  kind: row.kind,
  key: row.key.trim().toUpperCase(),
  value: row.value,
  scopeType: "personal" as const,
  scopeId: null,
  environment: "local" as const,
  description: row.description.trim(),
  access: { runtime: row.access.runtime },
});

function rowsToItems(rows: VaultRow[]) {
  return rows
    .map(rowToItem)
    .filter((item) => item.key.length > 0)
    .map((item) => ({
      ...item,
      kind: item.kind === "variable" && isSecretName(item.key) ? "secret" : item.kind,
    }));
}

function itemToRow(item: VaultItemVO): VaultRow {
  return {
    id: item.id,
    kind: item.kind,
    key: item.key,
    value: item.value,
    description: item.description,
    access: { runtime: item.access.runtime },
  };
}

function settingsToRows(settings: VaultSettingsVO) {
  const rows = settings.items.map(itemToRow);
  return rows.length ? rows : [makeRow("secret"), makeRow("variable")];
}

export function VaultSettingsTab({ labels, active }: Props) {
  const [activeTab, setActiveTab] = useState<VaultTab>("secrets");
  const [rows, setRows] = useState<VaultRow[]>([makeRow("secret"), makeRow("variable")]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const vaultQueryOptions = useMemo(() => orpc.vault.get.queryOptions({}), [orpc]);
  const vaultQuery = useQuery({
    ...vaultQueryOptions,
    enabled: active,
  });

  useEffect(() => {
    if (vaultQuery.data) {
      setRows(settingsToRows(vaultQuery.data));
    }
  }, [vaultQuery.data]);

  const saveMutation = useMutation({
    ...orpc.vault.update.mutationOptions(),
    onSuccess: (data) => {
      queryClient.setQueryData(vaultQueryOptions.queryKey, data);
      setRows(settingsToRows(data));
      setMessage(labels.saved());
    },
    onError: () => setMessage(labels.saveFailed()),
  });

  const updateRow = (
    id: string,
    patch: Partial<Omit<VaultRow, "access">> & { access?: Record<string, boolean> },
  ) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              ...patch,
              access: patch.access ? { runtime: Boolean(patch.access.runtime) } : row.access,
            }
          : row,
      ),
    );
  };

  const removeRow = (id: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== id);
      return nextRows.length
        ? nextRows
        : [makeRow(activeTab === "secrets" ? "secret" : "variable")];
    });
  };

  const addRow = () => {
    setRows((current) => [...current, makeRow(activeTab === "secrets" ? "secret" : "variable")]);
  };

  const save = () => {
    saveMutation.mutate({ items: rowsToItems(rows) });
  };

  const clear = () => {
    const emptyRows = [makeRow("secret"), makeRow("variable")];
    setRows(emptyRows);
    saveMutation.mutate({ items: [] });
    setMessage(labels.cleared());
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
        <VaultSettingsPanel
          variant="boxed"
          labels={labels}
          accessFlags={[{ key: "runtime", label: labels.runtimeAccess() }]}
          rows={rows}
          isLoading={vaultQuery.isPending}
          isError={vaultQuery.isError}
          activeItemTab={activeTab}
          onActiveItemTabChange={setActiveTab}
          showSecrets={showSecrets}
          onUpdateRow={updateRow}
          onRemoveRow={removeRow}
          onAddRow={addRow}
          onSave={save}
          onClear={clear}
          isSaving={saveMutation.isPending}
          isClearing={saveMutation.isPending}
          showFooter={false}
          topSlot={
            <>
              <Alert>
                <ShieldCheck className="h-4 w-4" />
                <AlertTitle>{labels.accessTitle()}</AlertTitle>
                <AlertDescription>{labels.accessDescription()}</AlertDescription>
              </Alert>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex gap-2">
                  <Badge variant="outline">
                    <LockKeyhole className="mr-1 h-3 w-3" />
                    {labels.secretsBadge()}
                  </Badge>
                  <Badge variant="outline">
                    <Variable className="mr-1 h-3 w-3" />
                    {labels.variablesBadge()}
                  </Badge>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={() => setShowSecrets((value) => !value)}
                >
                  {showSecrets ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showSecrets ? labels.hide() : labels.reveal()}
                </Button>
              </div>
            </>
          }
          bottomSlot={
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">{labels.storageTitle()}</div>
              <div>{labels.storageDescription()}</div>
            </div>
          }
          message={message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        />
      </div>

      <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
        <Button variant="outline" type="button" onClick={addRow}>
          <Plus className="h-4 w-4" />
          {activeTab === "secrets" ? labels.addSecret() : labels.addVariable()}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" type="button" onClick={clear} disabled={saveMutation.isPending}>
            {labels.clear()}
          </Button>
          <Button type="button" onClick={save} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saveMutation.isPending ? labels.saving() : labels.save()}
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}
