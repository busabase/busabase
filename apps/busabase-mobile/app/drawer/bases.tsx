import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { BaseCard } from "~/domains/base/components/BaseCard";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { spacing } from "~/theme/tokens";

const BASE_BATCH_SIZE = 30;

function BasesContent() {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(BASE_BATCH_SIZE);
  const query = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({ input: {} })
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );
  const bases = query.data ?? [];
  const filteredBases = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return bases;
    return bases.filter(
      (base) =>
        base.name.toLocaleLowerCase().includes(needle) ||
        base.slug.toLocaleLowerCase().includes(needle) ||
        base.description.toLocaleLowerCase().includes(needle),
    );
  }, [bases, search]);
  const hasSearch = search.trim().length > 0;
  const visibleBases = hasSearch ? filteredBases : filteredBases.slice(0, visibleCount);

  return (
    <DrawerScaffold
      title="Bases"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <View style={styles.searchWrap}>
        <TextInput
          accessibilityLabel="Search bases"
          placeholder="Search bases"
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      {query.isLoading ? <NativeLoadingState label="Loading bases" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && query.data?.length === 0 ? (
        <NativeEmptyState title="No bases yet" />
      ) : null}
      {!query.isLoading && !query.error && bases.length > 0 && filteredBases.length === 0 ? (
        <NativeEmptyState title="No matching bases" />
      ) : null}
      {visibleBases.length > 0 ? (
        <NativeSection>
          {visibleBases.map((base, index) => (
            <BaseCard
              key={base.id}
              base={base}
              last={index === visibleBases.length - 1}
              onPress={() => router.push({ pathname: "/base/[slug]", params: { slug: base.slug } })}
            />
          ))}
        </NativeSection>
      ) : null}
      {!hasSearch && visibleCount < bases.length ? (
        <NativeActionBar>
          <Button
            label="Load more"
            variant="secondary"
            fullWidth
            onPress={() => setVisibleCount((count) => count + BASE_BATCH_SIZE)}
          />
        </NativeActionBar>
      ) : null}
    </DrawerScaffold>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    marginHorizontal: spacing[5],
    marginTop: spacing[3],
  },
});

export default function BasesScreen() {
  return (
    <ConnectionGuard>
      <BasesContent />
    </ConnectionGuard>
  );
}
