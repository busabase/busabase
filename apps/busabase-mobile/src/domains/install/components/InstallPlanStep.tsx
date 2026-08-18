import { StyleSheet, Text, View } from "react-native";
import { NativeLoadingState, NativeRow } from "~/components/native-screen";
import { TextInput } from "~/components/ui/TextInput";
import { nodeIconForType } from "~/domains/workspace/components/node-icons";
import { fmt, useI18n } from "~/i18n";
import { radius, spacing, typography } from "~/theme/tokens";
import { useTokens } from "~/theme/use-tokens";
import type { InstallFromGithubFlow } from "../hooks/use-install-from-github";
import {
  getInstallCollisionLines,
  getInstallNodeSummary,
  getInstallPackageMeta,
  getInstallSourceLine,
} from "../utils/install-display";
import { InstallCheckMark, InstallNotice, installPanelStyle } from "./InstallNotice";

export function InstallPlanStep({ flow }: { flow: InstallFromGithubFlow }) {
  const { t } = useI18n();
  const tokens = useTokens();
  const plan = flow.plan;

  return (
    <>
      <TextInput
        label={t.install.repoUrl}
        value={flow.repoUrl}
        placeholder={t.install.repoUrlPlaceholder}
        keyboardType="url"
        autoCapitalize="none"
        autoCorrect={false}
        editable={!flow.planning && !flow.installing}
        returnKeyType="go"
        onSubmitEditing={() => {
          if (!plan) flow.preview();
        }}
        onChangeText={flow.setRepoUrl}
      />
      <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
        {t.install.repoUrlHint}
      </Text>

      {flow.planning ? <NativeLoadingState label={t.install.previewing} /> : null}
      {flow.installing ? <NativeLoadingState label={t.install.installingHint} /> : null}

      {plan && !flow.installing ? (
        <>
          <View
            style={[styles.panel, { borderColor: tokens.border, backgroundColor: tokens.muted }]}
          >
            <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
              {plan.package.name}
            </Text>
            {plan.package.description ? (
              <Text style={[typography.small, { color: tokens.mutedForeground }]}>
                {plan.package.description}
              </Text>
            ) : null}
            {getInstallPackageMeta(plan, t.install).length > 0 ? (
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {getInstallPackageMeta(plan, t.install).join(" · ")}
              </Text>
            ) : null}
            <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
              {`${t.install.source}: ${getInstallSourceLine(plan, t.install)}`}
            </Text>
          </View>

          <Text style={[typography.bodyEm, { color: tokens.foreground }]}>
            {t.install.contents}
          </Text>
          {plan.nodes.length === 0 ? (
            <Text style={[typography.small, { color: tokens.mutedForeground }]}>
              {t.install.emptyPackage}
            </Text>
          ) : (
            <>
              <View style={[styles.panel, { borderColor: tokens.border }]}>
                {plan.nodes.map((node) => {
                  const Icon = nodeIconForType(node.type);
                  const summary = getInstallNodeSummary(node, t.install);
                  return (
                    <View
                      key={node.path}
                      style={[styles.treeRow, { paddingLeft: node.depth * 14 }]}
                    >
                      <Icon size={14} color={tokens.mutedForeground} />
                      <Text
                        numberOfLines={1}
                        style={[typography.small, styles.treeName, { color: tokens.foreground }]}
                      >
                        {node.name}
                      </Text>
                      <Text
                        numberOfLines={1}
                        style={[
                          typography.caption,
                          styles.treeMeta,
                          { color: tokens.mutedForeground },
                        ]}
                      >
                        {summary ?? node.slug}
                      </Text>
                    </View>
                  );
                })}
              </View>
              <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
                {fmt(t.install.countsSummary, {
                  folders: plan.counts.folders,
                  docs: plan.counts.docs,
                  bases: plan.counts.bases,
                  records: plan.counts.records,
                  files: plan.counts.files,
                })}
              </Text>
            </>
          )}

          {plan.collisions.length > 0 ? (
            <InstallNotice
              danger={flow.unresolvedCollisions.length > 0}
              lines={getInstallCollisionLines(plan, t.install)}
              body={t.install.collisionsBody}
              title={t.install.collisionsTitle}
            />
          ) : null}

          {plan.warnings.length > 0 ? (
            <InstallNotice lines={plan.warnings} title={t.install.warningsTitle} />
          ) : null}

          <TextInput
            label={t.install.targetFolder}
            value={flow.intoFolder}
            editable={!flow.planning && !flow.installing}
            onChangeText={flow.setIntoFolder}
            onBlur={flow.previewTargetFolderIfChanged}
          />
          <Text style={[typography.caption, { color: tokens.mutedForeground }]}>
            {t.install.targetFolderHint}
          </Text>

          {plan.collisions.length > 0 ? (
            <View style={[styles.toggle, { borderColor: tokens.border }]}>
              <NativeRow
                title={t.install.rename}
                subtitle={t.install.renameHint}
                disabled={flow.planning || flow.installing}
                trailing={<InstallCheckMark checked={flow.rename} />}
                last
                onPress={flow.toggleRename}
              />
            </View>
          ) : null}

          {plan.requiresAutoMerge ? (
            <InstallNotice
              body={t.install.autoMergeRequiredBody}
              danger
              title={t.install.autoMergeRequiredTitle}
            />
          ) : null}

          <View style={[styles.toggle, { borderColor: tokens.border }]}>
            <NativeRow
              title={t.install.autoMerge}
              subtitle={t.install.autoMergeBody}
              disabled={flow.installing}
              trailing={<InstallCheckMark checked={flow.autoMerge} />}
              last
              onPress={() => flow.setAutoMerge((current) => !current)}
            />
          </View>
        </>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  panel: installPanelStyle,
  treeRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  treeName: { flexShrink: 1, minWidth: 0 },
  treeMeta: { flexShrink: 0 },
  toggle: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
});
