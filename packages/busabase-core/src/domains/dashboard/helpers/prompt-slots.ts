/**
 * Fill-in blanks inside a prompt body.
 *
 * A scenario that genuinely needs one choice from the person ("how long should
 * the summary be?", "rewrite it in what style?") declares it inline:
 *
 *     {{slot:Length|a few bullet points|a few bullet points,one short paragraph}}
 *              ^name  ^default            ^options (optional, comma-separated)
 *
 * The name doubles as the control's accessible label, so it is written in the
 * prompt's own language. With options the preview renders a select, without
 * them a small text input; either way the default is what is sent when the
 * person changes nothing.
 *
 * Every exit — the preview, Copy, Ask Agent, and every server-side reader of
 * `NodePrompt.body` — goes through `fillPromptSlots`, so the raw `{{slot:`
 * syntax never reaches an agent. Custom prompts are user-authored and are only
 * affected if their author wrote the syntax on purpose.
 *
 * Pure: no React, no DOM.
 */

export interface PromptSlot {
  /** Localized label, also the key the chosen value is stored under. */
  name: string;
  defaultValue: string;
  /** Choices for a select; empty means free text. Always contains the default. */
  options: string[];
}

export type PromptTemplatePart =
  | { kind: "text"; text: string }
  | { kind: "slot"; slot: PromptSlot };

/** `{{slot:name|default}}` or `{{slot:name|default|a,b,c}}` — single line, no braces inside. */
const SLOT_SOURCE = /\{\{slot:([^|{}\n]+)\|([^|{}\n]*)(?:\|([^{}\n]*))?\}\}/.source;
// A fresh global regex per call: a shared one carries `lastIndex` between
// calls (and `matchAll` copies it), which silently skips earlier slots.
const slotPattern = () => new RegExp(SLOT_SOURCE, "g");

const toSlot = (name: string, defaultValue: string, rawOptions?: string): PromptSlot => {
  const trimmedDefault = defaultValue.trim();
  const options = (rawOptions ?? "")
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  if (options.length > 0 && !options.includes(trimmedDefault)) options.unshift(trimmedDefault);
  return { name: name.trim(), defaultValue: trimmedDefault, options: [...new Set(options)] };
};

/** Split a template into literal text and slots, in order. */
export const parsePromptTemplate = (template: string): PromptTemplatePart[] => {
  const parts: PromptTemplatePart[] = [];
  let cursor = 0;
  for (const match of template.matchAll(slotPattern())) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ kind: "text", text: template.slice(cursor, index) });
    parts.push({
      kind: "slot",
      slot: toSlot(match[1] as string, match[2] as string, match[3]),
    });
    cursor = index + match[0].length;
  }
  if (cursor < template.length) parts.push({ kind: "text", text: template.slice(cursor) });
  return parts;
};

export const hasPromptSlots = (template: string): boolean => slotPattern().test(template);

/** Every distinct slot in the template (first declaration of a name wins). */
export const listPromptSlots = (template: string): PromptSlot[] => {
  const seen = new Map<string, PromptSlot>();
  for (const part of parsePromptTemplate(template)) {
    if (part.kind === "slot" && !seen.has(part.slot.name)) seen.set(part.slot.name, part.slot);
  }
  return [...seen.values()];
};

/**
 * A typed value must not be able to smuggle a slot (or half of one) back into
 * the text it is substituted into.
 */
const sanitizeSlotValue = (value: string): string =>
  value
    .replace(/\{\{|\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** The value a slot resolves to: the chosen one when it is non-blank, else its default. */
export const resolveSlotValue = (slot: PromptSlot, values: Record<string, string> = {}): string => {
  const chosen = sanitizeSlotValue(values[slot.name] ?? "");
  return chosen || slot.defaultValue;
};

/** Substitute every slot with its chosen value (or its default). Identity for slot-free text. */
export const fillPromptSlots = (template: string, values: Record<string, string> = {}): string =>
  parsePromptTemplate(template)
    .map((part) => (part.kind === "text" ? part.text : resolveSlotValue(part.slot, values)))
    .join("");
