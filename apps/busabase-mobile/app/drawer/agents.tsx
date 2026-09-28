import { skipToken, useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Bot } from "lucide-react-native";
import { View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import {
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { agentSessionStatusLabel } from "~/domains/agents/utils/session-status";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { fmt, useI18n } from "~/i18n";
import { useTokens } from "~/theme/use-tokens";

function AgentsContent() {
  const router = useRouter();
  const { t } = useI18n();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();

  // "mine" only: the connections this mobile account itself made (on web or
  // desktop — connecting one is out of scope here, see AcpComposer's own
  // note). "space" (every member's connections) is a real web option this
  // screen deliberately doesn't offer yet — using a shared credential someone
  // else authorized needs its own authorization-model review, not a default.
  const connectionsQuery = useQuery(
    buda
      ? buda.orpc.agents.connections.list.queryOptions({ input: { scope: "mine" } })
      : { queryKey: ["no-connection", "agent-connections"], queryFn: skipToken },
  );
  const connections = connectionsQuery.data ?? [];

  return (
    <DrawerScaffold
      title={t.nav.agents}
      refreshing={connectionsQuery.isRefetching}
      onRefresh={() => void connectionsQuery.refetch()}
    >
      {connectionsQuery.isLoading ? <NativeLoadingState label={t.nav.agents} /> : null}
      {connectionsQuery.isError ? (
        <NativeErrorState
          message={t.agents.loadConnectionsFailedTitle}
          onRetry={() => void connectionsQuery.refetch()}
        />
      ) : null}
      {!connectionsQuery.isLoading && !connectionsQuery.isError && connections.length === 0 ? (
        <NativeEmptyState title={t.agents.mineEmptyTitle} description={t.agents.mineEmptyBody} />
      ) : null}
      {connections.length > 0 ? (
        <NativeSection>
          {connections.map((connection, index) => (
            <NativeRow
              key={connection.slug}
              title={connection.agentName}
              subtitle={
                connection.latest
                  ? fmt(t.agents.sessionItemLabel, {
                      time: connection.latest.lastActivityAt
                        ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
                            new Date(connection.latest.lastActivityAt),
                          )
                        : t.agents.notStarted,
                      status: agentSessionStatusLabel(connection.latest.status, t.agents),
                    })
                  : t.agents.notStarted
              }
              meta={fmt(t.agents.sessionCount, {
                count: connection.sessionCount,
                unit: connection.sessionCount === 1 ? t.agents.sessionOne : t.agents.sessionMany,
              })}
              leading={
                <View style={[iconStyle, { backgroundColor: tokens.muted }]}>
                  <Bot size={18} color={tokens.mutedForeground} />
                </View>
              }
              last={index === connections.length - 1}
              onPress={() =>
                router.push({ pathname: "/agents/[slug]", params: { slug: connection.slug } })
              }
            />
          ))}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

const iconStyle = {
  width: 32,
  height: 32,
  borderRadius: 8,
  alignItems: "center" as const,
  justifyContent: "center" as const,
};

export default function AgentsScreen() {
  return (
    <ConnectionGuard>
      <AgentsContent />
    </ConnectionGuard>
  );
}
