"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserEnvVO } from "busabase-core/domains/user-env/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
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
import { Eye, EyeOff, Loader2, Plus, Save, Shield, Trash2, Variable } from "lucide-react";
import { useEffect, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

interface Props {
  labels: UserEnvSettingsLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export type UserEnvSettingsLabels = TranslationFunctions["userEnvSettings"];

interface EnvRow {
  id: string;
  key: string;
  value: string;
}

const queryKey = ["busabase-user-env-vars"] as const;

const isSecretName = (key: string) =>
  /(SECRET|TOKEN|KEY|PASSWORD|PASS|PRIVATE|CREDENTIAL)/i.test(key);

const makeRow = (key = "", value = ""): EnvRow => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  key,
  value,
});

function rowsToEnv(rows: EnvRow[]) {
  return Object.fromEntries(
    rows
      .map((row) => [row.key.trim().toUpperCase(), row.value] as const)
      .filter(([key]) => key.length > 0),
  );
}

function hasConfiguredRows(rows: EnvRow[]) {
  return rows.some((row) => row.key.trim().length > 0 || row.value.length > 0);
}

function envToRows(env: Record<string, string>) {
  const rows = Object.entries(env).map(([key, value]) => makeRow(key, value));
  return rows.length ? rows : [makeRow()];
}

async function fetchUserEnvConfig(): Promise<UserEnvVO> {
  const response = await fetch("/api/user-env/env-vars", { cache: "no-store" });
  if (!response.ok) throw new Error("load_failed");
  return response.json();
}

async function saveUserEnvConfig(env: Record<string, string>): Promise<UserEnvVO> {
  const response = await fetch("/api/user-env/env-vars", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ env }),
  });
  if (!response.ok) throw new Error("save_failed");
  return response.json();
}

export function UserEnvSettingsDialog({
  labels,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [rows, setRows] = useState<EnvRow[]>([makeRow()]);
  const [showSecrets, setShowSecrets] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const envQuery = useQuery({
    queryKey,
    queryFn: fetchUserEnvConfig,
    enabled: open,
  });

  useEffect(() => {
    if (envQuery.data) {
      setRows(envToRows(envQuery.data.env));
    }
  }, [envQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveUserEnvConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data);
      setRows(envToRows(data.env));
      setMessage(labels.saved());
    },
    onError: () => setMessage(labels.saveFailed()),
  });

  const updateRow = (id: string, patch: Partial<EnvRow>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const removeRow = (id: string) => {
    setRows((current) => {
      const nextRows = current.filter((row) => row.id !== id);
      return nextRows.length ? nextRows : [makeRow()];
    });
  };

  const save = () => {
    saveMutation.mutate(rowsToEnv(rows));
  };

  const clear = () => {
    setRows([makeRow()]);
    saveMutation.mutate({});
    setMessage(labels.cleared());
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
              <Variable />
              <span>{labels.openButton()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Variable className="h-5 w-5" />
              {labels.title()}
            </DialogTitle>
            <DialogDescription>{labels.description()}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            <Alert>
              <Shield className="h-4 w-4" />
              <AlertTitle>{labels.requestScopeTitle()}</AlertTitle>
              <AlertDescription>{labels.requestScopeDescription()}</AlertDescription>
            </Alert>

            <div className="flex justify-end">
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

            {envQuery.isPending ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {labels.loading()}
              </div>
            ) : envQuery.isError ? (
              <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-6 text-center text-sm text-destructive">
                {labels.loadFailed()}
              </p>
            ) : (
              <div className="space-y-3">
                {!hasConfiguredRows(rows) ? (
                  <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
                    {labels.noVariables()}
                  </p>
                ) : null}
                {rows.map((row) => (
                  <div
                    key={row.id}
                    className="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_2.5rem]"
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor={`env-key-${row.id}`}>{labels.nameLabel()}</Label>
                      <Input
                        id={`env-key-${row.id}`}
                        placeholder="OPENAI_API_KEY"
                        value={row.key}
                        onChange={(event) => updateRow(row.id, { key: event.target.value })}
                        className="font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`env-value-${row.id}`}>{labels.valueLabel()}</Label>
                      <Input
                        id={`env-value-${row.id}`}
                        placeholder={labels.valuePlaceholder()}
                        type={!showSecrets && isSecretName(row.key) ? "password" : "text"}
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
                ))}
              </div>
            )}

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
              onClick={() => setRows((current) => [...current, makeRow()])}
            >
              <Plus className="h-4 w-4" />
              {labels.addVariable()}
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
