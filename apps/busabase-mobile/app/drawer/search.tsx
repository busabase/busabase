import type { SearchResultVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeEmptyState } from "~/components/native-screen";
import { TextInput } from "~/components/ui/TextInput";
import { radius, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const kindLabel: Record<SearchResultVO["kind"], string> = {
  record: "Record",
  change_request: "Change request",
  base: "Base",
};

const DEBOUNCE_MS = 220;

function SearchContent() {
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultVO[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (!buda || !trimmed) {
      setResults([]);
      setSearching(false);
      setError(null);
      return;
    }
    setSearching(true);
    const current = ++requestId.current;
    const timer = setTimeout(() => {
      buda.client
        .search({ query: trimmed, limit: 20, offset: 0 })
        .then((response) => {
          if (current === requestId.current) {
            setResults(response.results);
            setError(null);
          }
        })
        .catch((caught) => {
          if (current === requestId.current) {
            setError(caught instanceof Error ? caught.message : "Search failed");
          }
        })
        .finally(() => {
          if (current === requestId.current) {
            setSearching(false);
          }
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [buda, query]);

  const openResult = useCallback(
    (result: SearchResultVO) => {
      if (result.kind === "record") {
        router.push({ pathname: "/records/[id]", params: { id: result.id } });
      } else if (result.kind === "change_request") {
        router.push({ pathname: "/change-requests/[id]", params: { id: result.id } });
      } else {
        // Base results carry a web href like "/base/{slug}"; derive the slug.
        const slug = result.href.split("/").filter(Boolean).pop() ?? result.id;
        router.push({ pathname: "/base/[slug]", params: { slug } });
      }
    },
    [router],
  );

  const hasQuery = query.trim().length > 0;

  return (
    <DrawerScaffold title="Search" subtitle="Records, change requests, and Bases">
      <View style={styles.searchBox}>
        <TextInput
          label="Search"
          value={query}
          autoFocus
          placeholder="Search records, change requests, Bases"
          returnKeyType="search"
          onChangeText={setQuery}
        />
      </View>

      {error ? (
        <Text style={[typography.small, styles.message, { color: tokens.destructive }]}>
          {error}
        </Text>
      ) : null}

      {searching ? (
        <View style={styles.loading}>
          <ActivityIndicator color={tokens.primary} />
        </View>
      ) : null}

      {!searching && hasQuery && results.length === 0 && !error ? (
        <NativeEmptyState
          title="No matches"
          description="Try a title, field value, or Base name."
        />
      ) : null}

      {!hasQuery ? (
        <NativeEmptyState
          title="Search Busabase"
          description="Find records, change requests, and Bases across the connected server."
        />
      ) : null}

      <View style={styles.list}>
        {results.map((result) => (
          <Pressable
            key={`${result.kind}-${result.id}`}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              {
                backgroundColor: tokens.card,
                borderColor: tokens.border,
                opacity: pressed ? 0.78 : 1,
              },
            ]}
            onPress={() => openResult(result)}
          >
            <View style={[styles.kind, { backgroundColor: tokens.muted }]}>
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {kindLabel[result.kind]}
              </Text>
            </View>
            <Text numberOfLines={1} style={[typography.bodyEm, { color: tokens.foreground }]}>
              {result.title}
            </Text>
            {result.eyebrow ? (
              <Text numberOfLines={1} style={[typography.small, { color: tokens.mutedForeground }]}>
                {result.eyebrow}
              </Text>
            ) : null}
            {result.body ? (
              <Text numberOfLines={2} style={[typography.small, { color: tokens.mutedForeground }]}>
                {result.body}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </DrawerScaffold>
  );
}

export default function SearchScreen() {
  return (
    <ConnectionGuard>
      <SearchContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  searchBox: { marginHorizontal: 20, marginBottom: 8 },
  message: { marginHorizontal: 20, marginBottom: 8 },
  loading: { paddingVertical: 16 },
  list: { marginHorizontal: 20, gap: 10 },
  row: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: 14,
    gap: 4,
  },
  kind: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 3,
    marginBottom: 2,
  },
});
