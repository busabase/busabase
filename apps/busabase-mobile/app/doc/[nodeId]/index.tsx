import { skipToken, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, ChevronUp, FileText, List, Pencil } from "lucide-react-native";
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
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const PREVIEW_LIMIT = 180;
const COLLAPSED_BODY_LINES = 12;

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value.toLocaleString()} ${value === 1 ? singular : plural}`;
}

function getDocBodyStats(body: string) {
  const trimmed = body.trim();
  const empty = trimmed.length === 0;
  const lineCount = body.length === 0 ? 0 : body.split(/\r\n|\r|\n/).length;
  const characterCount = Array.from(body).length;
  const normalizedPreview = trimmed.replace(/\s+/g, " ");
  const preview =
    normalizedPreview.length > PREVIEW_LIMIT
      ? `${normalizedPreview.slice(0, PREVIEW_LIMIT).trimEnd()}...`
      : normalizedPreview;

  return {
    characterCount,
    empty,
    lineCount,
    preview: empty ? "Empty doc." : preview,
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
      ? buda.orpc.docs.get.queryOptions({ input: { nodeId } })
      : { queryKey: ["no-connection", "doc", nodeId], queryFn: skipToken },
  );
  const doc = docQuery.data ?? null;
  const bodyStats = doc ? getDocBodyStats(doc.body) : null;
  const isLongBody = (bodyStats?.lineCount ?? 0) > COLLAPSED_BODY_LINES;

  return (
    <DrawerScaffold
      subtitle={doc?.node.description || "Doc"}
      title={doc?.node.name ?? "Doc"}
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
        <NativeEmptyState description="This doc is not available." title="Doc not found" />
      ) : null}

      {doc ? (
        <>
          <NativeSection title="Document">
            <NativeRow
              title={doc.node.name}
              subtitle={doc.node.description || "Storage-backed doc"}
              leading={<FileText size={18} color={tokens.mutedForeground} />}
            />
            <NativeRow title="Summary" subtitle={bodyStats?.preview} last />
          </NativeSection>
          <NativeSection title="Info">
            <NativeRow title="Updated" subtitle={formatDate(doc.node.updatedAt)} />
            <NativeRow
              title="Content"
              subtitle={`${formatCount(bodyStats?.lineCount ?? 0, "line")} · ${formatCount(
                bodyStats?.characterCount ?? 0,
                "character",
              )}`}
              leading={<List size={18} color={tokens.mutedForeground} />}
              last
            />
          </NativeSection>
          <NativeSection
            title="Body"
            caption={bodyStats?.empty ? "Empty" : formatCount(bodyStats?.lineCount ?? 0, "line")}
          >
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
                subtitle={
                  bodyExpanded
                    ? "Collapse the document body."
                    : `Show all ${formatCount(bodyStats?.lineCount ?? 0, "line")}.`
                }
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
        </>
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
