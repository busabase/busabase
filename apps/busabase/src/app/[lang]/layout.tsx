import { notFound } from "next/navigation";
import type React from "react";
import { LangLayoutClient } from "./layout-client";
import { normalizeLangLocale } from "./locale";

export const dynamic = "force-static";

export function generateStaticParams() {
  return [{ lang: "en" }, { lang: "zh-CN" }];
}

export default async function LangLayout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: React.ReactNode;
}) {
  const { lang } = await params;
  const normalizedLang = normalizeLangLocale(lang);
  if (!normalizedLang) notFound();

  return <LangLayoutClient lang={normalizedLang}>{children}</LangLayoutClient>;
}
