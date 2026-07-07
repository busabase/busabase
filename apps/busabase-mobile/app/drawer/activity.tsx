import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  CircleDot,
  FileText,
  GitCommitHorizontal,
  GitPullRequest,
  ListChecks,
  ShieldCheck,
} from "lucide-react-native";
import { useMemo } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { type ActivityEvent, type ActivityTone, buildActivityEvents } from "~/lib/activity-events";
import { formatDate } from "~/lib/format";
import { useTokens } from "~/theme/use-tokens";

const toneMeta: Record<ActivityTone, { label: string; icon: typeof GitPullRequest }> = {
  audit: { label: "Audit", icon: ShieldCheck },
  change_request: { label: "Change request", icon: GitPullRequest },
  operation: { label: "Operation", icon: ListChecks },
  commit: { label: "Commit", icon: GitCommitHorizontal },
  record: { label: "Record", icon: FileText },
};

function ActivityContent() {
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();

  const query = useQuery({
    queryKey: buda
      ? ["activity", buda.orpc.changeRequests.list.key({})]
      : ["no-connection", "activity"],
    queryFn: buda
      ? async () => {
          const client = buda.client;
          const [changeRequests, records, auditEvents] = await Promise.all([
            client.changeRequests.list({ limit: 100 }),
            client.records.list({ limit: 100 }),
            client.auditEvents.list({ limit: 100 }).catch(() => []),
          ]);
          return buildActivityEvents(changeRequests, records, auditEvents);
        }
      : skipToken,
  });

  const { today, earlier } = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const events = query.data ?? [];
    return {
      today: events.filter((event) => new Date(event.timestamp) >= startOfDay),
      earlier: events.filter((event) => new Date(event.timestamp) < startOfDay),
    };
  }, [query.data]);

  const openEvent = (event: ActivityEvent) => {
    if (event.target.kind === "change-request") {
      router.push({ pathname: "/change-requests/[id]", params: { id: event.target.id } });
    } else if (event.target.kind === "record") {
      router.push({ pathname: "/records/[id]", params: { id: event.target.id } });
    }
  };

  const renderRow = (event: ActivityEvent, index: number, total: number) => {
    const meta = toneMeta[event.tone] ?? { label: "Activity", icon: CircleDot };
    const Icon = meta.icon;
    return (
      <NativeRow
        key={event.id}
        title={event.title}
        subtitle={event.body}
        meta={formatDate(event.timestamp)}
        leading={<Icon size={18} color={tokens.mutedForeground} />}
        onPress={event.target.kind === "none" ? undefined : () => openEvent(event)}
        last={index === total - 1}
      />
    );
  };

  return (
    <DrawerScaffold
      title="Activity"
      subtitle="Review, merge, and audit events"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      {query.isLoading ? <NativeLoadingState label="Loading activity" /> : null}
      {query.error ? (
        <NativeErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      ) : null}
      {!query.isLoading && !query.error && (query.data?.length ?? 0) === 0 ? (
        <NativeEmptyState
          title="No activity yet"
          description="Change requests, merges, records, and audit events will appear here."
        />
      ) : null}
      {today.length > 0 ? (
        <NativeSection title="Today" caption={`${today.length}`}>
          {today.map((event, index) => renderRow(event, index, today.length))}
        </NativeSection>
      ) : null}
      {earlier.length > 0 ? (
        <NativeSection title="Earlier" caption={`${earlier.length}`}>
          {earlier.map((event, index) => renderRow(event, index, earlier.length))}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

export default function ActivityScreen() {
  return (
    <ConnectionGuard>
      <ActivityContent />
    </ConnectionGuard>
  );
}
