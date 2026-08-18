import { useLocalSearchParams, useRouter } from "expo-router";
import { List, MoreHorizontal, Plus, Table2 } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import {
  NativeActionBar,
  NativeEmptyState,
  NativeErrorState,
  NativeLoadingState,
  NativeSegmentedControl,
} from "~/components/native-screen";
import { Button } from "~/components/ui/Button";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { type BaseDisplayMode, useBaseDetailController } from "../hooks/use-base-detail-controller";
import { BaseActionsSheet } from "./BaseActionsSheet";
import { BaseRecordList } from "./BaseRecordList";
import { BaseRecordTable } from "./BaseRecordTable";
import { BaseViewSelector } from "./BaseViewSelector";

const DISPLAY_OPTIONS = [
  { value: "list" as const, label: "List", Icon: List },
  { value: "table" as const, label: "Table", Icon: Table2 },
];

function BaseDetailContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const router = useRouter();
  const tokens = useTokens();
  const controller = useBaseDetailController(slug);

  const openRecord = (id: string) => router.push({ pathname: "/records/[id]", params: { id } });
  const openNewRecord = () => {
    if (!controller.base) return;
    router.push({ pathname: "/base/[slug]/new", params: { slug: controller.base.slug } });
  };
  const openDesign = () => {
    if (!controller.base) return;
    controller.setActionsOpen(false);
    router.push({ pathname: "/base/[slug]/design", params: { slug: controller.base.slug } });
  };

  return (
    <DrawerScaffold
      title={controller.base?.name ?? "Base"}
      refreshing={controller.basesQuery.isRefetching || controller.recordsQuery.isRefetching}
      onRefresh={controller.refresh}
      headerAction={
        controller.base ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open base actions"
            hitSlop={mobile.hitSlop}
            style={[styles.moreButton, { backgroundColor: tokens.primaryMuted }]}
            onPress={() => controller.setActionsOpen(true)}
          >
            <MoreHorizontal size={21} color={tokens.foreground} />
          </Pressable>
        ) : undefined
      }
      footer={
        controller.base ? (
          <NativeActionBar>
            <Button
              label="New record"
              fullWidth
              leadingIcon={<Plus size={18} color={tokens.primaryForeground} />}
              onPress={openNewRecord}
            />
          </NativeActionBar>
        ) : undefined
      }
    >
      {controller.loading ? <NativeLoadingState label="Loading base" /> : null}
      {controller.error ? (
        <NativeErrorState message={controller.error.message} onRetry={controller.refresh} />
      ) : null}
      {!controller.loading && !controller.error && !controller.base ? (
        <NativeEmptyState title="Base not found" description="This base is not available." />
      ) : null}

      {controller.base ? (
        <>
          <BaseViewSelector
            open={controller.viewPickerOpen}
            selectedId={controller.selectedViewId}
            selectedLabel={controller.selectedViewLabel}
            views={controller.views}
            onClose={() => controller.setViewPickerOpen(false)}
            onOpen={() => controller.setViewPickerOpen(true)}
            onSelect={(viewId) => {
              controller.setActiveViewId(viewId);
              controller.setViewPickerOpen(false);
            }}
          />
          <NativeSegmentedControl<BaseDisplayMode>
            value={controller.displayMode}
            options={DISPLAY_OPTIONS}
            onChange={controller.setDisplayMode}
          />

          {controller.records.length === 0 ? (
            <NativeEmptyState title="No records" />
          ) : controller.displayMode === "list" ? (
            <BaseRecordList records={controller.records} onOpenRecord={openRecord} />
          ) : (
            <BaseRecordTable
              fields={controller.previewFields}
              records={controller.records}
              onOpenRecord={openRecord}
            />
          )}

          {controller.recordsQuery.hasNextPage ? (
            <NativeActionBar>
              <Button
                label="Load more records"
                variant="secondary"
                loading={controller.recordsQuery.isFetchingNextPage}
                fullWidth
                onPress={() => void controller.recordsQuery.fetchNextPage()}
              />
            </NativeActionBar>
          ) : null}
          <BaseActionsSheet
            open={controller.actionsOpen}
            onClose={() => controller.setActionsOpen(false)}
            onEditDesign={openDesign}
          />
        </>
      ) : null}
    </DrawerScaffold>
  );
}

export default function BaseDetailScreen() {
  return (
    <ConnectionGuard>
      <BaseDetailContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
