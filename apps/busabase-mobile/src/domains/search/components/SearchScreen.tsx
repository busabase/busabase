import { SlidersHorizontal } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { NativeActionBar, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useSearchController } from "../hooks/use-search-controller";
import { activeFilterCount } from "../utils/search-filters";
import { SearchFilterSheet } from "./SearchFilterSheet";
import { SearchResultsList } from "./SearchResultsList";
import { SearchTabs } from "./SearchTabs";

function SearchContent() {
  const search = useSearchController();
  const tokens = useTokens();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterCount = activeFilterCount(search.filters);

  return (
    <DrawerScaffold title="Search">
      <View style={styles.searchBox}>
        <TextInput
          accessibilityLabel="Search workspace"
          value={search.query}
          autoFocus
          placeholder="Search workspace"
          returnKeyType="search"
          onChangeText={search.setQuery}
        />
      </View>

      <SearchTabs options={search.tabOptions} selected={search.tab} onSelect={search.setTab} />

      {/* Only offered once there is something to narrow. Filtering an empty
          result set is a control that cannot do anything. */}
      {search.hasQuery && search.tab !== "recent" ? (
        <View style={styles.filterBar}>
          <Button
            label={filterCount > 0 ? `Filters · ${filterCount}` : "Filters"}
            variant="secondary"
            leadingIcon={<SlidersHorizontal size={18} color={tokens.foreground} />}
            onPress={() => setFiltersOpen(true)}
          />
          {search.filters.createdBy ? (
            <Button
              label={`By ${search.filters.createdBy} ✕`}
              variant="secondary"
              onPress={() => search.setFilters({ ...search.filters, createdBy: "" })}
            />
          ) : null}
        </View>
      ) : null}

      {search.displayedError ? (
        <View style={styles.message}>
          <NativeInlineError message={search.displayedError} onReset={search.resetError} />
        </View>
      ) : null}

      {/* The server told us it could not read all of some node's content, so an
          empty or short result set here does NOT mean the workspace lacks the
          thing. Saying so is what the contract adds this flag for — swallowing
          it turns "we did not look at all of it" into "it is not there". */}
      {search.hasQuery && search.contentTruncated ? (
        <View style={styles.message}>
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
            Some content was too long to index, so these results may be incomplete.
          </Text>
        </View>
      ) : null}

      <SearchResultsList
        contentResults={search.contentResults}
        createdByFilter={search.filters.createdBy}
        onFilterByAuthor={(actorId) => search.setFilters({ ...search.filters, createdBy: actorId })}
        displayedError={search.displayedError}
        hasQuery={search.hasQuery}
        recentResults={search.recentResults}
        searching={search.searching}
        tab={search.tab}
        onOpenKnownNode={(node) => void search.openKnownNode(node)}
        onOpenResult={(result) => void search.openResult(result)}
      />

      {search.hasQuery &&
      search.hasMore &&
      search.tab !== "recent" &&
      search.tab !== "change_requests" ? (
        <View style={styles.loadMore}>
          <NativeActionBar>
            <Button
              label={search.searching ? "Loading…" : "Load more"}
              variant="secondary"
              disabled={search.searching}
              onPress={search.loadMore}
            />
          </NativeActionBar>
        </View>
      ) : null}
      <SearchFilterSheet
        visible={filtersOpen}
        filters={search.filters}
        onChange={search.setFilters}
        onClose={() => setFiltersOpen(false)}
      />
    </DrawerScaffold>
  );
}

export function SearchScreen() {
  return (
    <ConnectionGuard>
      <SearchContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  filterBar: {
    flexDirection: "row",
    gap: spacing[2],
    marginHorizontal: spacing[5],
    marginBottom: spacing[2],
    flexWrap: "wrap",
  },
  searchBox: { marginHorizontal: spacing[5], marginBottom: spacing[2] },
  message: { marginHorizontal: spacing[5], marginBottom: spacing[2] },
  loadMore: { marginHorizontal: spacing[5], marginTop: spacing[1] },
});
