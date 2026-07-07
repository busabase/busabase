import {
  Apple,
  ArrowUpRight,
  CheckCircle2,
  DatabaseZap,
  HardDrive,
  Laptop,
  MonitorDown,
  ShieldAlert,
  Smartphone,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
import { getBusabaseServerLL } from "~/lib/i18n-server";
import { DownloadPrimaryCta } from "./download-primary-cta";

const DOWNLOAD_MANIFEST_URL =
  "https://s1.busabase.com/public/downloads/busabase-desktop/latest.json";
const CANONICAL_URL = "https://busabase.com/download";

export const revalidate = 1800;

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

interface DownloadManifest {
  version: string;
  releaseName?: string;
  platforms?: Record<string, DownloadPlatform>;
}

const downloadOptions = [
  {
    platformId: "darwin-aarch64",
    os: "macOS",
    titleKey: "appleSilicon",
    descriptionKey: "macAppleSiliconDescription",
    icon: Laptop,
  },
  {
    platformId: "darwin-x86_64",
    os: "macOS",
    titleKey: "intel",
    descriptionKey: "macIntelDescription",
    icon: Laptop,
  },
  {
    platformId: "windows-x86_64",
    os: "Windows",
    titleKey: "windows",
    descriptionKey: "windowsDescription",
    icon: MonitorDown,
  },
  {
    platformId: "linux-x86_64",
    os: "Linux",
    titleKey: "linux",
    descriptionKey: "linuxDescription",
    icon: HardDrive,
  },
] as const;

/** Public store listings — direct hand-off to Apple App Store / Google Play, no download tracking. */
const APP_STORE_URL = "https://apps.apple.com/app/id6783588467";
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.busabase.app";

const mobileOptions = [
  {
    key: "ios",
    os: "iOS",
    titleKey: "iphoneIpad",
    icon: Apple,
    href: APP_STORE_URL,
    actionKey: "appStoreAction",
  },
  {
    key: "android",
    os: "Android",
    titleKey: "phoneTablet",
    icon: Smartphone,
    href: GOOGLE_PLAY_URL,
    actionKey: "googlePlayAction",
  },
] as const;

export const generateMetadata = async (): Promise<Metadata> => {
  const LL = await getBusabaseServerLL();
  return {
    title: LL.marketing.downloadTitle(),
    description: LL.marketing.downloadDescription(),
    alternates: {
      canonical: CANONICAL_URL,
    },
    openGraph: {
      title: LL.marketing.downloadTitle(),
      description: LL.marketing.downloadOgDescription(),
      type: "website",
      url: CANONICAL_URL,
    },
  };
};

async function getDownloadManifest(): Promise<DownloadManifest | null> {
  try {
    const response = await fetch(DOWNLOAD_MANIFEST_URL, {
      next: { revalidate: 1800 },
    });
    if (!response.ok) return null;
    return (await response.json()) as DownloadManifest;
  } catch {
    return null;
  }
}

function formatVersion(
  manifest: DownloadManifest | null,
  LL: Awaited<ReturnType<typeof getBusabaseServerLL>>,
) {
  if (!manifest?.version) return LL.marketing.latestDesktopBuild();
  return LL.marketing.version({ version: manifest.version });
}

function LogoLockup() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 items-center justify-center rounded-md border border-border bg-background">
        <DatabaseZap className="size-5 text-foreground" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold text-foreground">Busabase</span>
    </div>
  );
}

export default async function DownloadPage() {
  const manifest = await getDownloadManifest();
  const LL = await getBusabaseServerLL();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-20 pb-16 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_420px]">
          <div className="space-y-8">
            <div className="space-y-5">
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                {LL.marketing.desktopBadge()}
              </p>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-medium tracking-normal text-foreground sm:text-5xl lg:text-6xl">
                  {LL.marketing.downloadHeadline()}
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                  {LL.marketing.downloadSubhead()}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <DownloadPrimaryCta
                platforms={manifest?.platforms}
                label={LL.marketing.downloadLatest()}
              />
              <a
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                {LL.marketing.openWebDashboard()}
              </a>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="mb-8 flex items-center justify-between gap-4">
              <LogoLockup />
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                {formatVersion(manifest, LL)}
              </span>
            </div>
            <div className="space-y-4">
              {downloadOptions.map((option) => {
                const Icon = option.icon;
                const platform = manifest?.platforms?.[option.platformId];
                const href = platform?.primary?.url;
                const content = (
                  <>
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-foreground">
                        {option.os} - {LL.marketing[option.titleKey]()}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                        {LL.marketing[option.descriptionKey]()}
                      </span>
                    </span>
                  </>
                );

                return href ? (
                  <a
                    key={option.platformId}
                    href={href}
                    className="group flex items-center gap-4 rounded-md border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/60"
                  >
                    {content}
                    <ArrowUpRight
                      className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </a>
                ) : (
                  <div
                    key={option.platformId}
                    className="flex items-center gap-4 rounded-md border border-border bg-background p-4 opacity-70"
                  >
                    {content}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-border bg-muted/40">
        <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:px-8">
          <div className="mb-6 space-y-2">
            <h2 className="text-2xl font-medium text-foreground">{LL.marketing.mobileTitle()}</h2>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {LL.marketing.mobileBody()}
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {mobileOptions.map((option) => {
              const Icon = option.icon;
              return (
                <a
                  key={option.key}
                  href={option.href}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center gap-4 rounded-lg border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/60"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {option.os} · {LL.marketing[option.titleKey]()}
                    </span>
                    <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                      {LL.marketing[option.actionKey]()}
                    </span>
                  </span>
                  <ArrowUpRight
                    className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
                    aria-hidden="true"
                  />
                </a>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div className="rounded-lg border border-border bg-card p-6">
            <ShieldAlert className="mb-4 size-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">
              {LL.marketing.signingNoticeTitle()}
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {LL.marketing.signingNoticeBody()}
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <CheckCircle2 className="mb-4 size-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">
              {LL.marketing.installFlowTitle()}
            </h2>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              <li>{LL.marketing.installStep1()}</li>
              <li>{LL.marketing.installStep2()}</li>
              <li>{LL.marketing.installStep3()}</li>
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
