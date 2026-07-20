import { skipToken, useQuery } from "@tanstack/react-query";
import type { SearchResultKind, SearchResultVO } from "busabase-contract/types";
import { useRouter } from "expo-router";
import { AppWindow, File, FileText, GitPullRequest, Search, Table2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useBusabaseOrpc } from "~/api/use-busabase-orpc";
import { ConnectionGuard } from "~/components/busabase/ConnectionGuard";
import { DrawerScaffold } from "~/components/busabase/DrawerScaffold";
import {
  NativeActionBar,
  NativeChipList,
  NativeInlineError,
  NativeRow,
  NativeSection,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";

// `kind: "file"` is a catch-all bucket shared by several href-distinguished node
// types (see fileResultHref in busabase-core). Icons/labels below key off that
// shared "file" kind since SearchResultVO has no separate kind for doc/airapp.
const kindMeta: Record<SearchResultVO["kind"], { label: string; icon: typeof FileText }> = {
  record: { label: "Record", icon: FileText },
  change_request: { label: "Change request", icon: GitPullRequest },
  base: { label: "Base", icon: Table2 },
  file: { label: "File", icon: File },
};

// Href-prefix-specific overrides for "file"-kind results, applied after the
// generic kindMeta lookup (see openResult below for the matching href parsing).
const filePrefixMeta: Record<string, { label: string; icon: typeof FileText }> = {
  doc: { label: "Doc", icon: FileText },
  airapp: { label: "AirApp", icon: AppWindow },
};

const getResultMeta = (result: SearchResultVO): { label: string; icon: typeof FileText } => {
  if (result.kind === "file") {
    const prefix = result.href.split("/").filter(Boolean)[0];
    const override = prefix ? filePrefixMeta[prefix] : undefined;
    if (override) {
      return override;
    }
  }
  return kindMeta[result.kind];
};

const DEBOUNCE_MS = 180;
const PAGE_SIZE = 20;

// Mirrors web's SearchDialog category tabs (search-dialog.tsx) — same tab
// set, same "All excludes change_request" rule, same per-tab result count
// derived client-side from one fetched page (not a separate server count).
type SearchTab = "all" | "records" | "bases" | "files" | "change_requests";
const SEARCH_TABS: { value: SearchTab; label: string }[] = [
  { value: "all", label: "All" },
  { value: "records", label: "Records" },
  { value: "bases", label: "Bases" },
  { value: "files", label: "Files" },
  { value: "change_requests", label: "Change requests" },
];
const TAB_KIND: Record<SearchTab, SearchResultKind | null> = {
  all: null,
  records: "record",
  bases: "base",
  files: "file",
  change_requests: "change_request",
};

function SearchContent() {
  const router = useRouter();
  const tokens = useTokens();
  const buda = useBusabaseOrpc();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [error, setError] = useState<string | null>(null);

  const hasQuery = debouncedQuery.length > 0;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setLimit(PAGE_SIZE);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const searchQuery = useQuery(
    buda
      ? {
          ...buda.orpc.search.queryOptions({ input: { query: debouncedQuery, limit, offset: 0 } }),
          enabled: hasQuery,
        }
      : { queryKey: ["no-connection", "search"], queryFn: skipToken },
  );
  const allResults = searchQuery.data?.results ?? [];
  const hasMore = searchQuery.data?.hasMore ?? false;
  const searching = searchQuery.isFetching;

  const visibleResults = useMemo(() => {
    if (tab === "all") {
      return allResults.filter((result) => result.kind !== "change_request");
    }
    const kind = TAB_KIND[tab];
    return kind ? allResults.filter((result) => result.kind === kind) : allResults;
  }, [allResults, tab]);

  const tabOptions = useMemo(
    () =>
      SEARCH_TABS.map(({ value, label }) => {
        if (!hasQuery) {
          return { value, label };
        }
        const kind = TAB_KIND[value];
        const count =
          value === "all"
            ? allResults.filter((result) => result.kind !== "change_request").length
            : kind
              ? allResults.filter((result) => result.kind === kind).length
              : allResults.length;
        return { value, label, meta: count > 0 ? count : undefined };
      }),
    [allResults, hasQuery],
  );

  const openResult = useCallback(
    (result: SearchResultVO) => {
      if (result.kind === "record") {
        router.push({ pathname: "/records/[id]", params: { id: result.id } });
      } else if (result.kind === "change_request") {
        router.push({ pathname: "/change-requests/[id]", params: { id: result.id } });
      } else if (result.kind === "base") {
        // Base results carry a web href like "/base/{slug}"; derive the slug.
        const slug = result.href.split("/").filter(Boolean).pop() ?? result.id;
        router.push({ pathname: "/base/[slug]", params: { slug } });
      } else {
        const parts = result.href.split("/").filter(Boolean);
        const [kind, id] = parts;
        if (kind === "drive" && id) {
          router.push({ pathname: "/drive/[nodeId]", params: { nodeId: id } });
        } else if (kind === "skill" && id) {
          router.push({ pathname: "/skill/[nodeId]", params: { nodeId: id } });
        } else if (kind === "doc" && id) {
          router.push({ pathname: "/doc/[nodeId]", params: { nodeId: id } });
        } else if (kind === "airapp" && id) {
          // AirApp detail screen ("app/airapp/[nodeId]") is landing in a
          // parallel change on this branch — wire the navigation now so it
          // lights up as soon as that route exists.
          router.push({ pathname: "/airapp/[nodeId]", params: { nodeId: id } });
        } else if (kind === "assets" && id) {
          router.push({ pathname: "/assets/[id]", params: { id } });
        } else if (kind === "file" && id) {
          // Standalone File nodes have no dedicated mobile detail screen yet.
          // Surface inline feedback and stay on the search screen instead of
          // falling through to the (wrong) assets list screen.
          setError("This file type isn't viewable on mobile yet.");
        } else {
          router.push("/drawer/assets");
        }
      }
    },
    [router],
  );

  const searchErrorMessage = searchQuery.isError
    ? searchQuery.error instanceof Error
      ? searchQuery.error.message
      : "Search failed"
    : null;
  const displayedError = error ?? searchErrorMessage;
  const resetError = useCallback(() => {
    setError(null);
    if (searchErrorMessage) {
      void searchQuery.refetch();
    }
  }, [searchErrorMessage, searchQuery.refetch]);

  return (
    <DrawerScaffold title="Search" subtitle="Records, change requests, Bases, and files">
      <View style={styles.searchBox}>
        <TextInput
          label="Search"
          value={query}
          autoFocus
          placeholder="Search records, change requests, Bases, files"
          returnKeyType="search"
          onChangeText={setQuery}
        />
      </View>

      {hasQuery ? (
        <View style={styles.tabsWrap}>
          <NativeChipList value={tab} options={tabOptions} onChange={setTab} />
        </View>
      ) : null}

      {displayedError ? (
        <View style={styles.message}>
          <NativeInlineError message={displayedError} onReset={resetError} />
        </View>
      ) : null}

      <NativeSection title={hasQuery ? "Results" : "Search"}>
        {searching && visibleResults.length === 0 ? (
          <NativeRow
            title="Searching"
            subtitle="Looking across records, change requests, Bases, and files."
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {!searching && hasQuery && visibleResults.length === 0 && !displayedError ? (
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
            subtitle="Find records, change requests, Bases, and files across the connected server."
            leading={<Search size={18} color={tokens.mutedForeground} />}
            last
          />
        ) : null}
        {visibleResults.length > 0
          ? visibleResults.map((result, index) => {
              const meta = getResultMeta(result);
              const Icon = meta.icon;
              return (
                <NativeRow
                  key={`${result.kind}-${result.id}`}
                  title={result.title}
                  subtitle={result.body || result.eyebrow || meta.label}
                  meta={meta.label}
                  leading={<Icon size={18} color={tokens.mutedForeground} />}
                  onPress={() => openResult(result)}
                  last={index === visibleResults.length - 1}
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

      {hasMore && tab !== "change_requests" ? (
        <View style={styles.loadMore}>
          <NativeActionBar>
            <Button
              label={searching ? "Loading…" : "Load more"}
              variant="secondary"
              disabled={searching}
              onPress={() => setLimit((current) => current + PAGE_SIZE)}
            />
          </NativeActionBar>
        </View>
      ) : null}
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
  tabsWrap: { marginBottom: 8 },
  message: { marginHorizontal: 20, marginBottom: 8 },
  loadMore: { marginHorizontal: 20, marginTop: 4 },
});
