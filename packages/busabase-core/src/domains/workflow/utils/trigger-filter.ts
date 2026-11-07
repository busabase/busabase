/** `null`, `undefined`, an empty string, and an empty list all mean "no value". */
const isEmpty = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const sameValue = (left: unknown, right: unknown): boolean => {
  if (isEmpty(left) && isEmpty(right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
};

/**
 * Whether a field value is `target`: the value itself as text (a number, a
 * checkbox's `true`, a select's choice id), or one of a list's items (a
 * multi-select's choice ids).
 */
export const fieldValueIs = (value: unknown, target: string): boolean => {
  if (Array.isArray(value)) return value.some((item) => fieldValueIs(item, target));
  if (typeof value === "string") return value === target;
  if (typeof value === "number" || typeof value === "boolean") return String(value) === target;
  return false;
};

/**
 * Whether a trigger that watches one field should start a run for this change.
 * Without `toValue`: the field got a different value. With it: the field now
 * is `toValue` and was not before — so editing a record that already has the
 * value starts nothing, which is the difference between "became Ready" and
 * "is Ready".
 */
export const fieldChangeMatches = (args: {
  before: unknown;
  after: unknown;
  toValue: string;
}): boolean => {
  if (!args.toValue) return !sameValue(args.before, args.after);
  return fieldValueIs(args.after, args.toValue) && !fieldValueIs(args.before, args.toValue);
};
