"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

interface DownloadAsset {
  name: string;
  kind: string;
  size: number;
  url: string;
  key?: string;
}

interface DownloadPlatform {
  id: string;
  os: string;
  arch: string;
  title: string;
  description?: string;
  primary?: DownloadAsset | null;
  assets?: DownloadAsset[];
}

interface DownloadPrimaryCtaProps {
  platforms?: Record<string, DownloadPlatform>;
  label: string;
}

interface NavigatorUAData {
  architecture?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
}

const preferredPlatformOrder = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
  "linux-x86_64",
];

async function getUserAgentArchitecture() {
  if (!("userAgentData" in navigator)) return "";

  const userAgentData = navigator.userAgentData as NavigatorUAData | undefined;
  const highEntropyValues = await userAgentData?.getHighEntropyValues?.(["architecture"]);
  return (highEntropyValues?.architecture ?? userAgentData?.architecture ?? "").toLowerCase();
}

async function getApplePlatformId() {
  const architecture = await getUserAgentArchitecture();
  if (architecture === "arm" || architecture === "arm64") return "darwin-aarch64";
  if (architecture === "x86" || architecture === "x86_64") return "darwin-x86_64";

  const platform = navigator.platform.toLowerCase();
  if (platform.includes("arm")) return "darwin-aarch64";
  if (platform.includes("intel")) return "darwin-x86_64";

  return "darwin-aarch64";
}

async function detectPlatformId() {
  const userAgent = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();
  const isMac = platform.includes("mac") || userAgent.includes("mac os x");

  if (isMac) return getApplePlatformId();
  if (userAgent.includes("windows") || platform.includes("win")) return "windows-x86_64";
  if (userAgent.includes("linux") || platform.includes("linux")) return "linux-x86_64";

  return preferredPlatformOrder[0];
}

async function pickDownloadUrl(platforms?: Record<string, DownloadPlatform>) {
  if (!platforms) return null;

  const detectedPlatformId = await detectPlatformId();
  const preferredIds = [
    detectedPlatformId,
    ...preferredPlatformOrder.filter((platformId) => platformId !== detectedPlatformId),
  ];

  for (const platformId of preferredIds) {
    const url = platforms[platformId]?.primary?.url;
    if (url) return url;
  }

  return null;
}

export function DownloadPrimaryCta({ platforms, label }: DownloadPrimaryCtaProps) {
  const [downloadHref, setDownloadHref] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    pickDownloadUrl(platforms).then((href) => {
      if (isMounted) setDownloadHref(href);
    });

    return () => {
      isMounted = false;
    };
  }, [platforms]);

  if (!downloadHref) {
    return (
      <button
        type="button"
        className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-muted px-5 text-sm font-medium text-muted-foreground"
      >
        <Download className="size-4" aria-hidden="true" />
        {label}
      </button>
    );
  }

  return (
    <a
      href={downloadHref}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      <Download className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}
