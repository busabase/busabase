import Constants from "expo-constants";
import { Platform } from "react-native";
import { z } from "zod";
import { busabaseConfig } from "~/connection/config";

const MobileDownloadAssetSchema = z.object({
  name: z.string().optional(),
  kind: z.string().optional(),
  size: z.number().optional(),
  url: z.string().url(),
});

const MobileDownloadPlatformSchema = z.object({
  id: z.string().optional(),
  os: z.string().optional(),
  arch: z.string().optional(),
  title: z.string().optional(),
  primary: MobileDownloadAssetSchema.optional().nullable(),
  assets: z.array(MobileDownloadAssetSchema).optional(),
  url: z.string().url().optional(),
});

const VersionRuleSchema = z.object({
  platform: z.enum(["android", "ios", "all"]).optional(),
  versionRange: z.string(),
});

const ReviewBuildSchema = z.object({
  platform: z.enum(["android", "ios", "all"]).optional(),
  version: z.string().optional(),
  build: z.union([z.string(), z.number()]).optional(),
  versionRange: z.string().optional(),
  buildRange: z.string().optional(),
  disabledFeatures: z.array(z.string()).default([]),
});

export const MobileUpdateManifestSchema = z.object({
  version: z.string().optional(),
  releaseName: z.string().optional(),
  platforms: z.record(z.string(), MobileDownloadPlatformSchema).optional(),
  mobilePolicy: z
    .object({
      minSupportedVersion: z.string().optional(),
      forceUpdate: z.array(VersionRuleSchema).default([]),
      optionalUpdate: z.array(VersionRuleSchema).default([]),
      reviewBuilds: z.array(ReviewBuildSchema).default([]),
    })
    .optional(),
});

export type MobileUpdateManifest = z.infer<typeof MobileUpdateManifestSchema>;
type MobileDownloadPlatform = z.infer<typeof MobileDownloadPlatformSchema>;

export type MobileFeatureKey =
  | "cloudLogin"
  | "demoServer"
  | "externalAgentManifest"
  | "notifications"
  | "payments";

export type MobilePlatform = "android" | "ios";

export interface CurrentMobileVersion {
  platform: MobilePlatform;
  version: string;
  build: string | null;
}

export type MobileUpdateAction = "none" | "optional" | "force";

export interface MobileUpdateDecision {
  action: MobileUpdateAction;
  downloadUrl: string | null;
  latestVersion: string | null;
  latestBuild: string | null;
  releaseName: string | null;
  disabledFeatures: Set<string>;
  isReviewBuild: boolean;
}

export const getCurrentMobileVersion = (): CurrentMobileVersion => {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const build =
    Constants.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    Constants.expoConfig?.android?.versionCode?.toString() ??
    null;

  return {
    platform,
    version: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "0.0.0",
    build: build ? String(build) : null,
  };
};

export async function fetchMobileUpdateManifest(
  manifestUrl = busabaseConfig.updateManifestUrl,
): Promise<MobileUpdateManifest> {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Update manifest request failed: ${response.status}`);
  }

  return MobileUpdateManifestSchema.parse(await response.json());
}

export function resolveMobileUpdateDecision(
  manifest: MobileUpdateManifest,
  current: CurrentMobileVersion = getCurrentMobileVersion(),
): MobileUpdateDecision {
  const platform = manifest.platforms?.[current.platform];
  const latestVersion = manifest.version ?? null;
  const latestBuild = getPlatformBuild(platform);
  const downloadUrl = getPlatformDownloadUrl(manifest, current.platform);
  const forceUpdate =
    matchesAnyVersionRule(manifest.mobilePolicy?.forceUpdate, current) ||
    (!!manifest.mobilePolicy?.minSupportedVersion &&
      compareVersions(current.version, manifest.mobilePolicy.minSupportedVersion) < 0);
  const optionalUpdate =
    !forceUpdate &&
    (matchesAnyVersionRule(manifest.mobilePolicy?.optionalUpdate, current) ||
      (!!latestVersion && compareVersions(current.version, latestVersion) < 0));
  const reviewBuild = findReviewBuild(manifest, current);
  const disabledFeatures = new Set(reviewBuild?.disabledFeatures ?? []);

  return {
    action: forceUpdate ? "force" : optionalUpdate ? "optional" : "none",
    downloadUrl,
    latestVersion,
    latestBuild,
    releaseName: manifest.releaseName ?? null,
    disabledFeatures,
    isReviewBuild: !!reviewBuild,
  };
}

export function isMobileFeatureEnabled(
  decision: MobileUpdateDecision | null,
  feature: MobileFeatureKey,
) {
  return !decision?.disabledFeatures.has(feature);
}

function getPlatformDownloadUrl(manifest: MobileUpdateManifest, platform: MobilePlatform) {
  const value = manifest.platforms?.[platform];
  if (platform === "android") {
    const googlePlayUrl = value?.assets?.find((asset) => asset.kind === "google-play")?.url;
    if (googlePlayUrl) return googlePlayUrl;
  }

  return value?.primary?.url ?? value?.url ?? value?.assets?.[0]?.url ?? null;
}

function getPlatformBuild(platform: MobileDownloadPlatform | undefined) {
  const packageAsset =
    platform?.primary?.kind === "apk" || platform?.primary?.kind === "ipa"
      ? platform.primary
      : platform?.assets?.find((asset) => asset.kind === "apk" || asset.kind === "ipa");

  return getBuildFromAssetName(packageAsset?.name);
}

function findReviewBuild(manifest: MobileUpdateManifest, current: CurrentMobileVersion) {
  return manifest.mobilePolicy?.reviewBuilds.find((rule) => {
    if (!matchesPlatform(rule.platform, current.platform)) return false;
    if (rule.version && rule.version !== current.version) return false;
    if (rule.build !== undefined && String(rule.build) !== String(current.build ?? ""))
      return false;
    if (rule.versionRange && !satisfiesVersionRange(current.version, rule.versionRange))
      return false;
    if (rule.buildRange && !satisfiesBuildRange(current.build, rule.buildRange)) return false;
    return true;
  });
}

function matchesAnyVersionRule(
  rules: Array<{ platform?: "android" | "ios" | "all"; versionRange: string }> | undefined,
  current: CurrentMobileVersion,
) {
  return !!rules?.some(
    (rule) =>
      matchesPlatform(rule.platform, current.platform) &&
      satisfiesVersionRange(current.version, rule.versionRange),
  );
}

function matchesPlatform(rulePlatform: "android" | "ios" | "all" | undefined, platform: string) {
  return !rulePlatform || rulePlatform === "all" || rulePlatform === platform;
}

function satisfiesBuildRange(build: string | null, range: string) {
  if (!build) return false;
  const current = Number(build);
  if (!Number.isFinite(current)) return false;

  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const match = part.match(/^(<=|>=|<|>|=)?(\d+)$/);
      if (!match) return false;
      const operator = match[1] ?? "=";
      const target = Number(match[2]);
      if (operator === "<") return current < target;
      if (operator === "<=") return current <= target;
      if (operator === ">") return current > target;
      if (operator === ">=") return current >= target;
      return current === target;
    });
}

function satisfiesVersionRange(version: string, range: string) {
  return range
    .trim()
    .split(/\s+/)
    .every((part) => {
      const match = part.match(/^(<=|>=|<|>|=)?(.+)$/);
      if (!match) return false;
      const operator = match[1] ?? "=";
      const target = normalizeVersion(match[2]);
      const current = normalizeVersion(version);
      const compared = compareVersions(current, target);

      if (operator === "<") return compared < 0;
      if (operator === "<=") return compared <= 0;
      if (operator === ">") return compared > 0;
      if (operator === ">=") return compared >= 0;
      return compared === 0;
    });
}

export function compareVersions(left: string, right: string) {
  const a = normalizeVersion(left).split(".").map(Number);
  const b = normalizeVersion(right).split(".").map(Number);
  const length = Math.max(a.length, b.length, 3);

  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }

  return 0;
}

function normalizeVersion(value: string) {
  const core = value.trim().replace(/^v/, "").split(/[+-]/)[0];
  return core
    .split(".")
    .map((part) => {
      const number = Number.parseInt(part, 10);
      return Number.isFinite(number) ? String(number) : "0";
    })
    .join(".");
}

function getBuildFromAssetName(name: string | undefined) {
  const match = name?.match(/-(\d+)\.(apk|ipa)$/i);
  return match?.[1] ?? null;
}
