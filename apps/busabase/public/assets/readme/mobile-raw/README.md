# Mobile screenshot drop folder

Raw `busabase-mobile` screenshots go here. They get composited into phone-bezel
mockups for the main README by:

```bash
node apps/busabase/scripts/generate-mobile-frames.mjs
```

Each `<name>.png` here becomes `../<name>-framed.png` next to the other README
assets. Device-agnostic — any phone resolution works (the frame is built around
each screenshot's own aspect ratio).

## Recommended captures (3 phones, left → right in the README)

Connect the app to a seeded local server (`npx busabase server`, default
`http://localhost:15419`) and capture:

| Filename | Screen | Why |
| --- | --- | --- |
| `mobile-inbox.png` | Inbox — pending change requests | The hero: review/approve from your phone |
| `mobile-change-request.png` | A Change Request detail (agent diff + approve/reject) | Shows the approval gate on mobile |
| `mobile-record.png` | Record detail or a Base's records | Shows the structured data |

Capture clean frames (no debug banners). iPhone 15/16 Pro or any modern device
is fine. Drop the PNGs here, then run the script — the framed versions are what
the README references.

> The raw captures are committed alongside the framed outputs (like
> `how-it-works.svg` ships next to its PNG) so the mockups can be regenerated.

## How the current shots were captured (Expo web)

No simulator required — `busabase-mobile` runs on web, driven headless:

1. Seed + run the backend on `:15419`:
   `cd apps/busabase && pnpm db:seed:all && PORT=15419 pnpm dev`
   (needs a `.env` with `PG_DATABASE_URL="pglite://.data/busabase"` +
   `STORAGE_URL="local:.data/busabase-storage?base_url=/api/dev/attachment"`).
2. Run the app on web: `cd apps/busabase-mobile && npx expo start --web --port 8082`.
3. Drive it with Playwright at an iPhone viewport (393×852, deviceScaleFactor 3),
   launching Chromium with `--disable-web-security` (the web page on `:8082`
   fetches the API on `:15419`, so CORS must be bypassed for capture). Connect via
   "Connect Self-hosted Busabase" → `http://localhost:15419`, then screenshot the
   inbox, a Change Request, and a record. Hide the dev LogBox first
   (`document.getElementById("error-toast").style.display = "none"`).
