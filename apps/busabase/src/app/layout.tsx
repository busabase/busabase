import type { Metadata } from "next";
import { Fraunces, Inter, Noto_Serif_SC } from "next/font/google";
import { headers } from "next/headers";
import { getDb } from "~/db";
import {
  EMPTY_APP_BRANDING,
  getAppBrandingSafe,
} from "~/domains/settings/logic/app-branding-store";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";
import { Providers } from "./providers";
import "./global.css";

// Typography: serif DISPLAY family for
// headings (Fraunces for Latin, Noto Serif SC for CJK), Inter for body/UI.
// Each font exposes a CSS variable consumed by global.css.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Fraunces: modern variable display serif (optical sizing + weight).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

// `weight: "variable"` because next/font splits CJK families into ~101
// unicode-range subsets and emits that set once per requested weight: listing
// 500/600/700 costs 303 @font-face rules (~279 KB of CSS) instead of 101. The
// variable axis spans 200–900, so all three weights survive at a third of the
// size. `preload: false` still applies — the subsets themselves stay off the
// first-paint critical path.
const notoSerifSC = Noto_Serif_SC({
  weight: "variable",
  variable: "--font-noto-serif-sc",
  display: "swap",
  // The Simplified-Chinese file is large; don't block first paint preloading it.
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const locale = getBusabaseLocaleFromAcceptLanguage(headerList.get("accept-language"));
  const LL = getBusabaseAppLL(locale);

  // The root layout's metadata is already per-request (it reads `headers()`),
  // so the white-label name can simply be read from the DB here — no
  // client-side `document.title` hack needed, and the branded title is present
  // in the very first HTML byte (and in the busabase-desktop window title).
  // `getAppBrandingSafe` swallows a missing/unmigrated DB so a cold first boot
  // still renders the stock title instead of erroring the whole page.
  const branding = await (async () => {
    try {
      return await getAppBrandingSafe(await getDb());
    } catch {
      return EMPTY_APP_BRANDING;
    }
  })();

  return {
    title: branding.name || LL.seo.title(),
    description: branding.description || LL.seo.description(),
    icons: {
      icon: branding.logoUrl || "/icon.svg",
    },
  };
}

interface Props {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: Props) {
  const headerList = await headers();
  const locale = getBusabaseLocaleFromAcceptLanguage(headerList.get("accept-language"));

  return (
    <html
      lang={locale}
      className={`${inter.variable} ${fraunces.variable} ${notoSerifSC.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
