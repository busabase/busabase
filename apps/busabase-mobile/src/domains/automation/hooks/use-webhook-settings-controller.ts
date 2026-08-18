import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO } from "busabase-contract/domains/base/types";
import type {
  WebhookRuleInput,
  WebhookRuleUpdateInput,
  WebhookRuleVO,
} from "busabase-contract/domains/webhook/types";
import { useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import type { WebhookBaseOption, WebhookFormPicker, WebhookFormState } from "../types/webhook-form";
import {
  ALL_BASES_VALUE,
  buildWebhookCreateInput,
  buildWebhookUpdateInput,
  emptyWebhookForm,
  getWebhookTestFireMessage,
  webhookRuleToForm,
} from "../utils/webhook-form";

export const useWebhookSettingsController = () => {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<WebhookFormState>(emptyWebhookForm);
  const [openPicker, setOpenPicker] = useState<WebhookFormPicker>(null);
  const [manageRuleId, setManageRuleId] = useState<string | null>(null);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] = useState<string | null>(null);
  const [testFireMessage, setTestFireMessage] = useState<string | null>(null);

  const rulesQuery = useQuery(
    buda
      ? buda.orpc.webhooks.list.queryOptions()
      : { queryKey: ["no-connection", "webhooks"], queryFn: skipToken },
  );
  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "webhooks-bases"], queryFn: skipToken },
  );
  const rules = rulesQuery.data ?? [];
  const bases: BaseVO[] = basesQuery.data ?? [];
  const manageRule = manageRuleId ? (rules.find((rule) => rule.id === manageRuleId) ?? null) : null;
  const confirmDeleteRule = confirmDeleteRuleId
    ? (rules.find((rule) => rule.id === confirmDeleteRuleId) ?? null)
    : null;

  const deliveriesQuery = useQuery(
    buda && manageRuleId
      ? buda.orpc.webhooks.deliveries.queryOptions({ input: { ruleId: manageRuleId, limit: 5 } })
      : { queryKey: ["no-connection", "webhook-deliveries"], queryFn: skipToken },
  );

  const invalidateRules = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: buda?.orpc.webhooks.list.key() }),
    [buda, queryClient],
  );

  const closeForm = useCallback(() => {
    setOpenPicker(null);
    setFormOpen(false);
    setForm(emptyWebhookForm());
  }, []);

  const openCreateForm = useCallback(() => {
    setOpenPicker(null);
    setForm(emptyWebhookForm());
    setFormOpen(true);
  }, []);

  const openEditForm = useCallback((rule: WebhookRuleVO) => {
    setOpenPicker(null);
    setForm(webhookRuleToForm(rule));
    setManageRuleId(null);
    setFormOpen(true);
  }, []);

  const openManage = useCallback((rule: WebhookRuleVO) => {
    setTestFireMessage(null);
    setManageRuleId(rule.id);
  }, []);

  const closeManage = useCallback(() => {
    setManageRuleId(null);
    setTestFireMessage(null);
  }, []);

  const createMutation = useMutation({
    mutationFn: async (input: WebhookRuleInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.create(input);
    },
    onSuccess: () => {
      invalidateRules();
      closeForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (input: WebhookRuleUpdateInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.update(input);
    },
    onSuccess: () => {
      invalidateRules();
      closeForm();
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (input: WebhookRuleUpdateInput) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.update(input);
    },
    onSuccess: invalidateRules,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.delete({ id });
    },
    onSuccess: () => {
      invalidateRules();
      setConfirmDeleteRuleId(null);
      setManageRuleId(null);
    },
  });

  const testFireMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.webhooks.testFire({ id });
    },
    onSuccess: (delivery, id) => {
      invalidateRules();
      void queryClient.invalidateQueries({
        queryKey: buda?.orpc.webhooks.deliveries.key({ input: { ruleId: id, limit: 5 } }),
      });
      setTestFireMessage(getWebhookTestFireMessage(delivery));
    },
    onError: () => setTestFireMessage("Could not fire the test request."),
  });

  const updateForm = useCallback(
    <Key extends keyof WebhookFormState>(key: Key, value: WebhookFormState[Key]) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const togglePicker = useCallback((picker: Exclude<WebhookFormPicker, null>) => {
    setOpenPicker((current) => (current === picker ? null : picker));
  }, []);

  const selectPickerValue = useCallback(
    <Key extends "eventType" | "baseId">(key: Key, value: WebhookFormState[Key]) => {
      setForm((current) => ({ ...current, [key]: value }));
      setOpenPicker(null);
    },
    [],
  );

  const toggleEnabled = useCallback(
    (rule: WebhookRuleVO) => {
      const nextForm = { ...webhookRuleToForm(rule), enabled: !rule.enabled };
      toggleMutation.mutate(buildWebhookUpdateInput(nextForm, rule.id));
    },
    [toggleMutation],
  );

  const saveForm = useCallback(() => {
    if (form.id) {
      updateMutation.mutate(buildWebhookUpdateInput(form, form.id));
    } else {
      createMutation.mutate(buildWebhookCreateInput(form));
    }
  }, [createMutation, form, updateMutation]);

  const baseOptions: WebhookBaseOption[] = useMemo(
    () => [
      { value: ALL_BASES_VALUE, label: "All bases" },
      ...bases.map((base) => ({ value: base.id, label: base.name })),
    ],
    [bases],
  );

  const goBack = useCallback(
    () => (router.canGoBack() ? router.back() : router.replace("/drawer/settings")),
    [router],
  );

  return {
    rules,
    rulesQuery,
    manageRule,
    confirmDeleteRule,
    deliveries: deliveriesQuery.data ?? [],
    deliveriesQuery,
    form,
    formOpen,
    openPicker,
    baseOptions,
    saving: createMutation.isPending || updateMutation.isPending,
    formError: createMutation.error ?? updateMutation.error,
    togglePending: toggleMutation.isPending,
    deletePending: deleteMutation.isPending,
    deleteError: deleteMutation.error,
    testFirePending: testFireMutation.isPending,
    testFireMessage,
    goBack,
    openCreateForm,
    openEditForm,
    openManage,
    closeManage,
    closeForm,
    updateForm,
    togglePicker,
    selectPickerValue,
    toggleEnabled,
    saveForm,
    requestDelete: setConfirmDeleteRuleId,
    closeDelete: () => setConfirmDeleteRuleId(null),
    confirmDelete: () => confirmDeleteRule && deleteMutation.mutate(confirmDeleteRule.id),
    resetDeleteError: deleteMutation.reset,
    resetFormError: () => {
      createMutation.reset();
      updateMutation.reset();
    },
    testFire: (id: string) => testFireMutation.mutate(id),
  };
};

export type WebhookSettingsController = ReturnType<typeof useWebhookSettingsController>;
