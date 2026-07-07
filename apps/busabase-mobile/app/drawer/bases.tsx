import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { BaseCard } from "~/components/busabase/BaseCard";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSection,
} from "~/components/native-screen";

function BasesContent() {
  const router = useRouter();
  const buda = useBusabaseOrpc();
  const query = useQuery(
    buda
      ? buda.orpc.bases.list.queryOptions({})
      : { queryKey: ["no-connection", "bases", "list"], queryFn: skipToken },
  );

  return (
    <DrawerScaffold
      title="Bases"
      subtitle="Read-only base catalog"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading ? <NativeLoadingState label="Loading bases" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && query.data?.length === 0 ? (
        <NativeEmptyState
          title="No bases yet"
          description="Bases created in the connected Busabase server will show here."
        />
      ) : null}
      {query.data && query.data.length > 0 ? (
        <NativeSection title="Bases" caption={`${query.data.length}`}>
          {query.data.map((base, index) => (
            <BaseCard
              key={base.id}
              base={base}
              last={index === query.data.length - 1}
              onPress={() => router.push({ pathname: "/base/[slug]", params: { slug: base.slug } })}
            />
          ))}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

export default function BasesScreen() {
  return (
    <ConnectionGuard>
      <BasesContent />
    </ConnectionGuard>
  );
}
