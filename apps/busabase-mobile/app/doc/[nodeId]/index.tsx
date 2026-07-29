import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, ChevronUp, Pencil } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { useI18n } from "~/i18n";
import { formatDate } from "~/lib/format";
import { asNodeDetail } from "~/lib/node-detail";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const COLLAPSED_BODY_LINES = 12;

function getDocBodyStats(body: string) {
  const trimmed = body.trim();
  const empty = trimmed.length === 0;
  const lineCount = body.length === 0 ? 0 : body.split(/\r\n|\r|\n/).length;

  return {
    empty,
    lineCount,
    text: empty ? "Empty doc." : body,
  };
}

function DocDetailContent() {
  const params = useLocalSearchParams<{ nodeId?: string }>();
  const nodeId = typeof params.nodeId === "string" ? params.nodeId : "";
  const tokens = useTokens();
  const router = useRouter();
  const { t } = useI18n();
  const buda = useBusabaseOrpc();
  const [bodyExpanded, setBodyExpanded] = useState(false);

  const docQuery = useQuery(
    buda && nodeId
      ? buda.orpc.nodes.get.queryOptions({ input: { nodeId, type: "doc" } })
      : { queryKey: ["no-connection", "doc", nodeId], queryFn: skipToken },
  );
  // `nodes.get` answers for every node type, so narrow before reading `.body`.
  // A `nodeId` that is really a slug shared with another type resolves to that
  // other type's detail here; `asNodeDetail` turns that into the same
  // "Doc not found" empty state below rather than a blank body.
  const doc = asNodeDetail(docQuery.data, "doc");
  const bodyStats = doc ? getDocBodyStats(doc.body) : null;
  const isLongBody = (bodyStats?.lineCount ?? 0) > COLLAPSED_BODY_LINES;

  return (
    <DrawerScaffold
      subtitle={doc?.node.description || undefined}
      title={doc?.node.name ?? "Doc"}
      titleNumberOfLines={2}
      refreshing={docQuery.isRefetching}
      onRefresh={() => void docQuery.refetch()}
      footer={
        doc ? (
          <NativeActionBar>
            <Button
              label={t.common.edit}
              variant="secondary"
              fullWidth
              leadingIcon={<Pencil size={18} color={tokens.foreground} />}
              onPress={() => router.push({ pathname: "/doc/[nodeId]/edit", params: { nodeId } })}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {docQuery.isLoading ? <NativeLoadingState label="Loading doc" /> : null}
      {docQuery.error ? (
        <NativeErrorState
          message={docQuery.error.message}
          onRetry={() => void docQuery.refetch()}
        />
      ) : null}
      {!docQuery.isLoading && !docQuery.error && !doc ? (
        <NativeEmptyState title="Doc not found" />
      ) : null}

      {doc ? (
        <NativeSection title="Content" caption={formatDate(doc.node.updatedAt)}>
          <View style={styles.bodyWrap}>
            <Text
              selectable
              numberOfLines={isLongBody && !bodyExpanded ? COLLAPSED_BODY_LINES : undefined}
              style={[
                typography.body,
                styles.body,
                { color: bodyStats?.empty ? tokens.mutedForeground : tokens.foreground },
              ]}
            >
              {bodyStats?.text}
            </Text>
          </View>
          {isLongBody ? (
            <NativeRow
              title={bodyExpanded ? "Show less" : "Show more"}
              leading={
                bodyExpanded ? (
                  <ChevronUp size={18} color={tokens.mutedForeground} />
                ) : (
                  <ChevronDown size={18} color={tokens.mutedForeground} />
                )
              }
              last
              onPress={() => setBodyExpanded((current) => !current)}
            />
          ) : null}
        </NativeSection>
      ) : null}
    </DrawerScaffold>
  );
}

export default function DocDetailScreen() {
  return (
    <ConnectionGuard>
      <DocDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  bodyWrap: { paddingHorizontal: 14, paddingVertical: 12 },
  body: { lineHeight: 22 },
});
