"use client";

import type {
  AirAppSiteDirectValueInput,
  AirAppSiteDirectValueVO,
} from "busabase-contract/domains/airapp/contract";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "kui/alert-dialog";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";

export type DirectValueDraft = AirAppSiteDirectValueInput & {
  rowId: string;
  hasValue?: boolean;
  status?: AirAppSiteDirectValueVO["status"];
  savedKind?: AirAppSiteDirectValueVO["kind"];
};

export function AirAppSiteDirectValues({
  rows,
  stored,
  unbound = [],
  id,
  onChange,
}: {
  rows: DirectValueDraft[];
  stored: AirAppSiteDirectValueVO[];
  unbound?: AirAppSiteDirectValueVO[];
  id: string;
  onChange: (rows: DirectValueDraft[]) => void;
}) {
  const copy = useCoreI18n().airapp.site.environment;
  const [removing, setRemoving] = useState<DirectValueDraft | null>(null);
  return (
    <>
      {rows.map((row) => {
        const saved = stored.find((value) => value.vaultItemId === row.vaultItemId);
        const source = saved ?? unbound.find((value) => value.vaultItemId === row.vaultItemId);
        const status = source?.status ?? row.status;
        const hasValue = source?.hasValue ?? row.hasValue;
        const secretTypeLocked = (source?.kind ?? row.savedKind) === "secret";
        const rowId = `${id}-${row.rowId}`;
        const update = (patch: Partial<DirectValueDraft>) =>
          onChange(
            rows.map((value) => (value.rowId === row.rowId ? { ...value, ...patch } : value)),
          );
        return (
          <div
            className="min-w-0 space-y-2 rounded-md border border-border p-2"
            data-airapp-site-direct-row=""
            key={row.rowId}
          >
            <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="min-w-0 space-y-1">
                <Label className="text-xs" htmlFor={`${rowId}-name`}>
                  {copy.name}
                </Label>
                <Input
                  autoComplete="off"
                  className="min-w-0 font-mono text-xs"
                  data-airapp-site-direct-name=""
                  id={`${rowId}-name`}
                  maxLength={128}
                  onChange={(event) => update({ envName: event.target.value })}
                  placeholder="API_TOKEN"
                  spellCheck={false}
                  value={row.envName}
                />
              </div>
              <div className="min-w-0 space-y-1">
                <Label className="text-xs" htmlFor={`${rowId}-kind`}>
                  {copy.kind}
                </Label>
                <select
                  className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  data-airapp-site-direct-kind=""
                  id={`${rowId}-kind`}
                  onChange={(event) =>
                    update({ kind: event.target.value === "variable" ? "variable" : "secret" })
                  }
                  value={row.kind}
                >
                  <option value="secret">{copy.secret}</option>
                  <option disabled={secretTypeLocked} value="variable">
                    {copy.variable}
                  </option>
                </select>
                {secretTypeLocked ? (
                  <p className="text-muted-foreground text-xs">{copy.secretTypeLocked}</p>
                ) : null}
              </div>
              <Button
                aria-label={copy.removeVariable}
                className="justify-self-end"
                data-airapp-site-direct-remove=""
                onClick={() =>
                  saved
                    ? setRemoving(row)
                    : onChange(rows.filter((value) => value.rowId !== row.rowId))
                }
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </Button>
            </div>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs" htmlFor={`${rowId}-value`}>
                  {copy.value}
                </Label>
                {row.value === "" ? (
                  <span className="text-muted-foreground text-xs" data-airapp-site-direct-empty="">
                    {copy.valueCleared}
                  </span>
                ) : row.vaultItemId && row.value === undefined && status === "ready" ? (
                  <span className="text-muted-foreground text-xs" data-airapp-site-direct-saved="">
                    {hasValue ? copy.valueSaved : copy.valueSavedEmpty}
                  </span>
                ) : null}
              </div>
              <div className="flex min-w-0 gap-2">
                <Input
                  autoComplete={row.kind === "secret" ? "new-password" : "off"}
                  className="min-w-0 flex-1 font-mono text-xs"
                  data-airapp-site-direct-value=""
                  id={`${rowId}-value`}
                  maxLength={8192}
                  onChange={(event) =>
                    update({
                      value:
                        event.target.value === "" && row.vaultItemId
                          ? undefined
                          : event.target.value,
                    })
                  }
                  placeholder={row.vaultItemId ? copy.valuePlaceholder : copy.newValuePlaceholder}
                  spellCheck={false}
                  type={row.kind === "secret" ? "password" : "text"}
                  value={row.value ?? ""}
                />
                <Button
                  className="shrink-0"
                  data-airapp-site-direct-clear=""
                  onClick={() => update({ value: "" })}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {copy.clearValue}
                </Button>
              </div>
            </div>
            {status === "missing" ? (
              <p className="text-destructive text-xs" role="alert">
                {copy.directMissing}
              </p>
            ) : status === "runtime-disabled" ? (
              <p className="text-destructive text-xs" role="alert">
                {copy.directRuntimeDisabled}
              </p>
            ) : null}
          </div>
        );
      })}
      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.directRemovalTitle}</AlertDialogTitle>
            <AlertDialogDescription>{copy.directRemovalDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="break-all font-mono text-sm">{removing?.envName}</p>
          <AlertDialogFooter>
            <Button onClick={() => setRemoving(null)} type="button" variant="outline">
              {copy.cancel}
            </Button>
            <Button
              data-airapp-site-direct-confirm-remove=""
              onClick={() => {
                onChange(rows.filter((value) => value.rowId !== removing?.rowId));
                setRemoving(null);
              }}
              type="button"
              variant="destructive"
            >
              {copy.confirmRemove}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
