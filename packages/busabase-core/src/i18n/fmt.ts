/**
 * Pure `{token}` interpolation, deliberately kept OUT of `./index.tsx`.
 *
 * `index.tsx` is `"use client"` and pulls in React plus all four locale
 * catalogs. The dashboard's platform-neutral helpers (`helpers/change-request`,
 * `helpers/activity-events`, `helpers/format`, `helpers/home`) are consumed by
 * `apps/busabase-mobile` through the package's exports map, so a value import
 * of `fmt` from `index.tsx` would drag React and every catalog into the React
 * Native bundle. Importing it from here keeps those helpers importable from RN.
 *
 * `./index.tsx` re-exports this, so existing `import { fmt } from "../../i18n"`
 * call sites keep working unchanged.
 */
export function fmt(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    key in params ? String(params[key]) : `{${key}}`,
  );
}
