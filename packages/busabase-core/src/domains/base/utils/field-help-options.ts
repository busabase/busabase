import type { FieldHelp } from "busabase-contract/domains/base/contract/base-schemas";

/** Apply metadata to live settings, never to a captured help-editor snapshot. */
export function mergeFieldHelpOptions<T extends { help?: FieldHelp }>(
  current: T,
  replacement: (Omit<T, "help"> & { help?: FieldHelp }) | undefined,
  help: FieldHelp | null | undefined,
): Omit<T, "help"> & { help?: FieldHelp } {
  const next = { ...(replacement ?? current) };
  if (replacement !== undefined && replacement.help === undefined && current.help) {
    next.help = current.help;
  }
  if (help === null) delete next.help;
  else if (help !== undefined) next.help = help;
  return next;
}
