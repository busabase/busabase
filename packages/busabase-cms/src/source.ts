import { Busabase, type BusabaseConfig } from "busabase-sdk";

export type BusabaseCmsFieldType =
  | "text"
  | "longtext"
  | "markdown"
  | "html"
  | "attachment"
  | "relation"
  | "number"
  | "date"
  | "checkbox"
  | "select"
  | "multiselect"
  | "url"
  | "embed"
  | "email"
  | "phone"
  | "created_time"
  | "updated_time"
  | "created_by"
  | "updated_by"
  | "auto_number"
  | "ai_summary"
  | "ai_tags"
  | "code"
  | "yaml"
  | "json";

export interface BusabaseCmsFieldOptions {
  attachment?: {
    maxFiles?: number;
    allowedMimeTypes?: string[];
    maxFileSize?: number;
  };
  choices?: Array<{ id: string; name: string; color?: string }>;
  multiple?: boolean;
  targetBaseId?: string;
  targetBaseSlug?: string;
}

export interface BusabaseCmsField {
  id?: string;
  baseId?: string;
  slug: string;
  name: string | Record<string, string | undefined>;
  type: BusabaseCmsFieldType;
  required: boolean;
  position?: number;
  options: BusabaseCmsFieldOptions;
}

export interface BusabaseCmsBase {
  id: string;
  nodeId: string;
  slug: string;
  name: string;
  description: string;
  fields: BusabaseCmsField[];
}

export interface BusabaseCmsNode {
  id: string;
  parentId: string | null;
  type: string;
  slug: string;
  name: string;
  description: string;
  metadata: Record<string, unknown>;
  baseId: string | null;
  children: BusabaseCmsNode[];
}

export interface CreateBusabaseCmsBaseInput {
  parentNodeId: string;
  slug: string;
  name: string;
  description: string;
  fields: Array<Omit<BusabaseCmsField, "id" | "baseId" | "position">>;
  autoMerge: true;
}

export interface CreateBusabaseCmsFieldInput
  extends Omit<BusabaseCmsField, "id" | "baseId" | "position"> {
  baseId: string;
}

export interface BusabaseCmsRecord {
  id: string;
  status: "active" | "archived";
  updatedAt: string;
  headCommit: {
    fields: Record<string, unknown>;
  };
}

export interface BusabaseCmsSource {
  getBaseBySlug: (slug: string) => Promise<{ id: string; slug: string } | null>;
  getBaseById?: (baseId: string) => Promise<BusabaseCmsBase | null>;
  getNode?: (nodeId: string) => Promise<BusabaseCmsNode | null>;
  listDirectChildren?: (parentNodeId: string) => Promise<BusabaseCmsNode[]>;
  createBase?: (input: CreateBusabaseCmsBaseInput) => Promise<BusabaseCmsBase>;
  createField?: (input: CreateBusabaseCmsFieldInput) => Promise<BusabaseCmsBase>;
  updateNodeMetadata?: (input: {
    nodeId: string;
    metadata: Record<string, unknown>;
  }) => Promise<BusabaseCmsNode>;
  listRecordsPage: (input: { baseId: string; limit: number; cursor?: string }) => Promise<{
    records: BusabaseCmsRecord[];
    nextCursor: string | null;
  }>;
}

export interface BusabaseCmsClient {
  bases: {
    get: (input: { baseId: string }) => Promise<BusabaseCmsBase | null>;
    create: (
      input: CreateBusabaseCmsBaseInput,
    ) => Promise<BusabaseCmsBase | { materialized: false }>;
    createField: (input: CreateBusabaseCmsFieldInput) => Promise<BusabaseCmsBase>;
  };
  nodes: {
    list: (input?: { parentId?: string | null; depth?: number }) => Promise<BusabaseCmsNode[]>;
    updateMetadata: (input: {
      nodeId: string;
      metadata: Record<string, unknown>;
    }) => Promise<BusabaseCmsNode>;
  };
  records: {
    listPaged: (input: { baseId: string; limit: number; cursor?: string }) => Promise<{
      records: BusabaseCmsRecord[];
      nextCursor: string | null;
    }>;
  };
}

const findNode = (nodes: BusabaseCmsNode[], nodeId: string): BusabaseCmsNode | null => {
  for (const node of nodes) {
    if (node.id === nodeId) return node;
    const child = findNode(node.children, nodeId);
    if (child) return child;
  }
  return null;
};

export const createBusabaseCmsSource = (
  client: BusabaseCmsClient = new Busabase(),
): BusabaseCmsSource => ({
  getBaseBySlug: async (slug) => client.bases.get({ baseId: slug }),
  getBaseById: async (baseId) => client.bases.get({ baseId }),
  getNode: async (nodeId) => findNode(await client.nodes.list(), nodeId),
  listDirectChildren: async (parentNodeId) =>
    client.nodes.list({ parentId: parentNodeId, depth: 1 }),
  createBase: async (input) => {
    const result = await client.bases.create(input);
    if (!("fields" in result)) {
      throw new Error("Busabase did not materialize the Base despite autoMerge: true");
    }
    return result;
  },
  createField: async (input) => client.bases.createField(input),
  updateNodeMetadata: async (input) => client.nodes.updateMetadata(input),
  listRecordsPage: async (input) => client.records.listPaged(input),
});

export const createBusabaseCmsSourceFromConfig = (config?: BusabaseConfig): BusabaseCmsSource =>
  createBusabaseCmsSource(new Busabase(config));
