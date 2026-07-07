import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO, FieldType, ViewVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

// Creatable field types, mirroring the web Base setup view. System/computed types
// (created_time, updated_by, …) are server-managed and not offered here.
const FIELD_TYPES: FieldType[] = [
  "text",
  "longtext",
  "markdown",
  "html",
  "code",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
  "attachment",
  "auto_number",
];

// Field types that carry a user-defined choice list.
const CHOICE_TYPES = new Set<FieldType>(["select", "multiselect"]);

const toSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function BaseDesignContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const basesQuery = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({})
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

  const addChoice = () => {
    const value = choiceDraft.trim();
    if (value && !choices.includes(value)) {
      setChoices((current) => [...current, value]);
    }
    setChoiceDraft("");
  };

  const addFieldMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      const name = fieldName.trim();
      const fieldSlugValue = (fieldSlug.trim() || toSlug(name)).trim();
      if (!name || !fieldSlugValue) throw new Error("Field name is required.");
      // Choice fields carry their option list; ids are derived from the label.
      const options = CHOICE_TYPES.has(fieldType)
        ? { choices: choices.map((label) => ({ id: toSlug(label) || label, name: label })) }
        : undefined;
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
      setFieldName("");
      setFieldSlug("");
      setFieldType("text");
      setRequired(false);
      setChoices([]);
      setChoiceDraft("");
      void queryClient.invalidateQueries({ queryKey: buda?.orpc.bases.list.key({}) });
    },
  });

  const createViewMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      const name = viewName.trim();
      if (!name) throw new Error("View name is required.");
      return buda.client.bases.createViewChangeRequest({
        baseId: base.id,
        name,
        slug: toSlug(name),
        submittedBy: "mobile-editor",
      });
    },
    onSuccess: (changeRequest) => {
      setViewName("");
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const deleteViewMutation = useMutation({
    mutationFn: async (view: ViewVO) => {
      if (!buda) throw new Error("Not connected");
      return buda.client.views.deleteChangeRequest({
        viewId: view.id,
        submittedBy: "mobile-editor",
      });
    },
    onSuccess: (changeRequest) => {
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    },
  });

  const deleteView = (view: ViewVO) => {
    Alert.alert("Delete view", `Create a delete change request for "${view.name}"?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteViewMutation.mutate(view) },
    ]);
  };

  const mutationError =
    addFieldMutation.error?.message ??
    createViewMutation.error?.message ??
    deleteViewMutation.error?.message ??
    null;

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/inbox"))}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (basesQuery.isLoading) {
    return (
      <NativeScreen title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading base" />
      </NativeScreen>
    );
  }
  if (!base) {
    return (
      <NativeScreen title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeEmptyState title="Base not found" description="This base is not available." />
      </NativeScreen>
    );
  }

  return (
    <NativeScreen
      title={`${base.name} design`}
      subtitle={`${base.fields.length} fields`}
      headerLeading={headerLeading}
    >
      <View style={styles.content}>
        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Fields</Text>
          {base.fields.map((field) => (
            <View key={field.id} style={[styles.fieldRow, { borderColor: tokens.border }]}>
              <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{field.name}</Text>
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {field.type}
                {field.required ? " · required" : ""}
              </Text>
            </View>
          ))}
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Add field</Text>
          <TextInput
            label="Name"
            value={fieldName}
            onChangeText={(value) => {
              setFieldName(value);
              if (!fieldSlug) {
                setFieldSlug(toSlug(value));
              }
            }}
          />
          <TextInput
            label="Slug"
            value={fieldSlug}
            onChangeText={(value) => setFieldSlug(toSlug(value))}
          />
          <Text style={[typography.small, { color: tokens.mutedForeground }]}>Type</Text>
          <View style={styles.chips}>
            {FIELD_TYPES.map((type) => {
              const active = type === fieldType;
              return (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? tokens.primaryMuted : tokens.surface,
                      borderColor: active ? tokens.primary : tokens.border,
                    },
                  ]}
                  onPress={() => setFieldType(type)}
                >
                  <Text
                    style={[
                      typography.small,
                      { color: active ? tokens.foreground : tokens.mutedForeground },
                    ]}
                  >
                    {type}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {CHOICE_TYPES.has(fieldType) ? (
            <View style={styles.choices}>
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>Choices</Text>
              <View style={styles.chips}>
                {choices.map((choice) => (
                  <Pressable
                    key={choice}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${choice}`}
                    style={[
                      styles.chip,
                      styles.choiceChip,
                      { backgroundColor: tokens.primaryMuted, borderColor: tokens.primary },
                    ]}
                    onPress={() =>
                      setChoices((current) => current.filter((item) => item !== choice))
                    }
                  >
                    <Text style={[typography.small, { color: tokens.foreground }]}>{choice}</Text>
                    <Trash2 size={13} color={tokens.destructive} />
                  </Pressable>
                ))}
              </View>
              <View style={styles.choiceRow}>
                <View style={styles.choiceInput}>
                  <TextInput
                    value={choiceDraft}
                    placeholder="Add a choice"
                    returnKeyType="done"
                    onChangeText={setChoiceDraft}
                    onSubmitEditing={addChoice}
                  />
                </View>
                <Button label="Add" variant="secondary" onPress={addChoice} />
              </View>
            </View>
          ) : null}
          <View style={styles.requiredRow}>
            <Text style={[typography.body, { color: tokens.foreground }]}>Required</Text>
            <Switch
              value={required}
              trackColor={{ true: tokens.primary }}
              onValueChange={setRequired}
            />
          </View>
          <Button
            label="Add field"
            loading={addFieldMutation.isPending}
            fullWidth
            onPress={() => addFieldMutation.mutate()}
          />
        </View>

        <View style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
          <Text style={[typography.h2, { color: tokens.foreground }]}>Views</Text>
          {(viewsQuery.data ?? []).map((view) => (
            <View
              key={view.id}
              style={[styles.fieldRow, styles.viewRow, { borderColor: tokens.border }]}
            >
              <Text style={[typography.bodyEm, { color: tokens.foreground }]}>{view.name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${view.name}`}
                hitSlop={8}
                onPress={() => deleteView(view)}
              >
                <Trash2 size={18} color={tokens.destructive} />
              </Pressable>
            </View>
          ))}
          <TextInput label="New view name" value={viewName} onChangeText={setViewName} />
          <Button
            label="Create view change request"
            loading={createViewMutation.isPending}
            disabled={viewName.trim().length === 0}
            fullWidth
            onPress={() => createViewMutation.mutate()}
          />
        </View>

        {mutationError ? (
          <NativeErrorState
            message={mutationError}
            onRetry={() => {
              addFieldMutation.reset();
              createViewMutation.reset();
              deleteViewMutation.reset();
            }}
          />
        ) : null}
      </View>
    </NativeScreen>
  );
}

export default function BaseDesignScreen() {
  return (
    <ConnectionGuard>
      <BaseDesignContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { marginHorizontal: 20, gap: 14 },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  fieldRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  viewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  choices: { gap: 8 },
  choiceChip: { flexDirection: "row", alignItems: "center", gap: 6 },
  choiceRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  choiceInput: { flex: 1 },
  requiredRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
