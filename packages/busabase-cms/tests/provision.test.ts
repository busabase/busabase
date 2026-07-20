import { describe, expect, it, vi } from "vitest";
import {
  BUSABASE_CMS_METADATA_KEY,
  BUSABASE_CMS_SCHEMA_VERSION,
  type BusabaseCmsBaseIds,
  BusabaseCmsSchemaDriftError,
  type BusabaseCmsSchemaProfile,
  BusabaseCmsSetupError,
  createBusabaseCms,
  createBusabaseCmsSource,
} from "../src/index";
import { BUSABASE_CMS_ROLES, getBusabaseCmsBaseDefinition } from "../src/schema";
import type {
  BusabaseCmsBase,
  BusabaseCmsClient,
  BusabaseCmsField,
  BusabaseCmsNode,
  CreateBusabaseCmsBaseInput,
  CreateBusabaseCmsFieldInput,
} from "../src/source";

const clone = <T>(value: T): T => structuredClone(value);

const folderNode = (metadata: Record<string, unknown> = {}): BusabaseCmsNode => ({
  id: "folder-cms",
  parentId: null,
  type: "folder",
  slug: "team-content",
  name: "Team CMS / 团队内容管理",
  description: "",
  metadata,
  baseId: null,
  children: [],
});

const materializeFields = (
  baseId: string,
  fields: CreateBusabaseCmsBaseInput["fields"],
): BusabaseCmsField[] =>
  fields.map((field, position) => ({
    ...clone(field),
    id: `${baseId}-field-${field.slug}`,
    baseId,
    position,
  }));

interface StoreOptions {
  metadata?: Record<string, unknown>;
  existing?: boolean;
  renamed?: boolean;
  omitField?: { role: keyof BusabaseCmsBaseIds; slug: string };
  profile?: BusabaseCmsSchemaProfile;
  mutateCreatedField?: (field: BusabaseCmsField) => void;
}

const createStore = (options: StoreOptions = {}) => {
  const folder = folderNode(options.metadata);
  const bases = new Map<string, BusabaseCmsBase>();
  const nodes: BusabaseCmsNode[] = [];
  let nextId = 1;

  const addBase = (
    role: keyof BusabaseCmsBaseIds,
    fields: CreateBusabaseCmsBaseInput["fields"],
  ) => {
    const id = `base-${role}`;
    const definition = getBusabaseCmsBaseDefinition(
      role,
      {
        categories: "base-categories",
        tags: "base-tags",
      },
      options.profile,
    );
    const name = options.renamed ? `Renamed ${role}` : definition.name;
    const slug = options.renamed ? `custom-${role}` : `${folder.slug}-${role}`;
    const keptFields = fields.filter(
      (field) => options.omitField?.role !== role || options.omitField.slug !== field.slug,
    );
    const base: BusabaseCmsBase = {
      id,
      nodeId: `node-${role}`,
      slug,
      name,
      description: definition.description,
      fields: materializeFields(id, keptFields),
    };
    bases.set(id, base);
    nodes.push({
      id: base.nodeId,
      parentId: folder.id,
      type: "base",
      slug,
      name,
      description: base.description,
      metadata: {},
      baseId: id,
      children: [],
    });
  };

  if (options.existing) {
    const ids = { categories: "base-categories", tags: "base-tags" };
    for (const role of BUSABASE_CMS_ROLES) {
      addBase(role, getBusabaseCmsBaseDefinition(role, ids, options.profile).fields);
    }
  }

  const create = vi.fn(async (input: CreateBusabaseCmsBaseInput) => {
    if (nodes.some((node) => node.slug === input.slug || node.name === input.name)) {
      throw new Error("duplicate Base");
    }
    const id = `created-${nextId++}`;
    const base: BusabaseCmsBase = {
      id,
      nodeId: `node-${id}`,
      slug: input.slug,
      name: input.name,
      description: input.description,
      fields: materializeFields(id, input.fields),
    };
    bases.set(id, base);
    nodes.push({
      id: base.nodeId,
      parentId: folder.id,
      type: "base",
      slug: base.slug,
      name: base.name,
      description: base.description,
      metadata: {},
      baseId: base.id,
      children: [],
    });
    return clone(base);
  });

  const createField = vi.fn(async (input: CreateBusabaseCmsFieldInput) => {
    const base = bases.get(input.baseId);
    if (!base) throw new Error("missing Base");
    if (base.fields.some((field) => field.slug === input.slug)) throw new Error("duplicate field");
    const createdField: BusabaseCmsField = {
      ...clone(input),
      id: `${base.id}-field-${input.slug}`,
      position: base.fields.length,
    };
    options.mutateCreatedField?.(createdField);
    base.fields.push(createdField);
    return clone(base);
  });

  const updateMetadata = vi.fn(async ({ metadata }: { metadata: Record<string, unknown> }) => {
    folder.metadata = { ...folder.metadata, ...clone(metadata) };
    return clone(folder);
  });

  const client: BusabaseCmsClient = {
    bases: {
      get: vi.fn(async ({ baseId }) => {
        const byId = bases.get(baseId);
        const bySlug = [...bases.values()].find((base) => base.slug === baseId);
        return clone(byId ?? bySlug ?? null);
      }),
      create,
      createField,
    },
    nodes: {
      list: vi.fn(async (input) => {
        if (input?.parentId === folder.id) return clone(nodes);
        return [clone({ ...folder, children: nodes })];
      }),
      updateMetadata,
    },
    records: {
      listPaged: vi.fn(async () => ({ records: [], nextCursor: null })),
    },
  };

  return { client, folder, bases, nodes, create, createField, updateMetadata };
};

const cmsMetadata = (profile?: BusabaseCmsSchemaProfile): Record<string, unknown> => ({
  [BUSABASE_CMS_METADATA_KEY]: {
    schemaVersion: BUSABASE_CMS_SCHEMA_VERSION,
    ...(profile ? { profile } : {}),
    bases: {
      categories: "base-categories",
      tags: "base-tags",
      posts: "base-posts",
      pages: "base-pages",
    },
  },
});

const getField = (store: ReturnType<typeof createStore>, role: string, slug: string) => {
  const field = store.bases
    .get(`base-${role}`)
    ?.fields.find((candidate) => candidate.slug === slug);
  if (!field) throw new Error(`Missing test field ${role}.${slug}`);
  return field;
};

const addFixtureField = (
  store: ReturnType<typeof createStore>,
  role: string,
  field: CreateBusabaseCmsBaseInput["fields"][number],
) => {
  const base = store.bases.get(`base-${role}`);
  if (!base) throw new Error(`Missing test Base ${role}`);
  base.fields.push({
    ...clone(field),
    id: `${base.id}-field-${field.slug}`,
    baseId: base.id,
    position: base.fields.length,
  });
};

const applyBudaLiveSchema = (store: ReturnType<typeof createStore>) => {
  const posts = store.bases.get("base-posts");
  if (!posts) throw new Error("Missing test Posts Base");
  posts.fields = posts.fields.filter(
    (field) => !["legacy-paths", "seo-title", "seo-description"].includes(field.slug),
  );
  const cover = getField(store, "posts", "cover-image");
  cover.type = "text";
  cover.options = {};
  getField(store, "posts", "attachments").options = {
    attachment: {
      maxFiles: 10,
      maxFileSize: 10 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
    },
  };
  addFixtureField(store, "posts", {
    slug: "keywords",
    name: "Keywords",
    type: "json",
    required: false,
    options: {},
  });
  addFixtureField(store, "posts", {
    slug: "source-path",
    name: "Source path",
    type: "text",
    required: false,
    options: {},
  });

  const pages = store.bases.get("base-pages");
  if (!pages) throw new Error("Missing test Pages Base");
  pages.fields = pages.fields.filter(
    (field) => !["template", "legacy-paths", "seo-title", "seo-description"].includes(field.slug),
  );
  getField(store, "pages", "body").required = false;
  getField(store, "pages", "hero").required = true;
  const extraFields = [
    ["route", "text"],
    ["meta-title", "text"],
    ["meta-description", "longtext"],
    ["problem", "json"],
    ["messaging", "json"],
    ["use-cases", "json"],
    ["section-copy", "json"],
    ["final-cta", "json"],
    ["source-icp-id", "text"],
    ["source-path", "text"],
  ] as const;
  for (const [slug, type] of extraFields) {
    addFixtureField(store, "pages", {
      slug,
      name: slug,
      type,
      required: false,
      options: {},
    });
  }
};

describe("Folder-based CMS provisioning", () => {
  it("uses stable Base IDs from Folder metadata", async () => {
    const store = createStore({ existing: true, metadata: cmsMetadata() });
    const cms = createBusabaseCms({ client: store.client, folderId: store.folder.id });

    await cms.posts.list();

    expect(store.client.records.listPaged).toHaveBeenCalledWith({
      baseId: "base-posts",
      limit: 100,
      cursor: undefined,
    });
    expect(store.create).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("adopts an existing four-Base Folder and writes the stable ID mapping", async () => {
    const store = createStore({ existing: true });
    const cms = createBusabaseCms({ client: store.client, folderId: store.folder.id });

    await cms.pages.list();

    expect(store.create).not.toHaveBeenCalled();
    expect(store.updateMetadata).toHaveBeenCalledWith({
      nodeId: store.folder.id,
      metadata: cmsMetadata("standard"),
    });
  });

  it("does not adopt or modify an unrelated Base with a similar content schema", async () => {
    const store = createStore();
    const fields: CreateBusabaseCmsBaseInput["fields"] = [
      { slug: "path", name: "Path", type: "text", required: true, options: {} },
      { slug: "body", name: "Body", type: "html", required: true, options: {} },
    ];
    const unrelated: BusabaseCmsBase = {
      id: "base-campaigns",
      nodeId: "node-campaigns",
      slug: "campaigns",
      name: "Campaigns",
      description: "A separate HTML campaign builder",
      fields: materializeFields("base-campaigns", fields),
    };
    store.bases.set(unrelated.id, unrelated);
    store.nodes.push({
      id: unrelated.nodeId,
      parentId: store.folder.id,
      type: "base",
      slug: unrelated.slug,
      name: unrelated.name,
      description: unrelated.description,
      metadata: {},
      baseId: unrelated.id,
      children: [],
    });
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await cms.pages.list();

    expect(store.create.mock.calls.map(([input]) => input.name)).toContain("Pages / 页面");
    expect(store.bases.get(unrelated.id)?.fields.map((field) => field.slug)).toEqual([
      "path",
      "body",
    ]);
    expect(store.folder.metadata).not.toEqual(
      expect.objectContaining({
        [BUSABASE_CMS_METADATA_KEY]: expect.objectContaining({
          bases: expect.objectContaining({ pages: unrelated.id }),
        }),
      }),
    );
  });

  it("lazily creates the four complete Bases, relations, and metadata", async () => {
    const store = createStore();
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await cms.tags.list();

    expect(store.create.mock.calls.map(([input]) => input.name)).toEqual([
      "Categories / 分类",
      "Tags / 标签",
      "Posts / 文章",
      "Pages / 页面",
    ]);
    expect(store.create.mock.calls.map(([input]) => input.slug)).toEqual([
      "team-content-categories",
      "team-content-tags",
      "team-content-posts",
      "team-content-pages",
    ]);
    const postsInput = store.create.mock.calls[2]?.[0];
    expect(postsInput?.fields.find((field) => field.slug === "categories")?.options).toEqual({
      targetBaseId: "created-1",
      multiple: true,
    });
    expect(postsInput?.fields.find((field) => field.slug === "tags")?.options).toEqual({
      targetBaseId: "created-2",
      multiple: true,
    });
    expect(store.folder.metadata).toEqual({
      [BUSABASE_CMS_METADATA_KEY]: {
        schemaVersion: 1,
        profile: "standard",
        bases: {
          categories: "created-1",
          tags: "created-2",
          posts: "created-3",
          pages: "created-4",
        },
      },
    });
  });

  it("creates the Buda legacy field contract when that profile is selected", async () => {
    const store = createStore();
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "buda",
    });

    await cms.pages.list();

    const postsInput = store.create.mock.calls[2]?.[0];
    const pagesInput = store.create.mock.calls[3]?.[0];
    expect(postsInput?.fields.find((field) => field.slug === "cover-image")).toMatchObject({
      type: "text",
      required: false,
      options: {},
    });
    expect(postsInput?.fields.find((field) => field.slug === "attachments")?.options).toEqual({
      attachment: {
        maxFiles: 10,
        maxFileSize: 10 * 1024 * 1024,
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
      },
    });
    expect(pagesInput?.fields.some((field) => field.slug === "template")).toBe(false);
    expect(pagesInput?.fields.find((field) => field.slug === "body")?.required).toBe(true);
    expect(pagesInput?.fields.find((field) => field.slug === "hero")?.required).toBe(true);
    expect(store.folder.metadata).toEqual({
      [BUSABASE_CMS_METADATA_KEY]: {
        schemaVersion: 1,
        profile: "buda",
        bases: {
          categories: "created-1",
          tags: "created-2",
          posts: "created-3",
          pages: "created-4",
        },
      },
    });
  });

  it("supports a capability-complete custom source for lazy provisioning", async () => {
    const store = createStore();
    const cms = createBusabaseCms({
      source: createBusabaseCmsSource(store.client),
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await expect(cms.posts.list()).resolves.toEqual([]);
    expect(store.bases.size).toBe(4);
  });

  it("converges concurrent cold starts without duplicate Bases", async () => {
    const store = createStore();
    const first = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });
    const second = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await Promise.all([first.posts.list(), second.pages.list()]);

    expect(store.bases.size).toBe(4);
    expect(new Set([...store.bases.values()].map((base) => base.slug)).size).toBe(4);
    expect(store.create.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("re-reads a field after a concurrent create conflict", async () => {
    const store = createStore({
      existing: true,
      metadata: cmsMetadata(),
      omitField: { role: "pages", slug: "seo-description" },
    });
    const first = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });
    const second = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await Promise.all([first.pages.list(), second.pages.list()]);

    expect(
      store.bases.get("base-pages")?.fields.filter((field) => field.slug === "seo-description"),
    ).toHaveLength(1);
    expect(store.createField.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("reports incompatible schema drift without destructive changes", async () => {
    const store = createStore({ existing: true, metadata: cmsMetadata() });
    const posts = store.bases.get("base-posts");
    const path = posts?.fields.find((field) => field.slug === "path");
    if (path) path.type = "number";
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await expect(cms.posts.list()).rejects.toThrow(BusabaseCmsSchemaDriftError);
    await expect(cms.posts.list()).rejects.toThrow(
      "posts.path schema drift: type is number, expected text",
    );
    expect(store.createField).not.toHaveBeenCalled();
  });

  it("accepts the live-shaped standard attachment policy and stricter optional fields", async () => {
    const store = createStore({ existing: true });
    const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
    getField(store, "posts", "cover-image").options.attachment = {
      maxFiles: 1,
      maxFileSize: 10 * 1024 * 1024,
      allowedMimeTypes: imageTypes,
    };
    getField(store, "posts", "attachments").options.attachment = {
      maxFiles: 20,
      maxFileSize: 20 * 1024 * 1024,
      allowedMimeTypes: [...imageTypes, "application/pdf"],
    };
    getField(store, "pages", "seo-title").required = true;
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "standard",
    });

    await expect(cms.pages.list()).resolves.toEqual([]);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).toHaveBeenCalledWith({
      nodeId: store.folder.id,
      metadata: cmsMetadata("standard"),
    });
  });

  it("accepts attachment policies that are narrower than the standard upper bounds", async () => {
    const store = createStore({ existing: true, metadata: cmsMetadata("standard") });
    getField(store, "posts", "attachments").options.attachment = {
      maxFiles: 10,
      maxFileSize: 10 * 1024 * 1024,
      allowedMimeTypes: [" IMAGE/PNG ", "image/jpeg"],
    };
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await expect(cms.posts.list()).resolves.toEqual([]);
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("adopts the exact live-shaped Buda schema without adding legacy-incompatible fields", async () => {
    const store = createStore({ existing: true });
    applyBudaLiveSchema(store);
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "buda",
    });

    await expect(cms.posts.list()).resolves.toEqual([]);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).toHaveBeenCalledWith({
      nodeId: store.folder.id,
      metadata: cmsMetadata("buda"),
    });

    const restartedCms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "buda",
    });
    await expect(restartedCms.pages.list()).resolves.toEqual([]);
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).toHaveBeenCalledTimes(1);
  });

  it("rejects a newly materialized optional Buda Page body", async () => {
    const store = createStore({
      existing: true,
      metadata: cmsMetadata("buda"),
      profile: "buda",
      omitField: { role: "pages", slug: "body" },
      mutateCreatedField: (field) => {
        if (field.slug === "body") field.required = false;
      },
    });
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "buda",
    });

    await expect(cms.pages.list()).rejects.toThrow(
      "pages.body schema drift: required is false, expected true",
    );
    expect(store.createField).toHaveBeenCalledTimes(1);
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("preflights every existing field before adding an earlier missing field", async () => {
    const store = createStore({
      existing: true,
      metadata: cmsMetadata("standard"),
      omitField: { role: "categories", slug: "description" },
    });
    getField(store, "pages", "body").type = "markdown";
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await expect(cms.categories.list()).rejects.toThrow("pages.body schema drift");
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("does not create a missing Base when another existing Base has drift", async () => {
    const store = createStore({ existing: true });
    store.bases.delete("base-pages");
    const pageNodeIndex = store.nodes.findIndex((node) => node.baseId === "base-pages");
    store.nodes.splice(pageNodeIndex, 1);
    getField(store, "posts", "path").type = "number";
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
    });

    await expect(cms.posts.list()).rejects.toThrow("posts.path schema drift");
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("rejects a broader MIME policy and a wrong relation target without writes", async () => {
    const mimeStore = createStore({ existing: true, metadata: cmsMetadata("standard") });
    getField(mimeStore, "posts", "cover-image").options.attachment?.allowedMimeTypes?.push(
      "application/pdf",
    );
    const mimeCms = createBusabaseCms({
      client: mimeStore.client,
      folderId: mimeStore.folder.id,
      lazyCreate: true,
    });
    await expect(mimeCms.posts.list()).rejects.toThrow("allowedMimeTypes are broader");
    expect(mimeStore.createField).not.toHaveBeenCalled();
    expect(mimeStore.updateMetadata).not.toHaveBeenCalled();

    const relationStore = createStore({ existing: true, metadata: cmsMetadata("standard") });
    getField(relationStore, "posts", "categories").options.targetBaseId = "base-wrong";
    const relationCms = createBusabaseCms({
      client: relationStore.client,
      folderId: relationStore.folder.id,
      lazyCreate: true,
    });
    await expect(relationCms.posts.list()).rejects.toThrow("targetBaseId is base-wrong");
    expect(relationStore.createField).not.toHaveBeenCalled();
    expect(relationStore.updateMetadata).not.toHaveBeenCalled();
  });

  it("rejects a Folder profile mismatch before any schema write", async () => {
    const store = createStore({ existing: true, metadata: cmsMetadata("buda") });
    const cms = createBusabaseCms({
      client: store.client,
      folderId: store.folder.id,
      lazyCreate: true,
      schemaProfile: "standard",
    });

    await expect(cms.posts.list()).rejects.toThrow("bound to the buda CMS profile, not standard");
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });

  it("keeps resolving renamed Bases by metadata ID", async () => {
    const store = createStore({ existing: true, metadata: cmsMetadata(), renamed: true });
    const cms = createBusabaseCms({ client: store.client, folderId: store.folder.id });

    await cms.categories.list();

    expect(store.client.records.listPaged).toHaveBeenCalledWith(
      expect.objectContaining({ baseId: "base-categories" }),
    );
    expect(store.create).not.toHaveBeenCalled();
  });

  it("does not write missing structure unless lazyCreate is enabled", async () => {
    const store = createStore();
    const cms = createBusabaseCms({ client: store.client, folderId: store.folder.id });

    await expect(cms.posts.list()).rejects.toThrow(BusabaseCmsSetupError);
    expect(store.create).not.toHaveBeenCalled();
    expect(store.createField).not.toHaveBeenCalled();
    expect(store.updateMetadata).not.toHaveBeenCalled();
  });
});
