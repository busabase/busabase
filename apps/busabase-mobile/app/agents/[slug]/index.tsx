import { skipToken, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { agentSessionStatusLabel } from "~/domains/agents/utils/session-status";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { fmt, useI18n } from "~/i18n";
import { formatDate } from "~/lib/format";

const SESSION_PAGE_SIZE = 20;

function AgentSessionsContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const queryClient = useQueryClient();

  const connection = useMemo(
    () =>
      buda ? buda.orpc.agents.connections.list.queryOptions({ input: { scope: "mine" } }) : null,
    [buda],
  );

  const sessionsOptions = useMemo(
    () =>
      buda
        ? buda.orpc.agents.sessions.listPaged.infiniteOptions({
            input: (cursor: string | undefined) => ({ slug, limit: SESSION_PAGE_SIZE, cursor }),
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (last: { nextCursor: string | null }) => last.nextCursor ?? undefined,
          })
        : null,
    [buda, slug],
  );
  const sessionsQuery = useInfiniteQuery(
    sessionsOptions ?? {
      queryKey: ["no-connection", "agent-sessions", slug],
      queryFn: skipToken,
      initialPageParam: undefined as string | undefined,
      getNextPageParam: () => undefined,
    },
  );
  const sessions = sessionsQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const createSessionOptions = useMemo(
    () => (buda ? buda.orpc.agents.sessions.create.mutationOptions() : null),
    [buda],
  );
  const createSession = useMutation({
    mutationFn:
      createSessionOptions?.mutationFn ?? (async () => Promise.reject(new Error("Not connected"))),
    onSuccess: (session) => {
      if (buda) void queryClient.invalidateQueries({ queryKey: buda.orpc.agents.sessions.key() });
      if (connection) void queryClient.invalidateQueries({ queryKey: connection.queryKey });
      router.push({
        pathname: "/agents/[slug]/[sessionId]",
        params: { slug, sessionId: session.id },
      });
    },
  });

  // The connections list is where a session's agent NAME lives; this screen
  // is addressed by slug alone (the route param), so it looks the name up
  // from that same "mine" query rather than fetching or duplicating it.
  const agentName =
    queryClient
      .getQueryData<Array<{ slug: string; agentName: string }>>(connection?.queryKey ?? [])
      ?.find((entry) => entry.slug === slug)?.agentName ?? slug;

  return (
    <DrawerScaffold
      title={agentName}
      refreshing={sessionsQuery.isRefetching}
      onRefresh={() => void sessionsQuery.refetch()}
      footer={
        <NativeActionBar>
          <Button
            label={t.agents.newSession}
            fullWidth
            disabled={createSession.isPending}
            onPress={() => createSession.mutate({ slug })}
          />
        </NativeActionBar>
      }
    >
      {sessionsQuery.isLoading ? <NativeLoadingState label={t.agents.title} /> : null}
      {sessionsQuery.isError ? (
        <NativeErrorState
          message={t.agents.loadSessionsFailedTitle}
          onRetry={() => void sessionsQuery.refetch()}
        />
      ) : null}
      {!sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0 ? (
        <NativeEmptyState
          title={t.agents.noSessionsTitle}
          description={fmt(t.agents.noSessionsBody, { name: agentName })}
        />
      ) : null}
      {sessions.length > 0 ? (
        <NativeSection>
          {sessions.map((session, index) => (
            <NativeRow
              key={session.id}
              title={formatDate(session.createdAt)}
              subtitle={fmt(t.agents.sessionItemLabel, {
                time: formatDate(session.lastActivityAt),
                status: agentSessionStatusLabel(session.status, t.agents),
              })}
              last={index === sessions.length - 1}
              onPress={() =>
                router.push({
                  pathname: "/agents/[slug]/[sessionId]",
                  params: { slug, sessionId: session.id },
                })
              }
            />
          ))}
          {sessionsQuery.hasNextPage ? (
            <NativeRow title="Load more" last onPress={() => void sessionsQuery.fetchNextPage()} />
          ) : null}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

export default function AgentSessionsScreen() {
  return (
    <ConnectionGuard>
      <AgentSessionsContent />
    </ConnectionGuard>
  );
}
