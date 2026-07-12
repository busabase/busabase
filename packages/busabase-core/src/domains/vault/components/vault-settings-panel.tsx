"use client";

import type { VaultItemKind } from "busabase-core/domains/vault/types";
import { Button } from "kui/button";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Skeleton } from "kui/skeleton";
import { Switch } from "kui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Eye, KeyRound, Loader2, Plus, Save, Trash2, Variable } from "lucide-react";
import type { ReactNode } from "react";

const VAULT_ROW_SKELETON_IDS = ["vault-row-skel-1", "vault-row-skel-2", "vault-row-skel-3"];

// Mirrors the real row shape rendered below (name + value inputs plus a
// trailing delete button) so the initial vault fetch shimmers into place
// instead of showing a spinner over an otherwise-empty dialog/tab.
function VaultRowsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {VAULT_ROW_SKELETON_IDS.map((id) => (
        <div key={id} className="rounded-md border bg-background p-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.5rem]">
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <div className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-9 w-full" />
            </div>
            <Skeleton className="h-9 w-9 shrink-0 self-end rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export interface VaultRow {
  id: string;
  kind: VaultItemKind;
  key: string;
  value: string;
  description: string;
  access: Record<string, boolean>;
}

export interface VaultSettingsPanelLabels {
  loading: () => string;
  loadFailed?: () => string;
  noSecrets: () => string;
  noVariables: () => string;
  nameLabel: () => string;
  valueLabel: () => string;
  valuePlaceholder: () => string;
  descriptionLabel: () => string;
  descriptionPlaceholder: () => string;
  secretsTab: () => string;
  variablesTab: () => string;
  addSecret: () => string;
  addVariable: () => string;
  clear: () => string;
  save: () => string;
  saving: () => string;
}

export interface VaultScopeTab {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

export interface VaultAccessFlag {
  key: string;
  label: string;
}

export interface VaultSettingsPanelProps {
  labels: VaultSettingsPanelLabels;
  variant?: "boxed" | "list";

  scopeTabs?: VaultScopeTab[];
  activeScopeTab?: string;
  onScopeTabChange?: (id: string) => void;
  scopeExtra?: ReactNode;

  accessFlags: VaultAccessFlag[];

  rows: VaultRow[];
  isLoading: boolean;
  isError: boolean;
  emptyState?: ReactNode;

  activeItemTab: "secrets" | "variables";
  onActiveItemTabChange: (tab: "secrets" | "variables") => void;

  showSecrets: boolean;

  onUpdateRow: (
    id: string,
    patch: Partial<Omit<VaultRow, "access">> & { access?: Record<string, boolean> },
  ) => void;
  onRemoveRow: (id: string) => void;
  onAddRow: () => void;
  onSave: () => void;
  onClear: () => void;
  isSaving: boolean;
  isClearing?: boolean;
  saveDisabled?: boolean;
  clearDisabled?: boolean;

  onReveal?: (itemId: string) => void;
  revealPending?: boolean;

  /** When false, the panel renders no add/save/clear footer — the caller renders its own
   * (e.g. OSS puts these buttons in a DialogFooter outside the scrollable content). */
  showFooter?: boolean;

  topSlot?: ReactNode;
  bottomSlot?: ReactNode;
  message?: ReactNode;
}

function hasRows(rows: VaultRow[], kind: VaultItemKind) {
  return rows.some(
    (row) => row.kind === kind && (row.key.trim().length > 0 || row.value.length > 0),
  );
}

export function VaultSettingsPanel({
  labels,
  variant = "boxed",
  scopeTabs,
  activeScopeTab,
  onScopeTabChange,
  scopeExtra,
  accessFlags,
  rows,
  isLoading,
  isError,
  emptyState,
  activeItemTab,
  onActiveItemTabChange,
  showSecrets,
  onUpdateRow,
  onRemoveRow,
  onAddRow,
  onSave,
  onClear,
  isSaving,
  isClearing = false,
  saveDisabled = false,
  clearDisabled = false,
  onReveal,
  revealPending = false,
  showFooter = true,
  topSlot,
  bottomSlot,
  message,
}: VaultSettingsPanelProps) {
  const isBoxed = variant === "boxed";

  const inputClassName = isBoxed
    ? "font-mono text-sm"
    : "border-border/50 bg-muted/20 shadow-none transition-colors focus-visible:bg-background font-mono text-sm";
  const descriptionInputClassName = isBoxed
    ? "text-sm"
    : "border-border/50 bg-muted/20 shadow-none transition-colors focus-visible:bg-background text-sm";

  const renderRows = (kind: VaultItemKind) => {
    if (emptyState) return emptyState;

    if (isLoading) {
      return <VaultRowsSkeleton />;
    }

    if (isError) {
      return (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-6 text-center text-sm text-destructive">
          {labels.loadFailed?.()}
        </p>
      );
    }

    const visibleRows = rows.filter((row) => row.kind === kind);

    return (
      <div
        className={
          isBoxed
            ? "space-y-3"
            : "divide-y divide-border/40 overflow-hidden rounded-lg bg-background"
        }
      >
        {!hasRows(rows, kind) ? (
          <p
            className={
              isBoxed
                ? "rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground"
                : "bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground"
            }
          >
            {kind === "secret" ? labels.noSecrets() : labels.noVariables()}
          </p>
        ) : null}
        {visibleRows.map((row) => (
          <div
            key={row.id}
            className={
              isBoxed
                ? "rounded-md border bg-background p-3"
                : "group px-3 py-3 transition-colors hover:bg-muted/20"
            }
          >
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_2.5rem]">
              <div className="space-y-1.5">
                <Label htmlFor={`vault-key-${row.id}`}>{labels.nameLabel()}</Label>
                <Input
                  id={`vault-key-${row.id}`}
                  placeholder={kind === "secret" ? "API_KEY" : "DEFAULT_MODEL"}
                  value={row.key}
                  onChange={(event) => onUpdateRow(row.id, { key: event.target.value })}
                  className={inputClassName}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`vault-value-${row.id}`}>{labels.valueLabel()}</Label>
                <div className="flex gap-2">
                  <Input
                    id={`vault-value-${row.id}`}
                    placeholder={labels.valuePlaceholder()}
                    type={kind === "secret" && !showSecrets ? "password" : "text"}
                    value={row.value}
                    onChange={(event) => onUpdateRow(row.id, { value: event.target.value })}
                    className={inputClassName}
                  />
                  {onReveal && kind === "secret" && row.id.startsWith("vault_") ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => onReveal(row.id)}
                      disabled={revealPending}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => onRemoveRow(row.id)}
                className={
                  isBoxed
                    ? "self-end"
                    : "self-end text-muted-foreground opacity-100 transition-opacity hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                }
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
            <div
              className={
                isBoxed
                  ? "mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                  : "mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]"
              }
            >
              <div className="space-y-1.5">
                <Label htmlFor={`vault-description-${row.id}`}>{labels.descriptionLabel()}</Label>
                <Input
                  id={`vault-description-${row.id}`}
                  placeholder={labels.descriptionPlaceholder()}
                  value={row.description}
                  onChange={(event) => onUpdateRow(row.id, { description: event.target.value })}
                  className={descriptionInputClassName}
                />
              </div>
              {isBoxed ? (
                <div className="flex items-end gap-2 pb-2">
                  {accessFlags.map((flag) => (
                    <div key={flag.key} className="flex items-center gap-2">
                      <Switch
                        id={`vault-${flag.key}-${row.id}`}
                        checked={Boolean(row.access[flag.key])}
                        onCheckedChange={(checked) =>
                          onUpdateRow(row.id, { access: { ...row.access, [flag.key]: checked } })
                        }
                      />
                      <Label
                        htmlFor={`vault-${flag.key}-${row.id}`}
                        className="cursor-pointer whitespace-nowrap text-xs font-normal text-muted-foreground"
                      >
                        {flag.label}
                      </Label>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-xs text-muted-foreground lg:justify-end lg:pt-6">
                  {accessFlags.map((flag) => (
                    <div key={flag.key} className="flex items-center gap-2 whitespace-nowrap">
                      <Switch
                        checked={Boolean(row.access[flag.key])}
                        onCheckedChange={(checked) =>
                          onUpdateRow(row.id, { access: { ...row.access, [flag.key]: checked } })
                        }
                      />
                      <span>{flag.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={isBoxed ? "space-y-4" : "space-y-4"}>
      {topSlot}

      {scopeTabs && scopeTabs.length > 0 ? (
        <>
          <Tabs value={activeScopeTab} onValueChange={(value) => onScopeTabChange?.(value)}>
            <TabsList className="h-auto flex-wrap bg-muted/30 p-0.5">
              {scopeTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger
                    key={tab.id}
                    value={tab.id}
                    className="gap-2 data-[state=active]:bg-background"
                  >
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
          {scopeExtra}
        </>
      ) : null}

      <div className="space-y-4">
        <Tabs
          value={activeItemTab}
          onValueChange={(value) => onActiveItemTabChange(value as "secrets" | "variables")}
        >
          <TabsList
            className={
              isBoxed ? "grid w-full grid-cols-2" : "grid h-9 w-full grid-cols-2 bg-muted/30 p-0.5"
            }
          >
            <TabsTrigger
              value="secrets"
              className={isBoxed ? undefined : "h-8 gap-2 data-[state=active]:bg-background"}
            >
              <KeyRound className="h-4 w-4" />
              {labels.secretsTab()}
            </TabsTrigger>
            <TabsTrigger
              value="variables"
              className={isBoxed ? undefined : "h-8 gap-2 data-[state=active]:bg-background"}
            >
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

        {bottomSlot}

        {message}

        {showFooter ? (
          <div className="flex flex-col gap-2 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="ghost" onClick={onAddRow}>
              <Plus className="h-4 w-4" />
              {activeItemTab === "secrets" ? labels.addSecret() : labels.addVariable()}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClear} disabled={isClearing || clearDisabled}>
                {labels.clear()}
              </Button>
              <Button onClick={onSave} disabled={isSaving || saveDisabled}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? labels.saving() : labels.save()}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
