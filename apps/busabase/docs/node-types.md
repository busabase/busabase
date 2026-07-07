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
| Doc | Single approved document pages | Document updates are reviewed before merge |

## Drive

Drive is a pure file-tree node. It uses the same file listing, read, change-request, and merge machinery as Skill, but its seed is intentionally minimal: one `README.md` file.

![Drive node detail view with README.md](../public/assets/docs/busabase-drive-node-detail.png)

## Skill

Skill remains backward-compatible. Existing `/skills/*` API routes, `SkillVO`, contract schemas, and core handler exports keep the same names and shapes. The implementation now delegates to the shared file-tree kind.

![Skill node detail view with SKILL.md and skill.json](../public/assets/docs/busabase-skill-node-detail.png)

## Review Flow

Node changes, file changes, and metadata changes all land in the Inbox as reviewable operations. Reviewers can inspect the proposed change, request edits, approve it, and merge it into the trusted tree.

![Inbox review list with node and file operations](../public/assets/docs/busabase-inbox-review.png)
