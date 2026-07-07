import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { RecordCard } from "~/components/busabase/RecordCard";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";

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
      {query.data && query.data.length > 0 ? (
        <NativeSection title="Records" caption={`${query.data.length}`}>
          {query.data.map((record, index) => (
            <RecordCard
              key={record.id}
              record={record}
              last={index === query.data.length - 1}
              onPress={() => router.push({ pathname: "/records/[id]", params: { id: record.id } })}
            />
          ))}
        </NativeSection>
      ) : null}
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
