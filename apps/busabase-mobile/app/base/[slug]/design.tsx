import { skipToken, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BaseVO, FieldType, ViewVO } from "busabase-contract/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, ChevronDown, Plus, Trash2 } from "lucide-react-native";
import { iStringParse } from "openlib/i18n/i-string";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeBottomSheet,
  NativeEmptyState,
  NativeInlineError,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { getFieldTypeLabel } from "~/lib/field-type-label";
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
  "embed",
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
      setChoicePendingRemove(null);
      closeFieldSheet();
      void queryClient.invalidateQueries({ queryKey: buda?.orpc.bases.list.key({}) });
    },
  });

  const createViewMutation = useMutation({
    mutationFn: async () => {
      if (!buda || !base) throw new Error("Not ready");
      const name = viewName.trim();
      if (!name) throw new Error("View name is required.");
      // Explicit `autoMerge: false`: this screen routes to the change-request
      // detail on success, so it must always queue a pending CR regardless of
      // the actor's own write access — same reasoning as the web dashboard's
      // view/record submit handlers.
      return buda.client.views.changeRequest({
        operation: "create",
        baseId: base.id,
        name,
        slug: toSlug(name),
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

  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/drawer/home"))}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (basesQuery.isLoading) {
    return (
      <DrawerScaffold title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading base" />
      </DrawerScaffold>
    );
  }
  if (!base) {
    return (
      <DrawerScaffold title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeEmptyState title="Base not found" description="This base is not available." />
      </DrawerScaffold>
    );
  }

  return (
    <DrawerScaffold
      title={`${base.name} design`}
      titleNumberOfLines={2}
      subtitle={`${base.fields.length} fields`}
      headerLeading={headerLeading}
    >
      <NativeSection title="Fields" caption={`${base.fields.length}`}>
        {base.fields.map((field) => (
          <NativeRow
            key={field.id}
            title={iStringParse(field.name)}
            subtitle={getFieldTypeLabel(field.type)}
            meta={field.required ? "Required" : undefined}
          />
        ))}
        <NativeRow
          title="Add field"
          leading={<Plus size={18} color={tokens.mutedForeground} />}
          onPress={() => {
            addFieldMutation.reset();
            setFieldTypePickerOpen(false);
            setFieldSheetOpen(true);
          }}
          last
        />
      </NativeSection>

      <NativeSection title="Views" caption={`${viewsQuery.data?.length ?? 0}`}>
        {(viewsQuery.data ?? []).map((view) => (
          <NativeRow
            key={view.id}
            title={view.name}
            onPress={() => {
              deleteViewMutation.reset();
              setViewPendingDelete(view);
            }}
          />
        ))}
        <NativeRow
          title="New view"
          leading={<Plus size={18} color={tokens.mutedForeground} />}
          onPress={() => {
            createViewMutation.reset();
            setViewSheetOpen(true);
          }}
          last
        />
      </NativeSection>

      <NativeBottomSheet
        visible={fieldSheetOpen && !choicePendingRemove}
        title="Add field"
        showCloseButton
        maxHeight="88%"
        onClose={closeFieldSheet}
        footer={
          <NativeActionBar>
            {addFieldMutation.error ? (
              <NativeInlineError
                message={addFieldMutation.error.message}
                onReset={() => addFieldMutation.reset()}
              />
            ) : null}
            <Button
              label="Add field"
              loading={addFieldMutation.isPending}
              fullWidth
              onPress={() => addFieldMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={addFieldMutation.isPending}
              fullWidth
              onPress={closeFieldSheet}
            />
          </NativeActionBar>
        }
      >
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheetForm}
          keyboardShouldPersistTaps="handled"
        >
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Type: ${getFieldTypeLabel(fieldType)}`}
            accessibilityState={{ expanded: fieldTypePickerOpen }}
            style={({ pressed }) => [
              styles.selectTrigger,
              {
                backgroundColor: tokens.muted,
                borderColor: fieldTypePickerOpen ? tokens.primary : tokens.border,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
            onPress={() => setFieldTypePickerOpen((open) => !open)}
          >
            <Text
              numberOfLines={1}
              style={[typography.body, styles.selectValue, { color: tokens.foreground }]}
            >
              {getFieldTypeLabel(fieldType)}
            </Text>
            <ChevronDown size={18} color={tokens.mutedForeground} />
          </Pressable>
          {fieldTypePickerOpen ? (
            <ScrollView
              nestedScrollEnabled
              style={[styles.selectOptions, { borderColor: tokens.border }]}
            >
              {FIELD_TYPES.map((type) => {
                const selected = type === fieldType;
                return (
                  <Pressable
                    key={type}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={({ pressed }) => [
                      styles.selectOption,
                      {
                        backgroundColor: selected ? tokens.primaryMuted : tokens.surface,
                        borderColor: tokens.border,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                    onPress={() => {
                      setFieldType(type);
                      setFieldTypePickerOpen(false);
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[typography.body, styles.selectValue, { color: tokens.foreground }]}
                    >
                      {getFieldTypeLabel(type)}
                    </Text>
                    {selected ? <Check size={17} color={tokens.foreground} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}
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
                    onPress={() => setChoicePendingRemove(choice)}
                  >
                    <Text style={[typography.small, { color: tokens.foreground }]}>{choice}</Text>
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
              accessibilityLabel="Required"
              value={required}
              trackColor={{ true: tokens.primary }}
              onValueChange={setRequired}
            />
          </View>
        </ScrollView>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={viewSheetOpen}
        title="New view"
        showCloseButton
        onClose={() => setViewSheetOpen(false)}
        footer={
          <NativeActionBar>
            {createViewMutation.error ? (
              <NativeInlineError
                message={createViewMutation.error.message}
                onReset={() => createViewMutation.reset()}
              />
            ) : null}
            <Button
              label="Create view change request"
              loading={createViewMutation.isPending}
              disabled={viewName.trim().length === 0}
              fullWidth
              onPress={() => createViewMutation.mutate()}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={createViewMutation.isPending}
              fullWidth
              onPress={() => setViewSheetOpen(false)}
            />
          </NativeActionBar>
        }
      >
        <View style={styles.sheetForm}>
          <TextInput label="View name" value={viewName} onChangeText={setViewName} />
        </View>
      </NativeBottomSheet>

      <NativeBottomSheet
        visible={!!viewPendingDelete}
        title="View actions"
        description={
          viewPendingDelete
            ? `${viewPendingDelete.name} · Create a change request before deleting.`
            : undefined
        }
        showCloseButton
        onClose={() => setViewPendingDelete(null)}
        footer={
          <NativeActionBar>
            {deleteViewMutation.error ? (
              <NativeInlineError
                message={deleteViewMutation.error.message}
                onReset={() => deleteViewMutation.reset()}
              />
            ) : null}
            <Button
              label="Create delete change request"
              variant="destructive"
              loading={deleteViewMutation.isPending}
              disabled={!viewPendingDelete}
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                if (viewPendingDelete) {
                  deleteViewMutation.mutate(viewPendingDelete);
                }
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              disabled={deleteViewMutation.isPending}
              fullWidth
              onPress={() => setViewPendingDelete(null)}
            />
          </NativeActionBar>
        }
      />

      <NativeBottomSheet
        visible={!!choicePendingRemove}
        title="Remove choice?"
        description={
          choicePendingRemove
            ? `Remove "${choicePendingRemove}" from this new field draft.`
            : undefined
        }
        showCloseButton
        onClose={() => setChoicePendingRemove(null)}
        footer={
          <NativeActionBar>
            <Button
              label="Remove choice"
              variant="destructive"
              fullWidth
              leadingIcon={<Trash2 size={18} color={tokens.destructiveForeground} />}
              onPress={() => {
                if (choicePendingRemove) {
                  setChoices((current) => current.filter((item) => item !== choicePendingRemove));
                }
                setChoicePendingRemove(null);
              }}
            />
            <Button
              label="Cancel"
              variant="ghost"
              fullWidth
              onPress={() => setChoicePendingRemove(null)}
            />
          </NativeActionBar>
        }
      />
    </DrawerScaffold>
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
  sheetScroll: { maxHeight: 460 },
  sheetForm: { gap: 12, paddingBottom: 8 },
  selectTrigger: {
    minHeight: mobile.minTouchTarget,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectValue: { flex: 1, minWidth: 0 },
  selectOptions: {
    maxHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  selectOption: {
    minHeight: mobile.minTouchTarget,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
