import type { BaseVO, FieldType, ViewVO } from "busabase-core/types";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Trash2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { useBusabaseClient } from "~/api/use-busabase-client";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeScreen,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { useNativeQuery } from "~/hooks/use-native-query";
import { mobile, radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const FIELD_TYPES: FieldType[] = [
  "text",
  "longtext",
  "markdown",
  "number",
  "date",
  "checkbox",
  "url",
  "email",
];

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
  const client = useBusabaseClient();

  const loadBases = useCallback(() => client?.bases.list() ?? Promise.resolve([]), [client]);
  const basesQuery = useNativeQuery(!!client, loadBases);
  const base: BaseVO | null = useMemo(
    () => basesQuery.data?.find((item) => item.slug === slug) ?? null,
    [basesQuery.data, slug],
  );
  const loadViews = useCallback(
    () => (client && base ? client.bases.listViews({ baseId: base.id }) : Promise.resolve([])),
    [client, base],
  );
  const viewsQuery = useNativeQuery(!!client && !!base, loadViews);

  const [fieldName, setFieldName] = useState("");
  const [fieldSlug, setFieldSlug] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [required, setRequired] = useState(false);
  const [savingField, setSavingField] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewName, setViewName] = useState("");
  const [savingView, setSavingView] = useState(false);

  const addField = async () => {
    if (!client || !base) {
      return;
    }
    const name = fieldName.trim();
    const fieldSlugValue = (fieldSlug.trim() || toSlug(name)).trim();
    if (!name || !fieldSlugValue) {
      setError("Field name is required.");
      return;
    }
    setSavingField(true);
    setError(null);
    try {
      await client.bases.createField({
        baseId: base.id,
        name,
        slug: fieldSlugValue,
        type: fieldType,
        required,
      });
      setFieldName("");
      setFieldSlug("");
      setFieldType("text");
      setRequired(false);
      basesQuery.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not add field");
    } finally {
      setSavingField(false);
    }
  };

  const createView = async () => {
    if (!client || !base) {
      return;
    }
    const name = viewName.trim();
    if (!name) {
      return;
    }
    setSavingView(true);
    setError(null);
    try {
      const changeRequest = await client.bases.createViewChangeRequest({
        baseId: base.id,
        name,
        slug: toSlug(name),
        submittedBy: "mobile-editor",
      });
      setViewName("");
      router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create view");
    } finally {
      setSavingView(false);
    }
  };

  const deleteView = (view: ViewVO) => {
    Alert.alert("Delete view", `Create a delete change request for "${view.name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          if (!client) {
            return;
          }
          void client.views
            .deleteChangeRequest({ viewId: view.id, submittedBy: "mobile-editor" })
            .then((changeRequest) =>
              router.push({ pathname: "/change-requests/[id]", params: { id: changeRequest.id } }),
            )
            .catch((caught: unknown) =>
              setError(caught instanceof Error ? caught.message : "Could not delete view"),
            );
        },
      },
    ]);
  };

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

  if (basesQuery.loading) {
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
          <View style={styles.requiredRow}>
            <Text style={[typography.body, { color: tokens.foreground }]}>Required</Text>
            <Switch
              value={required}
              trackColor={{ true: tokens.primary }}
              onValueChange={setRequired}
            />
          </View>
          <Button label="Add field" loading={savingField} fullWidth onPress={addField} />
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
            loading={savingView}
            disabled={viewName.trim().length === 0}
            fullWidth
            onPress={createView}
          />
        </View>

        {error ? <NativeErrorState message={error} onRetry={() => setError(null)} /> : null}
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
  requiredRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
