import {
  ArrowUpRight,
  CheckCircle2,
  DatabaseZap,
  HardDrive,
  Laptop,
  MonitorDown,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { Metadata } from "next";
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
    title: "Apple Silicon",
    description: "For newer Macs with M-series chips.",
    icon: Laptop,
  },
  {
    platformId: "darwin-x86_64",
    os: "macOS",
    title: "Intel",
    description: "For Intel-based Macs.",
    icon: Laptop,
  },
  {
    platformId: "windows-x86_64",
    os: "Windows",
    title: "Windows",
    description: "Choose the .msi or .exe bundle from the latest release.",
    icon: MonitorDown,
  },
  {
    platformId: "linux-x86_64",
    os: "Linux",
    title: "Linux",
    description: "Choose the .deb bundle from the latest release.",
    icon: HardDrive,
  },
] as const;

export const metadata: Metadata = {
  title: "Download Busabase Desktop",
  description:
    "Download Busabase Desktop for macOS, Windows, and Linux from the public Busabase desktop release channel.",
  alternates: {
    canonical: CANONICAL_URL,
  },
  openGraph: {
    title: "Download Busabase Desktop",
    description:
      "Run Busabase as a local-first desktop app for approval-first AI agent data workflows.",
    type: "website",
    url: CANONICAL_URL,
  },
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

function formatVersion(manifest: DownloadManifest | null) {
  if (!manifest?.version) return "Latest desktop build";
  return `Version ${manifest.version}`;
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

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto flex w-full max-w-6xl flex-col px-5 pt-20 pb-16 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_420px]">
          <div className="space-y-8">
            <div className="space-y-5">
              <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />
                Busabase Desktop
              </p>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-medium tracking-normal text-foreground sm:text-5xl lg:text-6xl">
                  Download Busabase for your computer
                </h1>
                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                  Run the approval-first local database for AI agents from a focused desktop app,
                  with local storage, review queues, and updater-ready releases.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <DownloadPrimaryCta platforms={manifest?.platforms} label="Download latest version" />
              <a
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Open web dashboard
              </a>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
            <div className="mb-8 flex items-center justify-between gap-4">
              <LogoLockup />
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                {formatVersion(manifest)}
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
                        {option.os} - {option.title}
                      </span>
                      <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </>
                );

                return href ? (
                  <a
                    key={`${option.os}-${option.title}`}
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
                    key={`${option.os}-${option.title}`}
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
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div className="rounded-lg border border-border bg-card p-6">
            <ShieldAlert className="mb-4 size-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Signing notice</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              macOS and Windows bundles may show platform security warnings until code signing and
              notarization are fully configured.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-card p-6">
            <CheckCircle2 className="mb-4 size-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-foreground">Install flow</h2>
            <ol className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
              <li>Download the bundle for your operating system.</li>
              <li>Open Busabase Desktop and start the local review engine.</li>
              <li>Use the release channel for future desktop updates.</li>
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
