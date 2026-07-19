// Single source of truth for the demo use-cases the busabase seed supports. Pure
// (no AsyncLocalStorage / db / node), so the edge proxy and every app can import it.
//
// The `?demo` + `?lang` interpretation lives in the shared base layer
// (`openlib/ui/dashboard/demo` → `resolveDemoMode`); this module only adds the
// busabase-specific validation of the raw `?demo` value into a `DemoUseCase`.
//
// `DemoUseCase` is DERIVED from `DEMO_USE_CASES` so the runtime list and the type
// can never drift. `context.ts` re-exports the type for backwards compatibility.

/**
 * Demo use-case selector carried by `?demo=…`. `"1"` (the bare `?demo=1`) means the
 * full seeded dataset; the named variants focus the demo on one seeded base
 * (`blog`/`social`/`newsletter`) or one review scenario bundle
 * (`review-loop`/`conflict`/`batch-import`). The values double as the shared-seed
 * filter tags in `demo/dataset.ts`.
 */
export const DEMO_USE_CASES = [
  "1",
  "blog",
  "social",
  "newsletter",
  "crm",
  "review-loop",
  "conflict",
  "batch-import",
  "canonical",
  "dataset",
  "media",
  "knowledge",
  "operations",
  "routine",
  "finance",
  "compliance",
  "research",
  "content",
  "labeling",
  "field-types",
  "seo-pages",
  "config-mgmt",
  "directories",
  "agent-integrations",
  "gallery",
  "roadmap",
] as const;

export type DemoUseCase = (typeof DEMO_USE_CASES)[number];

const DEMO_USE_CASE_SET: ReadonlySet<string> = new Set(DEMO_USE_CASES);

/**
 * Validate a raw `?demo` value into a use-case: `null`/`undefined` stays "not demo"
 * (`null`); an unknown value falls back to the full demo (`"1"`).
 */
export const normalizeDemoUseCase = (raw: string | null | undefined): DemoUseCase | null =>
  raw == null ? null : DEMO_USE_CASE_SET.has(raw) ? (raw as DemoUseCase) : "1";
