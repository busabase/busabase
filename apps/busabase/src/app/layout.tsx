import type { Metadata } from "next";
import { Fraunces, Inter, Noto_Serif_SC } from "next/font/google";
import { headers } from "next/headers";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";
import { Providers } from "./providers";
import "./global.css";

// Typography (see apps/busabase-cloud/content/spec/design-system.md): serif DISPLAY family for
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

const notoSerifSC = Noto_Serif_SC({
  weight: ["500", "600", "700"],
  variable: "--font-noto-serif-sc",
  display: "swap",
  // The Simplified-Chinese file is large; don't block first paint preloading it.
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const headerList = await headers();
  const locale = getBusabaseLocaleFromAcceptLanguage(headerList.get("accept-language"));
  const LL = getBusabaseAppLL(locale);

  return {
    title: LL.seo.title(),
    description: LL.seo.description(),
    icons: {
      icon: "/icon.svg",
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
