"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  VaultItemKind,
  VaultItemVO,
  VaultSettingsVO,
} from "busabase-contract/domains/vault/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Switch } from "kui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Variable,
  Vault,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

interface Props {
  labels: VaultSettingsLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export type VaultSettingsLabels = TranslationFunctions["vaultSettings"];

type VaultTab = "secrets" | "variables";

interface VaultRow {
  id: string;
  kind: VaultItemKind;
  key: string;
  value: string;
  description: string;
  runtimeAccess: boolean;
}

const isSecretName = (key: string) =>
  /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL|WEBHOOK|SIGNING)/i.test(key);

const makeRow = (kind: VaultItemKind, key = "", value = ""): VaultRow => ({
  id: `vault-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  kind,
  key,
  value,
  description: "",
  runtimeAccess: true,
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
  access: { runtime: row.runtimeAccess },
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
    runtimeAccess: item.access.runtime,
  };
}

function settingsToRows(settings: VaultSettingsVO) {
  const rows = settings.items.map(itemToRow);
  return rows.length ? rows : [makeRow("secret"), makeRow("variable")];
}

function hasRows(rows: VaultRow[], kind: VaultItemKind) {
  return rows.some(
    (row) => row.kind === kind && (row.key.trim().length > 0 || row.value.length > 0),
  );
}

export function VaultSettingsDialog({
  labels,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [activeTab, setActiveTab] = useState<VaultTab>("secrets");
  const [rows, setRows] = useState<VaultRow[]>([makeRow("secret"), makeRow("variable")]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const vaultQueryOptions = useMemo(() => orpc.vault.get.queryOptions({}), [orpc]);
  const vaultQuery = useQuery({
    ...vaultQueryOptions,
    enabled: open,
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

  const updateRow = (id: string, patch: Partial<VaultRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== id);
      return nextRows.length
        ? nextRows
        : [makeRow(activeTab === "secrets" ? "secret" : "variable")];
    });
  };

  const addRow = (kind: VaultItemKind) => {
    setRows((current) => [...current, makeRow(kind)]);
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

  const renderRows = (kind: VaultItemKind) => {
    const visibleRows = rows.filter((row) => row.kind === kind);
    if (vaultQuery.isPending) {
      return (
        <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {labels.loading()}
        </div>
      );
    }

    if (vaultQuery.isError) {
      return (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-6 text-center text-sm text-destructive">
          {labels.loadFailed()}
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {!hasRows(rows, kind) ? (
          <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
            {kind === "secret" ? labels.noSecrets() : labels.noVariables()}
          </p>
        ) : null}
        {visibleRows.map((row) => (
          <div key={row.id} className="rounded-md border bg-background p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.5rem]">
              <div className="space-y-1.5">
                <Label htmlFor={`vault-key-${row.id}`}>{labels.nameLabel()}</Label>
                <Input
                  id={`vault-key-${row.id}`}
                  placeholder={kind === "secret" ? "OPENAI_API_KEY" : "DEFAULT_MODEL"}
                  value={row.key}
                  onChange={(event) => updateRow(row.id, { key: event.target.value })}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`vault-value-${row.id}`}>{labels.valueLabel()}</Label>
                <Input
                  id={`vault-value-${row.id}`}
                  placeholder={labels.valuePlaceholder()}
                  type={kind === "secret" && !showSecrets ? "password" : "text"}
                  value={row.value}
                  onChange={(event) => updateRow(row.id, { value: event.target.value })}
                  className="font-mono text-sm"
                />
              </div>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => removeRow(row.id)}
                className="self-end"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`vault-description-${row.id}`}>{labels.descriptionLabel()}</Label>
                <Input
                  id={`vault-description-${row.id}`}
                  placeholder={labels.descriptionPlaceholder()}
                  value={row.description}
                  onChange={(event) => updateRow(row.id, { description: event.target.value })}
                  className="text-sm"
                />
              </div>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  id={`vault-runtime-${row.id}`}
                  checked={row.runtimeAccess}
                  onCheckedChange={(checked) => updateRow(row.id, { runtimeAccess: checked })}
                />
                <Label
                  htmlFor={`vault-runtime-${row.id}`}
                  className="cursor-pointer whitespace-nowrap text-xs font-normal text-muted-foreground"
                >
                  {labels.runtimeAccess()}
                </Label>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      {showTrigger ? (
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="mx-2 w-[calc(100%-1rem)]"
              onClick={() => setOpen(true)}
              tooltip={labels.openButton()}
            >
              <Vault />
              <span>{labels.openButton()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Vault className="h-5 w-5" />
              {labels.title()}
            </DialogTitle>
            <DialogDescription>{labels.description()}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
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

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as VaultTab)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="secrets">
                  <KeyRound className="h-4 w-4" />
                  {labels.secretsTab()}
                </TabsTrigger>
                <TabsTrigger value="variables">
                  <Variable className="h-4 w-4" />
                  {labels.variablesTab()}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="secrets" className="mt-4">
                {renderRows("secret")}
              </TabsContent>
              <TabsContent value="variables" className="mt-4">
                {renderRows("variable")}
              </TabsContent>
            </Tabs>

            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">{labels.storageTitle()}</div>
              <div>{labels.storageDescription()}</div>
            </div>

            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            <Button
              variant="outline"
              type="button"
              onClick={() => addRow(activeTab === "secrets" ? "secret" : "variable")}
            >
              <Plus className="h-4 w-4" />
              {activeTab === "secrets" ? labels.addSecret() : labels.addVariable()}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={clear}
                disabled={saveMutation.isPending}
              >
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
        </DialogContent>
      </Dialog>
    </>
  );
}
