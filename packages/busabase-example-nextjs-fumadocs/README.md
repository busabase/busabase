# Busabase CMS + Next.js + Fumadocs example

A runnable CMS example for canonical Busabase **Posts**, **Pages**, **Categories**, and **Tags**.
It lazily provisions the standard schema in a selected Folder, then reads only approved canonical
content. It uses Next.js 16 App Router, React 19, Fumadocs UI, and
[`busabase-cms`](../busabase-cms/).

The example keeps `BUSABASE_API_KEY` on the server. Browser components never import the SDK or
receive credentials.

## Run locally

Prerequisites: Node.js 24.18 or newer and pnpm.

```bash
cp packages/busabase-example-nextjs-fumadocs/.env.example \
  packages/busabase-example-nextjs-fumadocs/.env.local
# Set BUSABASE_BASE_URL and BUSABASE_CMS_FOLDER_ID. Cloud also needs a write-capable API key and,
# when applicable, space id.
pnpm --filter busabase-example-nextjs-fumadocs dev
```

Open <http://localhost:3000>. With no credentials, the application still starts and displays setup
guidance instead of failing.

## Environment

| Variable | Required | Purpose |
| --- | --- | --- |
| `BUSABASE_BASE_URL` | Yes | Busabase Cloud or self-hosted server root. |
| `BUSABASE_API_KEY` | Yes on Cloud; no for an open local server | Server-only bearer token. |
| `BUSABASE_SPACE_ID` | Yes when the key has multiple spaces | Target space for every read. |
| `BUSABASE_CMS_FOLDER_ID` | Yes | Folder that owns and remembers the four CMS Base IDs. |
| `NEXT_PUBLIC_SITE_URL` | No | Absolute origin for sitemap and canonical URLs. |

Never prefix the API key with `NEXT_PUBLIC_` and never pass it to a Client Component.

## Expected Bases

`busabase-cms` creates missing Bases/fields on the first read and validates the standard four-Base
contract. Schema materialization is direct and leaves `autoMerged` audit records. Posts and Pages
must be active and published; Categories and Tags must be active.

Posts contain `path`, `title`, `slug`, `locale`, `status`, `description`, Markdown `body`,
`cover-image`, `attachments`, `author`, relation fields `categories` and `tags`, `published-at`,
`canonical-url`, JSON `legacy-paths`, `seo-title`, `seo-description`, `schema-version`, and
`updated-at`.

Pages contain `path`, `title`, `slug`, `locale`, `status`, `template`, HTML `body`, JSON `hero`,
`features`, and `faqs`, plus `canonical-url`, JSON `legacy-paths`, `seo-title`, `seo-description`,
`schema-version`, and `updated-at`.

Categories and Tags contain `name`, `slug`, `locale`, `description`, and `updated-at`.

For exact field DTOs and output VOs, see the exported Zod schemas and types in `busabase-cms`.

## How it works

- `src/lib/content.ts` creates one server-only cached CMS with a five-minute revalidation window.
- The overview reads all four Bases and reports the taxonomy totals.
- The data-source section resolves the configured Folder slug and links to its visual Busabase
  dashboard instead of exposing the raw node API as the primary inspection surface.
- Post routes render untrusted Markdown with `SafeMarkdown` and a generated table of contents.
- Page routes sanitize stored HTML before using `dangerouslySetInnerHTML`.
- `sitemap.ts` emits only validated, canonical, published Posts and Pages.
- Invalid records are logged and skipped; connection failures produce an empty state.

Only schema bootstrap writes directly. Content creation and edits still use Busabase
ChangeRequests and human approval before merge.
