import { isListPayloadOmitted } from "./list-payload-preview";

/** Read both normal IDs and older, repeatedly JSON-encoded relation arrays. */
export const getRelationRecordIds = (value: unknown): string[] => {
  const read = (item: unknown, depth: number): string[] => {
    if (depth > 8 || isListPayloadOmitted(item)) return [];
    if (Array.isArray(item)) return item.flatMap((entry) => read(entry, depth + 1));
    if (typeof item !== "string" || !item.length) return [];
    const text = item.trim();
    if (text.startsWith("[") || text.startsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(text);
        if (Array.isArray(decoded) || typeof decoded === "string") return read(decoded, depth + 1);
      } catch {
        // Malformed serialized values are not identities.
      }
      return [];
    }
    return [item];
  };
  return [...new Set(read(value, 0))];
};
