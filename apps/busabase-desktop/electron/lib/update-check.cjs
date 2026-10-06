"use strict";

// Update discovery for the UOS build. Mirrors src-tauri/src/updater.rs:
// compare semver first, and when major/minor/patch/pre are equal compare the
// 12-digit build time carried in the `+yyyyMMddHHmm` build metadata.
//
// The UOS build does not self-install: replacing a root-owned .deb needs the
// system package manager (and on UOS, its signature checks), so the shell only
// tells the user a newer package exists and opens its download URL.

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

const parseVersion = (value) => {
  if (typeof value !== "string") return null;
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, major, minor, patch, pre = "", build = ""] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    pre,
    buildTime: /^\d{12}$/.test(build) ? Number(build) : 0,
  };
};

const comparePre = (a, b) => {
  if (a === b) return 0;
  // A release (no pre-release tag) sorts above any pre-release of the same version.
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
};

const isNewerVersion = (currentRaw, remoteRaw, fallbackBuildTime) => {
  const current = parseVersion(currentRaw);
  const remote = parseVersion(remoteRaw);
  if (!current || !remote) return false;

  for (const key of ["major", "minor", "patch"]) {
    if (remote[key] !== current[key]) return remote[key] > current[key];
  }
  const pre = comparePre(remote.pre, current.pre);
  if (pre !== 0) return pre > 0;

  const currentBuild =
    current.buildTime || (/^\d{12}$/.test(fallbackBuildTime ?? "") ? Number(fallbackBuildTime) : 0);
  return remote.buildTime > currentBuild;
};

/** Pick the UOS platform entry out of the published latest.json manifest. */
const pickPlatformRelease = (manifest, platformId) => {
  const platform = manifest?.platforms?.[platformId];
  const url = platform?.primary?.url ?? platform?.url;
  const version = manifest?.version;
  if (typeof url !== "string" || typeof version !== "string") return null;
  if (!url.startsWith("https://")) return null;
  return { version, url };
};

module.exports = { isNewerVersion, parseVersion, pickPlatformRelease };
