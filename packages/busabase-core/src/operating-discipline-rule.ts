/**
 * "Running a workspace day to day" — worded once for every agent surface that writes records.
 *
 * Logging leads, bulk updates, audits and clean-ups go wrong in the same few ways whatever the
 * transport: a field or option guessed instead of read, a second record minted for someone who is
 * already in the Base, a "bulk" run that sampled, a delete nobody asked for, "started" reported as
 * "done". The habits below are the transport-neutral ones. Confirming the space, the write loop
 * and credentials are not repeated: each surface already has its own rule for those.
 *
 * Surfaces, as with `playbook-rule.ts`: the hand-written `.agents/skills/busabase/SKILL.md` (which
 * adds one CLI-only habit after the block, since file text can only be handed back through the
 * CLI/HTTP) and `scripts/busabase-skills-plugin/SKILL.md.tmpl` (the MCP-first skill each public
 * agent plugin bundles). Both carry {@link OPERATING_DISCIPLINE_RULE_MARKDOWN} verbatim;
 * `tests/operating-discipline-rule-parity.test.ts` enforces it, so editing the rule here and
 * nowhere else is a test failure rather than a silent drift between the skill and the plugins.
 */

/** Section title every surface puts above the rule. */
export const OPERATING_DISCIPLINE_SECTION_TITLE = "Running a workspace day to day";

/** The sentence every surface opens the rule with. */
export const OPERATING_DISCIPLINE_RULE_HEADING =
  "**Read before you write, and finish what you start.**";

/**
 * The canonical rule. Hard-wrapped the way the hand-written `SKILL.md` wraps it, so the parity
 * test can demand the whole block verbatim.
 */
export const OPERATING_DISCIPLINE_RULE_MARKDOWN = `${OPERATING_DISCIPLINE_RULE_HEADING}

- **Read the schema and the records you will touch first.** Fields, types and select options come
  from a read, not a guess. Record ids, field ids and option names are copied from a read or
  query result in this session, never reconstructed.
- **Dedupe before you create.** Search the Base — and the batch you are about to insert — for an
  existing match on stable identifiers (email, phone, name + company). Update the match instead
  of minting a duplicate; when two candidates both look real, show the pair and ask. Fill what
  the source supports and leave unknown fields empty rather than plausible.
- **Bulk work covers the whole set.** Page through every target record — don't sample — and write
  in small batches. Each batch's write response is the check: read it item by item, and don't
  re-fetch what it already confirmed.
- **No silent deletes.** Deleting records, files or nodes needs the user's explicit ask in this
  conversation; a clean-up brief authorises tidying, not removal. For an audit, report findings
  first (duplicates, empty required fields, stale statuses) with counts from real queries, and
  fix only the classes the user approves.
- **Report partial as partial.** Name the space, Base and records you touched (as links where you
  can), what changed, and what you deliberately left undone.`;
