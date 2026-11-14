/**
 * "Offer to keep the space's index skill in sync" — worded once for every busabase skill surface.
 *
 * An agent picks a skill from its description alone, and the `busabase` skill's description cannot
 * name a user's own Bases. `busabase-cli skill space` writes a small per-space index skill whose
 * description does ("CRM", "Deal Flow", the team's own skills), which is what lets "加到 CRM" reach
 * Busabase at all. Writing a file into someone's skills directory needs their consent, and a stale
 * index misleads. The product decision: keep it current automatically (the default `auto`), tell
 * the user ONCE afterwards in plain words, and make "stop remembering" one command (`--forget`).
 * `ask` and `off` remain for users who set them.
 *
 * Surfaces: `skill-doc.ts` (`/SETUP_SKILL.md`, `busabase-cli skill`), the hand-written
 * `.agents/skills/busabase/SKILL.md`, and `scripts/busabase-skills-plugin/SKILL.md.tmpl` (the
 * MCP plugin, where the CLI may be absent — hence the first sentence). Each carries
 * {@link SPACE_INDEX_RULE_MARKDOWN} verbatim; `tests/space-index-rule-parity.test.ts` enforces it.
 * The CLI itself keeps the index current, and prints the matching one-line first-time note (or,
 * under `ask`, the yes/no nudge) after `login` / `space use` / `nodes create` / `nodes archive` /
 * `install` (apps/busabase-cli/src/space-index.ts).
 */

/** Section title every surface puts above the rule. */
export const SPACE_INDEX_SECTION_TITLE = "Keep the space's index skill in sync";

/**
 * The canonical rule, hard-wrapped the way the hand-written `SKILL.md` wraps it so the parity test
 * can demand the whole block verbatim. `skill-doc.ts` interpolates it, so its escaped backticks are
 * resolved once here rather than re-escaped in a second template literal.
 */
export const SPACE_INDEX_RULE_MARKDOWN = `This needs \`busabase-cli\`; where it is not available, skip this section.
By default the CLI remembers the names of this space's Bases, folders, apps and skills next to
your installed busabase skill (a small local index skill, names and node ids only), and keeps it
current after login, \`space use\`, creating or archiving them, and \`install\` — so a later request
that says "the CRM" but never "Busabase" still finds its way here. You run nothing for that.
The \`space-index\` setting is \`auto\` by default; \`ask\` and \`off\` are the other values.

- The first time, the CLI prints a one-line note on stderr. Relay it as one plain sentence at
  the end of your reply, in the user's language — e.g. "I'll remember this workspace's tables,
  so next time you can just say 'add this to the CRM'; say 'stop remembering' to turn it off." /
  "我会记住这个空间里的表格，下次直接说「加到 CRM」就行；不想要了就说「别记了」。"
- To the user, never say "index", "skill", "node id", file paths or commands.
- If the user says "stop remembering", "别记了" or "don't keep this", run
  \`busabase-cli skill space --forget\` and confirm in one sentence.
- Under \`ask\`, the CLI prints a nudge instead: ask the user one yes/no question in plain words,
  and run only the command the nudge gives for their answer, after they answer.`;
