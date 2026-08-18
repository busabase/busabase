import { StyleSheet, View } from "react-native";
import { NativeActionBar, NativeInlineError } from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { TextInput } from "~/components/ui/TextInput";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { spacing } from "~/theme/tokens";
import { useSearchController } from "../hooks/use-search-controller";
import { SearchResultsList } from "./SearchResultsList";
import { SearchTabs } from "./SearchTabs";

function SearchContent() {
  const search = useSearchController();

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

      {search.displayedError ? (
        <View style={styles.message}>
          <NativeInlineError message={search.displayedError} onReset={search.resetError} />
        </View>
      ) : null}

      <SearchResultsList
        contentResults={search.contentResults}
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
  searchBox: { marginHorizontal: spacing[5], marginBottom: spacing[2] },
  message: { marginHorizontal: spacing[5], marginBottom: spacing[2] },
  loadMore: { marginHorizontal: spacing[5], marginTop: spacing[1] },
});
