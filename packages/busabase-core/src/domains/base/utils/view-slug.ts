/**
 * Short, stable, ASCII-safe token derived from a string: FNV-1a, base36.
 *
 * The same token the dashboard's create-node modal falls back to for a node
 * name that transliterates to nothing (`hashToken` in
 * `dashboard/components/create-node-modal.tsx`), so a view named entirely in
 * CJK gets a slug of the same shape a node named that way does.
 */
const hashToken = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
};

/**
 * The slug a new view gets when its caller did not pick one.
 *
 * Slugs are ASCII path segments (`/base/<base>/<view>`), so the name is reduced
 * to `[a-z0-9-]`. A name with no ASCII letters or digits at all ("看板 · 按状态")
 * reduces to nothing, and the view used to be created with `slug: ""` — after
 * which every further such view on the Base failed with a conflict on that
 * empty slug. Those names fall back to `view-<hash>` instead, as a node's do.
 *
 * Then the first free `-2`, `-3`, … among `taken`: the server chose this slug,
 * so it must never be the reason the create fails. A slug the caller passed
 * explicitly is not run through here and still conflicts loudly.
 */
export const deriveViewSlug = (name: string, taken: ReadonlySet<string>): string => {
  const trimmed = name.trim();
  const ascii = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const stem = ascii || `view-${hashToken(trimmed)}`;
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
};
