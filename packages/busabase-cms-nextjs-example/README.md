# Busabase CMS + Next.js + Fumadocs example

A runnable publishing example for canonical Busabase **Posts**, **Pages**, **Categories**, and
**Tags**. It lazily provisions the standard schema in a selected Folder, then renders merged,
published records with Next.js 16 App Router, React 19, Fumadocs UI, and
[`busabase-cms`](../busabase-cms/).

This is a pure Busabase CMS example. It does not read local MDX or WordPress content and does not
provide a fallback content source. When Busabase is not configured or cannot be reached, the app
shows an empty/setup state.

The example keeps `BUSABASE_API_KEY` on the server. Browser components never import the SDK or
receive credentials.

## Run locally

Prerequisites: Node.js 24.18 or newer and pnpm.

```bash
cp packages/busabase-cms-nextjs-example/.env.example \
  packages/busabase-cms-nextjs-example/.env.local
# Set BUSABASE_BASE_URL and BUSABASE_CMS_FOLDER_ID. Cloud also needs a write-capable API key and,
# when applicable, a space id.
pnpm --filter busabase-cms-nextjs-example dev
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
| `BUSABASE_CMS_DEFAULT_LOCALE` | No | Unprefixed locale, default `en`. |
| `BUSABASE_CMS_LOCALES` | No | Comma-separated accepted locales, default `en,zh-CN`. |
| `NEXT_PUBLIC_SITE_URL` | No | Absolute origin for sitemap and canonical URLs. |

Never prefix the API key with `NEXT_PUBLIC_` and never pass it to a Client Component.

## Canonical routes

Every published Post and Page is linked and indexed at its stored `path`:

- English Post: `/blog/hello`
- Simplified Chinese Post: `/zh-CN/blog/hello`
- English Page: `/use-cases/agents`
- Simplified Chinese Page: `/zh-CN/solutions/teams`

`/blog` and `/pages` remain browse indexes. The old `/pages/...` preview URL only performs a
permanent redirect when one Page can be identified by locale and slug. Concrete Next.js routes win
over the generic CMS route, so an application can add native routes without removing CMS Pages.

Post paths must use the `blog` namespace. Pages can use any valid canonical path, although app-owned
index namespaces such as `/blog`, `/pages`, `/categories`, and `/tags` should be avoided because
concrete routes intentionally take priority.

The sitemap uses stored canonical paths, removes duplicates, and includes only valid published
Posts/Pages plus active taxonomy archives.

## Taxonomy and attachments

Categories and Tags are browseable at locale-aware archive URLs:

- `/categories/news` and `/tags/product`
- `/zh-CN/categories/news` and `/zh-CN/tags/product`

Archives filter Posts using Busabase relation IDs and locale together, so records with the same slug
in different languages stay separate. Linked Categories and Tags appear on each Post.

Post attachments appear below the Markdown body with file name, MIME type, size, and an HTTP(S)
download/view link. Executable or local URL protocols are rejected. Markdown may still reference an
attachment URL inline, and `cover-image` remains the Post cover.

## Expected Bases

`busabase-cms` creates missing Bases and fields on the first read, validates the standard four-Base
contract, and stores stable Base IDs in Folder metadata. Schema materialization is direct and leaves
`autoMerged` audit records. Posts and Pages must be active and published; Categories and Tags must be
active.

Posts contain `path`, `title`, `slug`, `locale`, `status`, `description`, Markdown `body`,
`cover-image`, `attachments`, `author`, relation fields `categories` and `tags`, `published-at`,
`canonical-url`, JSON `legacy-paths`, `seo-title`, `seo-description`, `schema-version`, and
`updated-at`.

Pages contain `path`, `title`, `slug`, `locale`, `status`, `template`, HTML `body`, JSON `hero`,
`features`, and `faqs`, plus `canonical-url`, JSON `legacy-paths`, `seo-title`, `seo-description`,
`schema-version`, and `updated-at`.

Categories and Tags contain `name`, `slug`, `locale`, `description`, and `updated-at`.

For exact field DTOs and output VOs, see the exported Zod schemas and types in `busabase-cms`.

## Rendering and caching

- `src/lib/content.ts` creates one server-only cached CMS with a five-minute revalidation window.
- The overview reads all four Bases and reports the taxonomy totals.
- The data-source section resolves the configured Folder slug and links to its visual Busabase
  dashboard instead of exposing the raw node API as the primary inspection surface.
- Post routes render untrusted Markdown with `SafeMarkdown` and a generated table of contents.
- Page routes sanitize stored HTML before using `dangerouslySetInnerHTML`.
- Invalid schema, path, locale, and protocol values are logged or skipped rather than rendered.
- Folder schema bootstrap is lazy; subsequent reads use the Base IDs stored in Folder metadata.

Only schema bootstrap writes directly. Content creation and edits still follow the Busabase workflow
configured for the target workspace.
