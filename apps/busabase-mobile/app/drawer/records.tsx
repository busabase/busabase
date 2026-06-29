import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { RecordCard } from "~/components/busabase/RecordCard";
import { NativeEmptyState, NativeErrorState, NativeLoadingState } from "~/components/native-screen";

function RecordsContent() {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const query = useQuery(
    buda
      ? buda.orpc.records.list.queryOptions({ input: { limit: 50 } })
      : { queryKey: ["no-connection", "records", "list"], queryFn: skipToken },
  );

  return (
    <DrawerScaffold
      title="Records"
      subtitle="Read-only merged records"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading ? <NativeLoadingState label="Loading records" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && query.data?.length === 0 ? (
        <NativeEmptyState
          title="No records yet"
          description="Approved and merged Busabase records will appear here."
        />
      ) : null}
      <View style={styles.list}>
        {query.data?.map((record) => (
          <RecordCard
            key={record.id}
            record={record}
            onPress={() => router.push({ pathname: "/records/[id]", params: { id: record.id } })}
          />
        ))}
      </View>
    </DrawerScaffold>
  );
}

export default function RecordsScreen() {
  return (
    <ConnectionGuard>
      <RecordsContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  list: { marginHorizontal: 20, gap: 12 },
});
