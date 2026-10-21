/**
 * Map the keys of a record write's `fields` object onto field slugs.
 *
 * Record writes are keyed by field SLUG. A caller that used a field's display
 * name (`"Name"` for slug `name`) — the most natural mistake for an agent that
 * read the Base in a UI or a screenshot — used to get a 200: the value was
 * stored under a key no field reads, and the record came back without it.
 *
 * Resolution, per key: an exact live slug; else a live field's id; else a live
 * field whose display name (any locale) matches case-insensitively and
 * unambiguously. Keys that are the slug of a DELETED field of this Base are left
 * alone: every client that echoes a record's stored payload back (the
 * dashboard's board/calendar/timeline moves, the ORMs, AirApps) sends them, and
 * a deleted field keeps its values so it can be restored.
 *
 * What it rejects, and why only this much: a non-empty write where NONE of the
 * caller's keys names a live field — that write does nothing the caller asked
 * for, so it is never what they meant. A write that names at least one live field and also
 * carries other keys is still accepted with those keys ignored, as before: real
 * clients send extra keys on purpose (round-tripped payloads, ORM row objects),
 * and turning that into a 400 would break them on a server upgrade.
 *
 * Pure: no db, no server imports — the caller passes the deleted slugs.
 */

/** The parts of a field definition key resolution reads. */
export interface RecordFieldKeyDef {
  id: string;
  slug: string;
  name: string | Record<string, string | undefined>;
}

export type RecordFieldKeyProblem =
  | { kind: "none-matched"; keys: string[] }
  | { kind: "ambiguous-name"; key: string; slugs: string[] }
  | { kind: "duplicate"; key: string; slug: string };

export type RecordFieldKeyResult =
  | { ok: true; fields: Record<string, unknown>; renamed: Array<{ from: string; to: string }> }
  | { ok: false; problem: RecordFieldKeyProblem };

const displayNamesOf = (field: RecordFieldKeyDef): string[] =>
  typeof field.name === "string"
    ? [field.name]
    : Object.values(field.name).filter((value): value is string => typeof value === "string");

export const resolveRecordFieldKeys = (
  fields: Record<string, unknown>,
  liveFields: readonly RecordFieldKeyDef[],
  deletedSlugs: ReadonlySet<string>,
): RecordFieldKeyResult => {
  const keys = Object.keys(fields);
  if (keys.length === 0) return { ok: true, fields, renamed: [] };

  const bySlug = new Map(liveFields.map((field) => [field.slug, field]));
  const byId = new Map(liveFields.map((field) => [field.id, field]));
  const resolved: Record<string, unknown> = {};
  const renamed: Array<{ from: string; to: string }> = [];
  let matchedLive = 0;

  // Exact slugs first, so an alias can never shadow a key that IS a slug.
  for (const key of keys) {
    if (bySlug.has(key)) {
      resolved[key] = fields[key];
      matchedLive++;
    }
  }
  for (const key of keys) {
    if (bySlug.has(key)) continue;
    if (deletedSlugs.has(key)) {
      resolved[key] = fields[key];
      continue;
    }
    let target = byId.get(key);
    if (!target) {
      const wanted = key.trim().toLocaleLowerCase();
      const candidates = liveFields.filter((field) =>
        displayNamesOf(field).some((name) => name.trim().toLocaleLowerCase() === wanted),
      );
      if (candidates.length > 1) {
        return {
          ok: false,
          problem: {
            kind: "ambiguous-name",
            key,
            slugs: candidates.map((field) => field.slug),
          },
        };
      }
      target = candidates[0];
    }
    if (!target) {
      // Not a field of this Base: kept as it always was (stored, read by no
      // field). Only the all-unmatched case below is refused.
      resolved[key] = fields[key];
      continue;
    }
    if (Object.hasOwn(resolved, target.slug)) {
      return { ok: false, problem: { kind: "duplicate", key, slug: target.slug } };
    }
    resolved[target.slug] = fields[key];
    renamed.push({ from: key, to: target.slug });
    matchedLive++;
  }

  // Nothing the caller sent names a live field: the write would change nothing
  // they can see. (Deleted-field keys alone count as nothing, too.)
  if (matchedLive === 0) {
    return {
      ok: false,
      problem: { kind: "none-matched", keys: keys.filter((key) => !bySlug.has(key)) },
    };
  }
  return { ok: true, fields: resolved, renamed };
};

/** The 400 message for a rejected write, listing the fields it could have named. */
export const describeRecordFieldKeyProblem = (
  problem: RecordFieldKeyProblem,
  base: { slug: string; fields: readonly RecordFieldKeyDef[] },
): string => {
  const valid = base.fields
    .map((field) => {
      const [name] = displayNamesOf(field);
      return name && name !== field.slug ? `${field.slug} (${name})` : field.slug;
    })
    .join(", ");
  switch (problem.kind) {
    case "none-matched":
      return `None of the keys in \`fields\` is a field of Base ${base.slug}: ${problem.keys.join(", ")}. Key fields by slug. Fields: ${valid || "none"}.`;
    case "ambiguous-name":
      return `"${problem.key}" is the name of more than one field in Base ${base.slug} (${problem.slugs.join(", ")}); key it by slug.`;
    case "duplicate":
      return `Field ${problem.slug} is given twice in \`fields\` (as "${problem.key}" and as its slug).`;
  }
};
