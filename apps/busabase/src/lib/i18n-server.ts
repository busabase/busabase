import { headers } from "next/headers";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage, getBusabaseMessages } from "./i18n";

export const getBusabaseServerMessages = async () => {
  const headerList = await headers();
  return getBusabaseMessages(
    getBusabaseLocaleFromAcceptLanguage(headerList.get("accept-language")),
  );
};

export const getBusabaseServerLL = async () => {
  const headerList = await headers();
  return getBusabaseAppLL(getBusabaseLocaleFromAcceptLanguage(headerList.get("accept-language")));
};
