import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO, FieldType, ViewVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { buildChoiceFieldOptions, isChoiceFieldType, toBaseDesignSlug } from "../utils/base-design";

export function useBaseDesignController(slug: string) {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();
  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const base: BaseVO | null = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );
  const viewsQuery = useQuery(
    buda && base
      ? buda.orpc.bases.listViews.queryOptions({ input: { baseId: base.id } })
      : { queryKey: ["no-connection", "views", slug], queryFn: skipToken },
  );

  const [fieldName, setFieldName] = useState("");
  const [fieldSlug, setFieldSlug] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [required, setRequired] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [choiceDraft, setChoiceDraft] = useState("");
  const [viewName, setViewName] = useState("");
  const [fieldSheetOpen, setFieldSheetOpen] = useState(false);
  const [fieldTypePickerOpen, setFieldTypePickerOpen] = useState(false);
  const [viewSheetOpen, setViewSheetOpen] = useState(false);
  const [viewPendingDelete, setViewPendingDelete] = useState<ViewVO | null>(null);
  const [choicePendingRemove, setChoicePendingRemove] = useState<string | null>(null);

  const closeFieldSheet = () => {
    setFieldTypePickerOpen(false);
    setFieldSheetOpen(false);
  };

  const resetFieldDraft = () => {
    setFieldName("");
    setFieldSlug("");
    setFieldType("text");
    setRequired(false);
    setChoices([]);
    setChoiceDraft("");
    setChoicePendingRemove(null);
  };

  const addFieldMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      const name = fieldName.trim();
      const fieldSlugValue = (fieldSlug.trim() || toBaseDesignSlug(name)).trim();
      if (!name || !fieldSlugValue) throw new Error("Field name is required.");
      const options = isChoiceFieldType(fieldType) ? buildChoiceFieldOptions(choices) : undefined;
      return buda.client.bases.createField({
        baseId: base.id,
        name,
        slug: fieldSlugValue,
        type: fieldType,
        required,
        ...(options ? { options } : {}),
      });
    },
    onSuccess: () => {
      resetFieldDraft();
      closeFieldSheet();
      void queryClient.invalidateQueries({ queryKey: buda?.orpc.bases.list.key({}) });
    },
  });

  const createViewMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      const name = viewName.trim();
      if (!name) throw new Error("View name is required.");
      return buda.client.views.changeRequest({
        operation: "create",
        baseId: base.id,
        name,
        slug: toBaseDesignSlug(name),
        submittedBy: "mobile-editor",
        autoMerge: false,
      });
    },
    onSuccess: (changeRequest) => {
      setViewName("");
      setViewSheetOpen(false);
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (view: ViewVO) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.views.changeRequest({
        operation: "delete",
        viewId: view.id,
        submittedBy: "mobile-editor",
        autoMerge: false,
      });
    },
    onSuccess: (changeRequest) => {
      setViewPendingDelete(null);
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const openFieldSheet = () => {
    addFieldMutation.reset();
    setFieldTypePickerOpen(false);
    setFieldSheetOpen(true);
  };
  const openViewSheet = () => {
    createViewMutation.reset();
    setViewSheetOpen(true);
  };
  const requestViewDelete = (view: ViewVO) => {
    deleteViewMutation.reset();
    setViewPendingDelete(view);
  };
  const updateFieldName = (value: string) => {
    setFieldName(value);
    if (!fieldSlug) setFieldSlug(toBaseDesignSlug(value));
  };
  const updateFieldSlug = (value: string) => setFieldSlug(toBaseDesignSlug(value));
  const addChoice = () => {
    const value = choiceDraft.trim();
    if (value && !choices.includes(value)) {
      setChoices((current) => [...current, value]);
    }
    setChoiceDraft("");
  };
  const removePendingChoice = () => {
    if (choicePendingRemove) {
      setChoices((current) => current.filter((item) => item !== choicePendingRemove));
    }
    setChoicePendingRemove(null);
  };
  const goBack = () => (router.canGoBack() ? router.back() : router.replace("/drawer/home"));

  return {
    addFieldMutation,
    base,
    basesQuery,
    choices,
    choiceDraft,
    choicePendingRemove,
    createViewMutation,
    deleteViewMutation,
    fieldName,
    fieldSheetOpen,
    fieldSlug,
    fieldType,
    fieldTypePickerOpen,
    required,
    viewName,
    viewPendingDelete,
    viewSheetOpen,
    viewsQuery,
    addChoice,
    closeFieldSheet,
    goBack,
    openFieldSheet,
    openViewSheet,
    removePendingChoice,
    requestViewDelete,
    setChoiceDraft,
    setChoicePendingRemove,
    setFieldType,
    setFieldTypePickerOpen,
    setRequired,
    setViewName,
    setViewPendingDelete,
    setViewSheetOpen,
    updateFieldName,
    updateFieldSlug,
  };
}

export type BaseDesignController = ReturnType<typeof useBaseDesignController>;
