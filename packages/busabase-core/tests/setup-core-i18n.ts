// The dashboard fetches each non-English catalog on demand and suspends until
// it arrives (see src/i18n/index.tsx). Component tests render synchronously and
// assert straight away, so hand the loader every catalog up front — the same
// state a browser reaches once the chunk has loaded. `core-messages-loader.test.ts`
// covers the on-demand path itself.
import { coreMessagesLoader } from "../src/i18n";
import { coreMessagesByLocale } from "../src/i18n/catalog";
import { CORE_LOCALES } from "../src/i18n/locales";

for (const locale of CORE_LOCALES) coreMessagesLoader.prime(locale, coreMessagesByLocale[locale]);
