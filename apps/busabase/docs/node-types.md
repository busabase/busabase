# Busabase Node Types

Busabase organizes trusted knowledge as nodes. Every node appears in the left navigation and can be changed through the same Change Request review flow.

![Create node menu showing Folder, Base, Skill, Drive, and Doc](../public/assets/docs/busabase-create-node-menu.png)

## Current Types

| Type | Use it for | Review behavior |
| --- | --- | --- |
| Folder | Navigation groups for related nodes | Rename, move, create, delete, and restore through node operations |
| Base | Structured records with typed fields | Field, view, record, and schema changes go through review |
| Skill | Agent-readable file trees | Files and metadata are stored in object storage and changed through file-tree operations |
| Drive | Plain file collections | Files are stored in object storage with a seeded `README.md`; no `SKILL.md` or `skill.json` |
| AirApp | Agent-authored, human-runnable web apps | Files are stored the same way as Skill/Drive; the node detail view adds a Run panel that executes the app in-browser |
| Doc | Single approved document pages | Document updates are reviewed before merge |

## Drive

Drive is a pure file-tree node. It uses the same file listing, read, change-request, and merge machinery as Skill, but its seed is intentionally minimal: one `README.md` file.

![Drive node detail view with README.md](../public/assets/docs/busabase-drive-node-detail.png)

## Skill

Skill remains backward-compatible. Existing `/skills/*` API routes, `SkillVO`, contract schemas, and core handler exports keep the same names and shapes. The implementation now delegates to the shared file-tree kind.

![Skill node detail view with SKILL.md and skill.json](../public/assets/docs/busabase-skill-node-detail.png)

## AirApp

AirApp is also a file-tree node — same file listing, read, change-request, and merge machinery as Skill and Drive — seeded with a minimal, immediately-runnable Hono HTTP server + static HTML/CSS/JS project (`package.json`, `server.js`, `index.html`, `style.css`, `client.js`). An agent writes or edits the app's files through the normal ChangeRequest flow; a human opens the node, sees a file browser next to a Run panel, and clicks Run to execute the app in-browser via [Nodepod](https://github.com/R1ck404/Nodepod) (`@scelar/nodepod`), a Web Worker + Service Worker based Node.js runtime. Nodepod installs the app's declared dependencies, starts its server, and streams install/start logs into the panel; once the server reports ready, a same-origin preview iframe points at it.

The seed intentionally skips Vite/bundler tooling: a Vite dev server was verified not to boot under Nodepod (`Cannot destructure property 'createServer'`, reproducible with or without COOP/COEP cross-origin isolation headers) while a bare Node HTTP server was verified to install and run correctly — see the airapp changelog's Follow-up Tasks for the open question of whether/how bundler-based dev servers can be made to work.

Because the preview resolves to a same-origin path (`/__virtual__/...`, confirmed via Nodepod's own service worker — not a cross-origin sandbox), requests the running app makes back to busabase's own API are architecturally positioned to pick up the current user's session automatically. This has **not** been verified against a real authenticated session — Busabase's local open-source deployment has no login by default, so there was no session cookie available to test against locally; this needs a real check against busabase-cloud (which does have session auth) before being relied upon.

Running always reflects the node's current (merged/HEAD) file tree — previewing a pending, not-yet-merged ChangeRequest's files isn't supported yet for any node type in Busabase.

**Run requires a secure context.** Service Workers — what Nodepod uses to intercept preview/virtual-server requests — only register in a browser "secure context": `https:`, or the literal hostname `localhost`/`127.0.0.1`/`[::1]`. Accessing the dashboard over plain HTTP through any other hostname (a LAN IP, a custom DNS name mapped to your machine, a tunnel domain) is **not** a secure context even though it resolves to the same server, so the service worker silently fails to register and clicking Run 404s. Use `https://` or `http://localhost:<port>` for local development.

## Review Flow

Node changes, file changes, and metadata changes all land in the Inbox as reviewable operations. Reviewers can inspect the proposed change, request edits, approve it, and merge it into the trusted tree.

![Inbox review list with node and file operations](../public/assets/docs/busabase-inbox-review.png)
