import type {
  InstallCollisionVO,
  InstallPlanNodeVO,
  InstallPlanVO,
} from "busabase-contract/domains/install/types";
import { type CoreMessages, fmt } from "~/i18n/messages";

type InstallMessages = CoreMessages["install"];

export const getInstallPackageMeta = (plan: InstallPlanVO, t: InstallMessages): string[] =>
  [
    plan.package.version ? fmt(t.packageVersion, { version: plan.package.version }) : null,
    plan.package.author ? fmt(t.packageAuthor, { author: plan.package.author }) : null,
    plan.package.license ? fmt(t.packageLicense, { license: plan.package.license }) : null,
  ].filter((entry): entry is string => entry !== null);

export const getInstallSourceLine = (plan: InstallPlanVO, t: InstallMessages): string =>
  [
    `${plan.source.owner}/${plan.source.repo}`,
    plan.source.ref ? fmt(t.sourceRef, { ref: plan.source.ref }) : null,
    plan.source.subdir ? fmt(t.sourceSubdir, { subdir: plan.source.subdir }) : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(" ");

export const getInstallNodeSummary = (
  node: InstallPlanNodeVO,
  t: InstallMessages,
): string | null => {
  if (node.type === "base") {
    return fmt(t.baseSummary, {
      fields: node.fieldCount ?? 0,
      records: node.recordCount ?? 0,
    });
  }
  return node.fileCount === undefined ? null : fmt(t.fileTreeSummary, { files: node.fileCount });
};

export const getInstallCollisionLine = (
  collision: InstallCollisionVO,
  t: InstallMessages,
): string =>
  collision.kind === "base"
    ? fmt(t.collisionBase, { slug: collision.slug })
    : fmt(t.collisionNode, { slug: collision.slug, path: collision.path });

export const getInstallCollisionLines = (plan: InstallPlanVO, t: InstallMessages): string[] =>
  plan.collisions.map((collision) =>
    [
      getInstallCollisionLine(collision, t),
      collision.renamedTo ? fmt(t.collisionRenamedTo, { renamedTo: collision.renamedTo }) : null,
    ]
      .filter((part): part is string => part !== null)
      .join(" "),
  );
