import type { PackageBaseNode, PackageNode, PackageRecordLine } from "./tree";

export interface PlannedRecordCreate {
  base: PackageBaseNode;
  record: PackageRecordLine;
}

export type RecordCreateLayer = PlannedRecordCreate[];

export const recordIdentity = (baseSlug: string, recordKey: string): string =>
  `${baseSlug}\u0000${recordKey}`;

export const toRecordKeyArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
};

const collectBases = (nodes: readonly PackageNode[]): PackageBaseNode[] => {
  const bases: PackageBaseNode[] = [];
  for (const node of nodes) {
    if (node.type === "base") bases.push(node);
    if (node.type === "folder") bases.push(...collectBases(node.children));
  }
  return bases;
};

const label = (baseSlug: string, recordKey: string): string => `${baseSlug}/${recordKey}`;

/**
 * Order sample records so every required relation points at an already-created row.
 *
 * Optional relations remain a separate linking pass. Required relations cannot: the
 * Base rejects a record before that later pass if its required value is absent.
 */
export const buildRecordCreateLayers = (nodes: readonly PackageNode[]): RecordCreateLayer[] => {
  const bases = collectBases(nodes);
  const basesBySlug = new Map(bases.map((base) => [base.slug, base]));
  const records = new Map<string, PlannedRecordCreate>();

  for (const base of bases) {
    for (const record of base.records) {
      records.set(recordIdentity(base.slug, record.key), { base, record });
    }
  }

  const dependencies = new Map<string, Set<string>>();
  for (const planned of records.values()) {
    const id = recordIdentity(planned.base.slug, planned.record.key);
    const required = new Set<string>();
    for (const field of planned.base.base.fields) {
      if (field.type !== "relation" || !field.required) continue;
      const targetBaseSlug = field.options.targetBaseSlug;
      if (!targetBaseSlug || !basesBySlug.has(targetBaseSlug)) {
        throw new Error(
          `Required relation "${planned.base.slug}.${field.slug}" targets missing Base "${targetBaseSlug || "(unset)"}". Nothing was installed.`,
        );
      }
      const keys = toRecordKeyArray(planned.record.fields[field.slug]);
      if (keys.length === 0) {
        throw new Error(
          `Sample record "${label(planned.base.slug, planned.record.key)}" is missing required relation "${field.slug}". Nothing was installed.`,
        );
      }
      for (const key of keys) {
        const dependency = recordIdentity(targetBaseSlug, key);
        if (!records.has(dependency)) {
          throw new Error(
            `Sample record "${label(planned.base.slug, planned.record.key)}" requires "${targetBaseSlug}/${key}" through relation "${field.slug}", but that target is not in this package. Nothing was installed.`,
          );
        }
        required.add(dependency);
      }
    }
    dependencies.set(id, required);
  }

  const remaining = new Map(records);
  const created = new Set<string>();
  const layers: RecordCreateLayer[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([id]) =>
        [...(dependencies.get(id) ?? [])].every((dependency) => created.has(dependency)),
      )
      .sort(([, a], [, b]) =>
        `${a.base.slug}\u0000${a.record.key}`.localeCompare(
          `${b.base.slug}\u0000${b.record.key}`,
          "en",
        ),
      );
    if (ready.length === 0) {
      const cycle = [...remaining.values()]
        .map((item) => label(item.base.slug, item.record.key))
        .sort((a, b) => a.localeCompare(b, "en"));
      throw new Error(
        `Required sample relations contain a cycle involving: ${cycle.join(", ")}. Required relation targets must be creatable first. Nothing was installed.`,
      );
    }
    layers.push(ready.map(([, planned]) => planned));
    for (const [id] of ready) {
      remaining.delete(id);
      created.add(id);
    }
  }
  return layers;
};
