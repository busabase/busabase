import { useLocalSearchParams } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { Pressable, StyleSheet } from "react-native";
import { NativeEmptyState, NativeLoadingState } from "~/components/native-screen";
import { ConnectionGuard } from "~/domains/workspace/components/ConnectionGuard";
import { DrawerScaffold } from "~/domains/workspace/components/DrawerScaffold";
import { mobile, radius } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import { useBaseDesignController } from "../hooks/use-base-design-controller";
import { BaseDesignDialogs } from "./BaseDesignDialogs";
import { BaseDesignFieldSheet } from "./BaseDesignFieldSheet";
import { BaseDesignSections } from "./BaseDesignSections";

function BaseDesignContent() {
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : "";
  const tokens = useTokens();
  const controller = useBaseDesignController(slug);
  const headerLeading = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      hitSlop={mobile.hitSlop}
      style={[styles.backButton, { backgroundColor: tokens.primaryMuted }]}
      onPress={controller.goBack}
    >
      <ArrowLeft size={22} color={tokens.foreground} />
    </Pressable>
  );

  if (controller.basesQuery.isLoading) {
    return (
      <DrawerScaffold title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeLoadingState label="Loading base" />
      </DrawerScaffold>
    );
  }
  if (!controller.base) {
    return (
      <DrawerScaffold title="Base design" subtitle={slug} headerLeading={headerLeading}>
        <NativeEmptyState title="Base not found" description="This base is not available." />
      </DrawerScaffold>
    );
  }

  return (
    <DrawerScaffold
      title={`${controller.base.name} design`}
      titleNumberOfLines={2}
      subtitle={`${controller.base.fields.length} fields`}
      headerLeading={headerLeading}
    >
      <BaseDesignSections controller={controller} />
      <BaseDesignFieldSheet controller={controller} />
      <BaseDesignDialogs controller={controller} />
    </DrawerScaffold>
  );
}

export default function BaseDesignScreen() {
  return (
    <ConnectionGuard>
      <BaseDesignContent />
    </ConnectionGuard>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
});
