import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";
import { TextInput } from "~/components/ui/TextInput";
import { TemplateCard } from "~/domains/templates/components/TemplateCard";
import { filterTemplates } from "~/domains/templates/utils/template-search";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { fmt, useI18n } from "~/i18n";
import { spacing } from "~/theme/tokens";

function TemplatesContent() {
  const router = useRouter();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [search, setSearch] = useState("");

  const catalog = useQuery(
    buda
      ? buda.orpc.templates.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "templates"], queryFn: skipToken },
  );
  const templates = catalog.data?.templates ?? [];
  const filtered = useMemo(() => filterTemplates(templates, search), [templates, search]);

  return (
    <DrawerScaffold
      title={t.templates.title}
      subtitle={t.templates.overview}
      refreshing={catalog.isRefetching}
      onRefresh={() => void catalog.refetch()}
    >
      <View style={styles.searchWrap}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t.templates.search}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {catalog.isLoading ? <NativeLoadingState label={t.templates.title} /> : null}
      {catalog.isError || catalog.data?.error ? (
        <NativeErrorState
          message={catalog.data?.error ?? t.templates.catalogFailed}
          onRetry={() => void catalog.refetch()}
        />
      ) : null}
      {!catalog.isLoading && !catalog.isError && !catalog.data?.error && filtered.length === 0 ? (
        <NativeEmptyState
          title={search ? fmt(t.templates.searchEmpty, { search }) : t.templates.catalogEmpty}
        />
      ) : null}

      {filtered.length > 0 ? (
        <View style={styles.list}>
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onPress={() =>
                router.push({ pathname: "/templates/[name]", params: { name: template.name } })
              }
            />
          ))}
        </View>
      ) : null}
    </DrawerScaffold>
  );
}

export default function TemplatesScreen() {
  return (
    <ConnectionGuard>
      <TemplatesContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 14, paddingTop: 12 },
  list: { paddingHorizontal: 14, paddingVertical: 16, gap: spacing[4] },
});
