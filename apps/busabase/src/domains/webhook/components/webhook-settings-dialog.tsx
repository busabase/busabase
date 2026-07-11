"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createBusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { BaseVO } from "busabase-contract/domains/base/types";
import type {
  WebhookActionKind,
  WebhookDeliveryStatus,
  WebhookDeliveryVO,
  WebhookEventType,
  WebhookHttpConfig,
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "busabase-contract/domains/webhook/types";
import { ConfirmActionDialog } from "busabase-core/dashboard/primitives";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "kui/select";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "kui/sidebar";
import { Switch } from "kui/switch";
import { Textarea } from "kui/textarea";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  Webhook as WebhookIcon,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { TranslationFunctions } from "~/i18n/i18n-types";

interface Props {
  labels: WebhookSettingsLabels;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

export type WebhookSettingsLabels = TranslationFunctions["webhookSettings"];

// Sentinel used for the "All bases" select option — Radix `Select.Item` can't
// take an empty-string value, and the wire representation of "space-wide" is
// `baseId: null`.
const ALL_BASES_VALUE = "__all__";

interface FormState {
  id: string | null;
  name: string;
  eventType: WebhookEventType;
  baseId: string;
  actionKind: WebhookActionKind;
  targetUrl: string;
  secret: string;
  hasSecret: boolean;
  code: string;
  timeoutMs: number;
  enabled: boolean;
}

const emptyForm = (): FormState => ({
  id: null,
  name: "",
  eventType: "record.created",
  baseId: ALL_BASES_VALUE,
  actionKind: "webhook",
  targetUrl: "",
  secret: "",
  hasSecret: false,
  code: "",
  timeoutMs: 2000,
  enabled: true,
});

const ruleToForm = (rule: WebhookRuleVO): FormState => ({
  id: rule.id,
  name: rule.name,
  eventType: rule.eventType,
  baseId: rule.baseId ?? ALL_BASES_VALUE,
  actionKind: rule.actionKind,
  targetUrl: rule.actionKind === "run_snippet" ? "" : rule.config.targetUrl,
  secret: "",
  hasSecret: rule.actionKind === "run_snippet" ? false : rule.config.hasSecret,
  code: rule.actionKind === "run_snippet" ? rule.config.code : "",
  timeoutMs: rule.actionKind === "run_snippet" ? rule.config.timeoutMs : 2000,
  enabled: rule.enabled,
});

const buildHttpConfig = (form: FormState): WebhookHttpConfig => ({
  targetUrl: form.targetUrl.trim(),
  // Only send a new secret when the user actually typed one — blank means
  // "leave the currently stored (encrypted) secret unchanged" (enforced by
  // buildHttpConfigPO in busabase-core's webhook logic).
  ...(form.secret.trim() ? { secret: form.secret.trim() } : {}),
});

function buildCreateInput(form: FormState): WebhookRuleInput {
  const common = {
    name: form.name.trim(),
    eventType: form.eventType,
    baseId: form.baseId === ALL_BASES_VALUE ? null : form.baseId,
    enabled: form.enabled,
  };
  switch (form.actionKind) {
    case "run_snippet":
      return {
        ...common,
        actionKind: "run_snippet",
        config: { code: form.code, timeoutMs: form.timeoutMs },
      };
    case "webhook":
      return { ...common, actionKind: "webhook", config: buildHttpConfig(form) };
    case "notify_agent":
      return { ...common, actionKind: "notify_agent", config: buildHttpConfig(form) };
  }
}

function buildUpdateInput(form: FormState, id: string): WebhookRuleUpdateInput {
  const common = {
    id,
    name: form.name.trim(),
    eventType: form.eventType,
    baseId: form.baseId === ALL_BASES_VALUE ? null : form.baseId,
    enabled: form.enabled,
  };
  switch (form.actionKind) {
    case "run_snippet":
      return {
        ...common,
        actionKind: "run_snippet",
        config: { code: form.code, timeoutMs: form.timeoutMs },
      };
    case "webhook":
      return { ...common, actionKind: "webhook", config: buildHttpConfig(form) };
    case "notify_agent":
      return { ...common, actionKind: "notify_agent", config: buildHttpConfig(form) };
  }
}

function eventTypeLabel(eventType: WebhookEventType, labels: WebhookSettingsLabels) {
  switch (eventType) {
    case "record.created":
      return labels.eventTypeRecordCreated();
    case "ai_mention":
      return labels.eventTypeAiMention();
    case "changes_requested":
      return labels.eventTypeChangesRequested();
  }
}

function actionKindLabel(actionKind: WebhookActionKind, labels: WebhookSettingsLabels) {
  switch (actionKind) {
    case "webhook":
      return labels.actionKindWebhook();
    case "notify_agent":
      return labels.actionKindNotifyAgent();
    case "run_snippet":
      return labels.actionKindRunSnippet();
  }
}

function statusBadge(status: WebhookDeliveryStatus | null, labels: WebhookSettingsLabels) {
  if (status === "success") {
    return <Badge>{labels.statusSuccess()}</Badge>;
  }
  if (status === "failed") {
    return <Badge variant="destructive">{labels.statusFailed()}</Badge>;
  }
  if (status === "skipped") {
    return <Badge variant="secondary">{labels.statusSkipped()}</Badge>;
  }
  return <Badge variant="outline">{labels.statusNeverRun()}</Badge>;
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(diffSec) < 60) {
    return rtf.format(-diffSec, "second");
  }
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) {
    return rtf.format(-diffMin, "minute");
  }
  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) {
    return rtf.format(-diffHour, "hour");
  }
  const diffDay = Math.round(diffHour / 24);
  return rtf.format(-diffDay, "day");
}

export function WebhookSettingsDialog({
  labels,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WebhookRuleVO | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const orpc = useMemo(() => createBusabaseQueryUtils("/api/rpc"), []);
  const rulesQueryOptions = useMemo(() => orpc.webhooks.list.queryOptions({}), [orpc]);
  const rulesQuery = useQuery({ ...rulesQueryOptions, enabled: open });
  const basesQuery = useQuery({ ...orpc.bases.list.queryOptions({}), enabled: open });
  const deliveriesQuery = useQuery({
    ...orpc.webhooks.deliveries.queryOptions({
      input: { ruleId: expandedRuleId ?? "", limit: 10 },
    }),
    enabled: Boolean(expandedRuleId),
  });

  const invalidateRules = () =>
    queryClient.invalidateQueries({ queryKey: rulesQueryOptions.queryKey });

  const closeForm = () => {
    setFormOpen(false);
    setForm(emptyForm());
  };

  const openCreateForm = () => {
    setForm(emptyForm());
    setFormOpen(true);
  };

  const openEditForm = (rule: WebhookRuleVO) => {
    setForm(ruleToForm(rule));
    setFormOpen(true);
  };

  const createMutation = useMutation({
    ...orpc.webhooks.create.mutationOptions(),
    onSuccess: () => {
      invalidateRules();
      closeForm();
      setMessage(labels.saved());
    },
    onError: () => setMessage(labels.saveFailed()),
  });

  const updateMutation = useMutation({
    ...orpc.webhooks.update.mutationOptions(),
    onSuccess: () => {
      invalidateRules();
      closeForm();
      setMessage(labels.saved());
    },
    onError: () => setMessage(labels.saveFailed()),
  });

  const toggleMutation = useMutation({
    ...orpc.webhooks.update.mutationOptions(),
    onSuccess: () => invalidateRules(),
    onError: () => setMessage(labels.saveFailed()),
  });

  const deleteMutation = useMutation({
    ...orpc.webhooks.delete.mutationOptions(),
    onSuccess: () => {
      invalidateRules();
      setConfirmDelete(null);
    },
    onError: () => setMessage(labels.deleteFailed()),
  });

  const testFireMutation = useMutation({
    ...orpc.webhooks.testFire.mutationOptions(),
    onSuccess: (delivery, variables) => {
      // Auto-expand this rule's deliveries panel so the fresh delivery is
      // visible, and refetch both that panel and the rules list — testFire
      // also updates the rule's own lastTriggeredAt/lastStatus.
      setExpandedRuleId(variables.id);
      queryClient.invalidateQueries({
        queryKey: orpc.webhooks.deliveries.queryOptions({
          input: { ruleId: variables.id, limit: 10 },
        }).queryKey,
      });
      invalidateRules();
      setMessage(
        delivery.status === "success" ? labels.testFireSuccess() : labels.testFireDeliveryFailed(),
      );
    },
    onError: () => setMessage(labels.testFireRequestFailed()),
  });

  const save = () => {
    if (form.id) {
      updateMutation.mutate(buildUpdateInput(form, form.id));
    } else {
      createMutation.mutate(buildCreateInput(form));
    }
  };

  const toggleEnabled = (rule: WebhookRuleVO) => {
    const nextForm = { ...ruleToForm(rule), enabled: !rule.enabled };
    toggleMutation.mutate(buildUpdateInput(nextForm, rule.id));
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  const renderDeliveries = (ruleId: string) => {
    if (deliveriesQuery.isPending) {
      return (
        <div className="flex min-h-16 items-center justify-center text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          {labels.deliveriesLoading()}
        </div>
      );
    }
    if (deliveriesQuery.isError) {
      return (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-4 text-center text-xs text-destructive">
          {labels.deliveriesLoadFailed()}
        </p>
      );
    }
    const deliveries: WebhookDeliveryVO[] = deliveriesQuery.data ?? [];
    if (!deliveries.length) {
      return (
        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-4 text-center text-xs text-muted-foreground">
          {labels.noDeliveries()}
        </p>
      );
    }
    return (
      <div className="space-y-2">
        {deliveries.map((delivery) => (
          <div key={delivery.id} className="rounded-md border bg-muted/10 p-2">
            <div className="flex flex-wrap items-center gap-2">
              {statusBadge(delivery.status, labels)}
              {delivery.httpStatus !== null ? (
                <span className="font-mono text-xs text-muted-foreground">
                  {delivery.httpStatus}
                </span>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                {formatRelativeTime(delivery.createdAt)}
              </span>
            </div>
            {delivery.detail ? (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{delivery.detail}</p>
            ) : null}
          </div>
        ))}
      </div>
    );
  };

  const renderRuleRow = (rule: WebhookRuleVO) => {
    const expanded = expandedRuleId === rule.id;
    return (
      <div key={rule.id} className="rounded-md border bg-background p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{rule.name}</span>
            <Badge variant="outline">{eventTypeLabel(rule.eventType, labels)}</Badge>
            <Badge variant="secondary">{actionKindLabel(rule.actionKind, labels)}</Badge>
            {statusBadge(rule.lastStatus, labels)}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Switch
              checked={rule.enabled}
              onCheckedChange={() => toggleEnabled(rule)}
              disabled={toggleMutation.isPending}
              aria-label={labels.enabledLabel()}
            />
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={labels.testNowAction()}
              disabled={testFireMutation.isPending}
              onClick={() => testFireMutation.mutate({ id: rule.id })}
            >
              {testFireMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={expanded ? labels.hideLogAction() : labels.viewLogAction()}
              onClick={() => setExpandedRuleId(expanded ? null : rule.id)}
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={labels.editRuleAction()}
              onClick={() => openEditForm(rule)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              type="button"
              aria-label={labels.deleteRuleAction()}
              onClick={() => setConfirmDelete(rule)}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
        {expanded ? <div className="mt-3 border-t pt-3">{renderDeliveries(rule.id)}</div> : null}
      </div>
    );
  };

  const renderList = () => {
    if (rulesQuery.isPending) {
      return (
        <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {labels.rulesLoading()}
        </div>
      );
    }
    if (rulesQuery.isError) {
      return (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-6 text-center text-sm text-destructive">
          {labels.rulesLoadFailed()}
        </p>
      );
    }
    const rules = rulesQuery.data ?? [];
    if (!rules.length) {
      return (
        <p className="rounded-md border border-dashed bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
          {labels.noRules()}
        </p>
      );
    }
    return <div className="space-y-3">{rules.map(renderRuleRow)}</div>;
  };

  const bases: BaseVO[] = basesQuery.data ?? [];

  const renderForm = () => (
    <div className="space-y-4 rounded-md border bg-background p-3">
      <div className="space-y-1.5">
        <Label htmlFor="webhook-name">{labels.nameLabel()}</Label>
        <Input
          id="webhook-name"
          placeholder={labels.namePlaceholder()}
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="webhook-event-type">{labels.eventTypeLabel()}</Label>
          <Select
            value={form.eventType}
            onValueChange={(value) =>
              setForm((current) => ({ ...current, eventType: value as WebhookEventType }))
            }
          >
            <SelectTrigger id="webhook-event-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="record.created">{labels.eventTypeRecordCreated()}</SelectItem>
              <SelectItem value="ai_mention">{labels.eventTypeAiMention()}</SelectItem>
              <SelectItem value="changes_requested">
                {labels.eventTypeChangesRequested()}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="webhook-base-scope">{labels.baseScopeLabel()}</Label>
          <Select
            value={form.baseId}
            onValueChange={(value) => setForm((current) => ({ ...current, baseId: value }))}
          >
            <SelectTrigger id="webhook-base-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BASES_VALUE}>{labels.baseScopeAll()}</SelectItem>
              {bases.map((base) => (
                <SelectItem key={base.id} value={base.id}>
                  {base.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="webhook-action-kind">{labels.actionKindLabel()}</Label>
        <Select
          value={form.actionKind}
          onValueChange={(value) =>
            setForm((current) => ({ ...current, actionKind: value as WebhookActionKind }))
          }
        >
          <SelectTrigger id="webhook-action-kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">{labels.actionKindWebhook()}</SelectItem>
            <SelectItem value="notify_agent">{labels.actionKindNotifyAgent()}</SelectItem>
            <SelectItem value="run_snippet">{labels.actionKindRunSnippet()}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.actionKind === "run_snippet" ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-snippet-code">{labels.snippetCodeLabel()}</Label>
            <Textarea
              id="webhook-snippet-code"
              className="min-h-40 font-mono text-sm"
              placeholder={labels.snippetCodePlaceholder()}
              value={form.code}
              onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))}
            />
            <p className="text-xs text-muted-foreground">{labels.snippetHelperCaption()}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="webhook-snippet-timeout">{labels.snippetTimeoutLabel()}</Label>
            <Input
              id="webhook-snippet-timeout"
              type="number"
              min={100}
              max={5000}
              step={100}
              value={form.timeoutMs}
              onChange={(event) =>
                setForm((current) => ({ ...current, timeoutMs: Number(event.target.value) }))
              }
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="webhook-target-url">{labels.targetUrlLabel()}</Label>
            <Input
              id="webhook-target-url"
              type="url"
              placeholder={labels.targetUrlPlaceholder()}
              value={form.targetUrl}
              onChange={(event) =>
                setForm((current) => ({ ...current, targetUrl: event.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="webhook-secret">{labels.secretLabel()}</Label>
              {form.hasSecret ? <Badge variant="outline">{labels.secretConfigured()}</Badge> : null}
            </div>
            <Input
              id="webhook-secret"
              type="password"
              placeholder={
                form.hasSecret ? labels.secretKeepPlaceholder() : labels.secretPlaceholder()
              }
              value={form.secret}
              onChange={(event) =>
                setForm((current) => ({ ...current, secret: event.target.value }))
              }
            />
          </div>
          {/* Custom per-request headers are supported by the schema but intentionally left out of v1 UI. */}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch
          id="webhook-enabled"
          checked={form.enabled}
          onCheckedChange={(checked) => setForm((current) => ({ ...current, enabled: checked }))}
        />
        <Label htmlFor="webhook-enabled" className="cursor-pointer font-normal">
          {labels.enabledLabel()}
        </Label>
      </div>
    </div>
  );

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
              <WebhookIcon />
              <span>{labels.openButton()}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            closeForm();
            setExpandedRuleId(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WebhookIcon className="h-5 w-5" />
              {labels.title()}
            </DialogTitle>
            <DialogDescription>{labels.description()}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {formOpen ? renderForm() : renderList()}
            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between sm:space-x-0">
            {formOpen ? (
              <>
                <Button variant="outline" type="button" onClick={closeForm} disabled={saving}>
                  {labels.cancel()}
                </Button>
                <Button type="button" onClick={save} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {saving ? labels.saving() : form.id ? labels.saveChanges() : labels.createRule()}
                </Button>
              </>
            ) : (
              <>
                <span />
                <Button variant="outline" type="button" onClick={openCreateForm}>
                  <Plus className="h-4 w-4" />
                  {labels.addRule()}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        body={confirmDelete ? labels.deleteConfirmBody({ name: confirmDelete.name }) : ""}
        confirmLabel={labels.deleteConfirmAction()}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) {
            deleteMutation.mutate({ id: confirmDelete.id });
          }
        }}
        open={confirmDelete !== null}
        pending={deleteMutation.isPending}
        title={labels.deleteConfirmTitle()}
      />
    </>
  );
}
