import type { SearchResultVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { FileText, GitPullRequest, Search, Table2 } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import { NativeInlineError, NativeRow, NativeSection } from "~/components/native-screen";
import { TextInput } from "~/components/ui/TextInput";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

const kindMeta: Record<SearchResultVO["kind"], { label: string; icon: typeof FileText }> = {
  record: { label: "Record", icon: FileText },
  change_request: { label: "Change request", icon: GitPullRequest },
  base: { label: "Base", icon: Table2 },
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
        <View style={styles.message}>
          <NativeInlineError message={error} onReset={() => setError(null)} />
        </View>
      ) : null}

      <NativeSection title={hasQuery ? "Results" : "Search"}>
        {searching ? (
          <NativeRow
            title="Searching"
            subtitle="Looking across records, change requests, and Bases."
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {!searching && hasQuery && results.length === 0 && !error ? (
          <NativeRow
            title="No matches"
            subtitle="Try a title, field value, or Base name."
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {!hasQuery ? (
          <NativeRow
            title="Search Busabase"
            subtitle="Find records, change requests, and Bases across the connected server."
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {!searching && results.length > 0
          ? results.map((result, index) => {
              const meta = kindMeta[result.kind];
              const Icon = meta.icon;
              return (
                <NativeRow
                  key={`${result.kind}-${result.id}`}
                  title={result.title}
                  subtitle={result.body || result.eyebrow || meta.label}
                  meta={meta.label}
                  leading={<Icon size={18} color={tokens.mutedForeground} />}
                  onPress={() => openResult(result)}
                  last={index === results.length - 1}
                >
                  {result.eyebrow && result.body ? (
                    <Text
                      numberOfLines={1}
                      style={[typography.caption, { color: tokens.mutedForeground }]}
                    >
                      {result.eyebrow}
                    </Text>
                  ) : null}
                </NativeRow>
              );
            })
          : null}
      </NativeSection>
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
});
