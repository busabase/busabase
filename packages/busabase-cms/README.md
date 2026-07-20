# busabase-cms

Typed CMS adapters for the standard Busabase **Posts**, **Pages**, **Categories**, and **Tags**
Bases. The core API is framework-neutral; optional entry points add Next.js caching and safe
Fumadocs rendering.

```ts
import { createBusabaseCms } from "busabase-cms";

const cms = createBusabaseCms({
  config: {
    baseUrl: process.env.BUSABASE_BASE_URL,
    apiKey: process.env.BUSABASE_API_KEY,
    spaceId: process.env.BUSABASE_SPACE_ID,
  },
  folderId: process.env.BUSABASE_CMS_FOLDER_ID,
  lazyCreate: true,
  schemaProfile: "standard",
});

const posts = await cms.posts.list();
const page = await cms.pages.getByPath("/use-cases/automation");
const categories = await cms.categories.list();
const tag = await cms.tags.getBySlug("nextjs");
```

`folderId` is the preferred setup. The first read discovers direct child Bases and stores their
stable IDs in the Folder's `metadata.busabaseCms` namespace. Base display names and slugs may then
be renamed without breaking reads. With `lazyCreate: true`, missing Bases and fields are directly
materialized in Categories, Tags, Posts, Pages order; relation fields point to the resolved
taxonomy Base IDs. Existing extra fields are preserved. Incompatible field type, required state,
or critical options produce `BusabaseCmsSchemaDriftError` instead of a destructive conversion.
Provisioning first preflights every existing Base and field. If any existing schema drift is found,
it performs no Base, field, or metadata write; missing fields are applied only after that complete
read-only pass succeeds.

`schemaProfile` defaults to `standard`. Use `buda` for Buda's existing legacy contract: text cover
URLs, image-only attachments, required Page HTML and Hero JSON, and Buda-specific content fields.
Existing Buda Folders with the legacy optional Page body are explicitly accepted during adoption,
but newly created Buda Pages use the required body contract. The selected profile is stored beside
the Base IDs in `metadata.busabaseCms`; metadata from older versions without a profile is treated as
`standard`, and a later profile mismatch fails before any write. The Next.js cache namespace
includes both the Folder ID and profile.

Attachment validation is semantic rather than string-based. An explicit PNG/JPEG/WebP/SVG policy
is compatible with the standard `image/*` contract, and an existing policy may be stricter through
smaller file/count limits or fewer permitted MIME types. A broader policy still produces schema
drift. Likewise, an existing required field is compatible with an optional reader expectation, but
an optional field cannot satisfy a required provisioning contract outside the documented Buda Page
adoption exception. Relation targets and field types must still match exactly.

Schema bootstrap requires a write-capable API key and uses `autoMerge` for the already-approved
structure, leaving an `autoMerged` audit record without creating an approval task. This exception
applies only to schema bootstrap. Content creation and edits remain normal Busabase
ChangeRequests that require human review and merge.

Without `lazyCreate`, Folder mode never creates Bases or fields. It still writes the stable ID
mapping once when it adopts an existing standard four-Base structure, so Folder mode always needs
metadata write access; missing setup throws `BusabaseCmsSetupError`. Adoption only trusts standard
names, the Folder-derived slugs, or the legacy standard slugs, so an unrelated Base with similar
fields is never modified. A custom `source` may also provision lazily when it implements all
optional node, Base, field, and metadata methods; incomplete sources fail eagerly.

The legacy slug mode remains available when `folderId` is omitted. Its defaults are
`busabase-cms-posts`, `busabase-cms-pages`, `busabase-cms-categories`, and `busabase-cms-tags`;
override them through `baseSlugs` for an existing site-specific CMS such as Buda. Posts and Pages
must be canonical, active records whose `status` field is `published`; Categories and Tags only
need to be active. Invalid records are skipped with a warning by default; use
`invalidRecords: "throw"` for strict pipelines.

Relation columns are normalized from Busabase's single record id or record id array representation
into `categoryIds` and `tagIds`. Every VO also retains `rawFields` so an application adapter can
parse site-specific columns without widening the shared CMS contract.

The shared Page reader accepts the standard `template` values (`standard`, `landing`, `product`,
and `use-case`) as strings. The standard provisioning profile requires the field to match the live
Busabase CMS schema. The Buda profile omits it. The Buda adapter uses that profile when
`BUSABASE_CMS_FOLDER_ID` is configured; otherwise it keeps its four `buda-*` Base slugs. It parses
Buda-only fields such as `keywords`, legacy `meta-*` values, and structured landing-page sections
from `rawFields`.

## Next.js

```ts
import { createCachedBusabaseCms } from "busabase-cms/next";

export const cms = createCachedBusabaseCms({}, { revalidate: 300 });
```

## Fumadocs

```tsx
import { SafeMarkdown, getSafeMarkdownToc, sanitizeLandingPageHtml } from "busabase-cms/fumadocs";

const toc = await getSafeMarkdownToc(post.body);
const body = await SafeMarkdown({ children: post.body });
const safeHtml = sanitizeLandingPageHtml(page.body);
```

Stored content is always treated as untrusted. `SafeMarkdown` does not execute MDX or pass raw HTML,
and Page HTML must be sanitized before rendering.
