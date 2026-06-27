---
title: 2026-06-26 Fullscreen expand for multi-line field previews
---

# Fullscreen expand for multi-line field previews

Date: 2026-06-26
Author: AI Assistant
AI Agent: Claude

## Prompts & Instructions

**Original Request:**
> Busabase 的 HTML 字段在 record detail 预览时，能不能加个"放大"按钮展开到全屏？这样看 HTML 内容更清晰。Markdown 字段同理——这些多行文本内容的都可以加个"展开"全屏按钮方便查看。

**Refined Instructions:**
- Add an "expand to fullscreen" affordance to multi-line field value previews in record detail.
- Apply it to HTML and Markdown, and to the other long-text kinds (code, longtext / ai_summary) for consistency.
- Keep the existing inline "Show full" collapse behavior.

## What Changed

- `FieldValuePreview` now wraps every multi-line field kind (`html`, `markdown`, `code`,
  `longtext`, `ai_summary`) in a new shared `MultilineFieldPreview` chrome.
- `MultilineFieldPreview` keeps the previous inline collapse ("Show full" / "Show less") and adds a
  hover **Maximize** button (top-right) that opens the value in a large modal
  (`kui/dialog`, ~95vw × 90vh, scrollable, titled with the field name) for comfortable reading of
  long HTML / Markdown content.
- Replaced the old `CollapsibleFieldPreview` (only used internally by this file) with
  `MultilineFieldPreview`.

## Why

Long HTML landing pages and Markdown bodies were hard to read in the narrow record-detail column —
they collapsed to ~7rem with a "Show full" toggle. A fullscreen modal gives a clear, wide reading
surface without leaving the record.

## Files Affected

- `packages/busabase-core/src/domains/dashboard/components/field-preview.tsx` — added
  `MultilineFieldPreview` (collapse + fullscreen dialog) and routed html/markdown/code/longtext
  previews through it; removed `CollapsibleFieldPreview`.

## Breaking Changes

- None. `CollapsibleFieldPreview` was internal to `field-preview.tsx` (no external importers).

## Testing

- `pnpm typecheck` — no new errors in `field-preview.tsx`.
- Live (dashboard `?demo=seo-pages`, `/base/pages/rec_seed_seo_vs_airtable`): the HTML Body and
  Notes fields each show the hover Maximize button; clicking opens a fullscreen modal titled
  "HTML Body" rendering the full landing page, with a close (X) button and Escape-to-close. The
  inline "Show full" collapse still works. Markdown fields use the same wrapper.
