import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { getRecordTitle } from "busabase-core/dashboard/change-request";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { RecordCard } from "~/components/busabase/RecordCard";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { normalizeRecordsPage, RECORDS_PAGE_SIZE } from "~/lib/record-pagination";
import { spacing } from "~/theme/tokens";

function RecordsContent() {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const [search, setSearch] = useState("");
  const query = useInfiniteQuery({
    queryKey: ["records", "paged", buda?.serverUrl, buda?.spaceScope, RECORDS_PAGE_SIZE],
    queryFn: buda
      ? async ({ pageParam }) =>
          normalizeRecordsPage(
            await buda.client.records.list({ cursor: pageParam, limit: RECORDS_PAGE_SIZE }),
            pageParam,
          )
      : skipToken,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
  const records = useMemo(
    () => query.data?.pages.flatMap((page) => page.records) ?? [],
    [query.data],
  );
  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return records;
    return records.filter((record) =>
      `${getRecordTitle(record)} ${record.base.name}`.toLocaleLowerCase().includes(needle),
    );
  }, [records, search]);
  const hasSearch = search.trim().length > 0;

  return (
    <DrawerScaffold
      title="Records"
      subtitle={
        records.length > 0
          ? hasSearch
            ? `${filteredRecords.length} of ${records.length}`
            : `${records.length} loaded`
          : undefined
      }
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <View style={styles.searchWrap}>
        <TextInput
          accessibilityLabel="Search records"
          placeholder="Search records"
          returnKeyType="search"
          value={search}
          onChangeText={setSearch}
        />
      </View>
      {query.isPending ? <NativeLoadingState label="Loading records" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isPending && !query.error && records.length === 0 ? (
        <NativeEmptyState title="No records yet" />
      ) : null}
      {!query.isPending && !query.error && records.length > 0 && filteredRecords.length === 0 ? (
        <NativeEmptyState title="No matching records" />
      ) : null}
      {filteredRecords.length > 0 ? (
        <NativeSection>
          {filteredRecords.map((record, index) => (
            <RecordCard
              key={record.id}
              record={record}
              last={index === filteredRecords.length - 1}
              onPress={() => router.push({ pathname: "/records/[id]", params: { id: record.id } })}
            />
          ))}
        </NativeSection>
      ) : null}
      {!query.isPending && !query.error && query.hasNextPage ? (
        <NativeActionBar>
          <Button
            label="Load more"
            variant="secondary"
            loading={query.isFetchingNextPage}
            fullWidth
            onPress={() => void query.fetchNextPage()}
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

export default function RecordsScreen() {
  return (
    <ConnectionGuard>
      <RecordsContent />
    </ConnectionGuard>
  );
}
