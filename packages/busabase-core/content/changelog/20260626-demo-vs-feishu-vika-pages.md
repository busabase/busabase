---
title: 2026-06-26 Demo SEO comparison pages — Feishu Bitable & Vika
---

# Demo SEO comparison pages — Feishu Bitable & Vika

Date: 2026-06-26
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> apps/busabase 的 demo 数据：增加 /zh-CN/busabase-vs-feishu-duoweibiaoge（飞书多维表格）和 /zh-CN/busabase-vs-vika-duoweibiaoge（vika.cn）的对比。是 ?demo=1 的演示数据，不是做新页面。

**Refined Instructions:**
- Add two comparison entries to the `?demo=1` seed dataset (the "Pages" SEO base), not real Next.js routes.
- Target the zh-CN demo scenario, since both products (飞书多维表格 / 维格表) and the requested URLs are Chinese.
- Use the exact slugs `busabase-vs-feishu-duoweibiaoge` and `busabase-vs-vika-duoweibiaoge`.

## What Changed

- Renamed the existing zh-CN Feishu comparison demo record slug from `/vs-feishu` to `/busabase-vs-feishu-duoweibiaoge` and tagged it `category: "comparison"`, `locale: "zh-CN"`.
- Added a new zh-CN demo record `rec_seed_seo_vs_vika` (slug `/busabase-vs-vika-duoweibiaoge`) — a full Busabase vs. 维格表 (vika.cn / APITable) comparison landing page (hero, feature table, three differentiators, CTA), honestly noting both are open source but positioned differently (Vika = data-as-API, Busabase = human review/merge for AI output).

Both records carry `useCases: ["seo-pages"]`, so they appear under the "落地页 / Pages" base when visiting the dashboard in `?demo=1` (or `?demo=seo-pages`) with the zh-CN demo locale, and in the `all-pages` view sorted by page score.

## Why

The demo's SEO Pages base already showcased comparison landing pages (vs Airtable, vs Notion, vs Feishu). Feishu Bitable and Vika are the two most-searched Chinese 多维表格 competitors, so adding them rounds out the localized comparison story shown in demo mode.

## Design-system alignment (all demo Pages)

Follow-up request: make **every** page in the SEO Pages base match `apps/busabase-cloud`'s
design system (`content/spec/design-system.md` / `vi.md`) — which is **strictly monochrome**
("black & white; color reserved for semantic status only"; "avoid gradients, decorative images,
color washes, and large tinted cards"; headings serif, medium–semibold 500–600).

Every `html_body` across both EN and zh-CN scenarios was migrated off the previous ad-hoc palette
(orange/sky/violet brand hues, gradient + tinted-wash heroes, `#0f172a`/slate hex) to **CSS design
tokens** that resolve against the dashboard theme (and are preserved by the HTML field sanitizer,
which keeps `style` + `var(...)`):

- All hardcoded hex/`rgba`/`linear-gradient` removed → `var(--background|card|foreground|muted|muted-foreground|border|primary|primary-foreground)`.
- Comparison tables are now monochrome — the ✓ / ✗ / ~ meaning is carried by the glyph + weight
  (Busabase column = `var(--foreground)` bold) rather than green/red/amber brand color.
- The three former dark-gradient "hero" sections were flattened to the same light neutral hero as
  every other page, for a consistent calm surface; CTA call-outs stay as an inverted
  `var(--primary)` / `var(--primary-foreground)` block (theme-aware in light + dark).
- Display heading weight softened `800 → 600`; no inline `font-family` (h1–h6 inherit the serif
  display family from `global.css`).

Result: 0 hex / 0 rgba / 0 gradients remaining in either scenario file.

## Files Affected

- `packages/busabase-core/src/demo/scenarios/readme-scenarios.zh-cn.ts` — updated Feishu record slug + added Vika comparison record; migrated all zh-CN page HTML to design tokens.
- `packages/busabase-core/src/demo/scenarios/readme-scenarios.ts` — migrated all EN page HTML to design tokens (palette → tokens, gradients removed, dark heroes flattened, weights softened).

## Breaking Changes

- None. Demo seed data only; `/vs-feishu` was not referenced anywhere else, and the HTML changes are presentational (token swaps).

## Testing

- `pnpm typecheck` — no new errors in the demo scenario files (pre-existing workspace-package resolution errors are unrelated and stem from the package not being installed in this worktree).
- Manual: visit `/dashboard?demo=1` (or `?demo=seo-pages`) with the zh-CN demo locale → open the "落地页 / Pages" base → both `busabase-vs-feishu-duoweibiaoge` and `busabase-vs-vika-duoweibiaoge` records render with their comparison HTML.
