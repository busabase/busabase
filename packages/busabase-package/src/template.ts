/**
 * Is this package a **template** — a package that is also an Agent Skill?
 *
 * One function answers that for all four consumers, which is the point: the
 * Template Center's index CI, `busabase-cli install`, the dashboard's install
 * preview, and an agent checking its own output must never disagree about what
 * counts. A skill that shows up as a card but installs as a plain package (or
 * the reverse) is a trust bug, not a cosmetic one.
 *
 * Purely static: no AirApp is started, no script is executed, no server is
 * contacted. That is what lets it run in CI over a whole repo and inline in an
 * install preview without a timeout budget.
 *
 * **Hard conditions** (any failure ⇒ not a template). They are deliberately few,
 * and every one of them is something that would otherwise become a confusing
 * runtime failure for the installing user rather than a publishing error for
 * the author.
 *
 * **Soft conditions** are warnings: the package still installs and still lists,
 * the card is just honest about what is missing. A data-only template is a
 * legitimate thing to publish; one that silently claims to have an app is not.
 *
 * Crucially, a package that fails validation is NOT rejected from installing —
 * it installs as a plain `busabase-package@1`, exactly as it did before
 * templates existed. Failing to be a template is never a reason to refuse a
 * valid package.
 *
 * Spec: `apps/busabase/content/spec/template-center.md` §5.3.
 */
import {
  PACKAGE_SKILL_ENTRY,
  resolvePrimaryAirApp,
  SkillFrontmatterSchema,
  TEMPLATE_MAX_SAMPLE_RECORDS_PER_BASE,
  type TemplateManifest,
} from "busabase-contract/domains/package/template";
import { parseFrontmatter } from "./frontmatter";
import { type PackageFileTreeNode, type PackageNode, type PackageTree, walkNodes } from "./tree";

export interface TemplateValidation {
  /** True ⇢ install as a template (Skill node, ownership stamps, sample merge). */
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Resolved primary AirApp slug, when there is one. */
  primaryAirApp?: string;
  /** Parsed `metadata.busabase` from the root SKILL.md, when readable. */
  template?: TemplateManifest;
}

/**
 * `PackageFileTreeNode.type` is the whole skill|airapp|drive union rather than a
 * literal, so a discriminated-union `Extract` narrows to `never` here — the
 * predicate does the narrowing instead.
 */
const isAirApp = (node: PackageNode): node is PackageFileTreeNode => node.type === "airapp";

const airAppSlugs = (tree: PackageTree): string[] =>
  [...walkNodes(tree.nodes)].filter(isAirApp).map((node) => node.slug);

const baseSlugs = (tree: PackageTree): Set<string> =>
  new Set(
    [...walkNodes(tree.nodes)].filter((node) => node.type === "base").map((node) => node.slug),
  );

export const validateTemplate = (tree: PackageTree): TemplateValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const template = tree.manifest.template;

  // ── Hard 1: the root SKILL.md, and its explicit opt-in ────────────────────
  if (!tree.rootSkill) {
    return {
      ok: false,
      errors: [`No ${PACKAGE_SKILL_ENTRY} at the package root — this is a plain package.`],
      warnings,
    };
  }

  const entry = tree.rootSkill.files.find((file) => file.path === PACKAGE_SKILL_ENTRY);
  let frontmatter: ReturnType<typeof SkillFrontmatterSchema.safeParse> | undefined;
  if (entry) {
    try {
      const { data } = parseFrontmatter(entry.bytes.toString("utf8"), PACKAGE_SKILL_ENTRY);
      frontmatter = SkillFrontmatterSchema.safeParse(data);
      if (!frontmatter.success) {
        errors.push(
          `${PACKAGE_SKILL_ENTRY} frontmatter is not a valid skill declaration: ${frontmatter.error.issues
            .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
            .join("; ")}`,
        );
      }
    } catch (error) {
      errors.push(`${PACKAGE_SKILL_ENTRY}: ${(error as Error).message}`);
    }
  }

  const skill = frontmatter?.success ? frontmatter.data : undefined;
  const busabaseMeta = skill?.metadata?.busabase;
  if (skill && busabaseMeta?.template !== true) {
    errors.push(
      `${PACKAGE_SKILL_ENTRY} does not opt in as a template. Add \`metadata.busabase.template: true\` to publish it in the Template Center.`,
    );
  }

  // ── Hard 2: the manifest's template object ────────────────────────────────
  if (!template) {
    errors.push(
      `${PACKAGE_SKILL_ENTRY} declares a template but busabase.json has no \`template\` object (at least \`category\` is required).`,
    );
  }

  // ── Hard 7: one identity ──────────────────────────────────────────────────
  if (skill && skill.name !== tree.manifest.name) {
    errors.push(
      `Name mismatch: ${PACKAGE_SKILL_ENTRY} declares "${skill.name}" but busabase.json declares "${tree.manifest.name}". They are the same app and must agree.`,
    );
  }

  // ── Hard 4: the manual's resources exist ──────────────────────────────────
  const bases = baseSlugs(tree);
  for (const key of busabaseMeta?.resources ?? []) {
    if (!bases.has(key)) {
      errors.push(
        `${PACKAGE_SKILL_ENTRY} lists resource "${key}", but content/ has no Base with that slug. An agent told about a table that does not exist will write to the wrong one.`,
      );
    }
  }

  // ── Hard 5: the primary AirApp is unambiguous ─────────────────────────────
  const airapps = airAppSlugs(tree);
  const resolved = resolvePrimaryAirApp(template, airapps);
  let primaryAirApp: string | undefined;
  if ("slug" in resolved) {
    primaryAirApp = resolved.slug;
  } else if (airapps.length > 0 || template?.airapp || template?.airapps?.length) {
    // "no AirApp at all" is a soft condition, not a hard one — data-only
    // templates are allowed. Anything else means the author declared or shipped
    // apps that cannot be resolved to one, which the installer must not guess.
    errors.push(resolved.error);
  }

  // ── Hard 6: an AirApp that can actually boot ──────────────────────────────
  // (`layout-read` already refuses a package whose AirApp has no package.json,
  // so by the time a tree exists this is about the `dev` script nodepod runs.)
  for (const node of walkNodes(tree.nodes)) {
    if (!isAirApp(node)) continue;
    const manifestFile = node.files.find((file) => file.path === "package.json");
    if (!manifestFile) continue;
    let scripts: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(manifestFile.bytes.toString("utf8")) as {
        scripts?: Record<string, unknown>;
      };
      scripts = parsed.scripts;
    } catch (error) {
      errors.push(
        `AirApp "${node.slug}": package.json is not valid JSON (${(error as Error).message}).`,
      );
      continue;
    }
    if (typeof scripts?.dev !== "string") {
      errors.push(
        `AirApp "${node.slug}": package.json has no \`dev\` script. Busabase starts an AirApp with \`npm run dev\`, so without it the app installs and then never boots.`,
      );
    }
  }

  // ── Soft conditions ───────────────────────────────────────────────────────
  if (airapps.length === 0) {
    warnings.push(
      "No AirApp — this template installs data only. Users will see tables, not an app.",
    );
  }
  if (template?.requires?.airapp && airapps.length === 0) {
    errors.push("template.requires.airapp is true, but content/ contains no AirApp.");
  }
  let hasSamples = false;
  for (const node of walkNodes(tree.nodes)) {
    if (node.type !== "base") continue;
    if (node.records.length > 0) hasSamples = true;
    if (node.records.length > TEMPLATE_MAX_SAMPLE_RECORDS_PER_BASE) {
      errors.push(
        `Base "${node.slug}" carries ${node.records.length} sample records, above the ${TEMPLATE_MAX_SAMPLE_RECORDS_PER_BASE} per-Base limit for templates. A template seeds a demo; it does not ship a dataset.`,
      );
    }
  }
  if (!hasSamples) {
    warnings.push("No sample records — the app will be empty on first open.");
  }
  if (!template?.screenshots.length) {
    warnings.push("No screenshots declared — the Template Center card will use a placeholder.");
  }
  if (!template?.agentPrompts.length) {
    warnings.push('No agentPrompts declared — "Ask agent" will open with an empty prompt.');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    ...(primaryAirApp ? { primaryAirApp } : {}),
    ...(template ? { template } : {}),
  };
};

/** Convenience for callers that only need the yes/no (index CI, install branch). */
export const isTemplate = (tree: PackageTree): boolean => validateTemplate(tree).ok;

/**
 * A starting SKILL.md for a folder that has resources but no manual yet.
 *
 * Deterministic, never generated by a model: this text becomes instructions an
 * agent will act on, and a plausible-sounding invention about what a table means
 * is worse than an obvious blank to fill in. Everything here is read off the
 * structure that actually exists — table names, their fields, whether there is
 * an app — and every judgement the author has to make is left as an explicit
 * TODO rather than guessed at.
 *
 * Used by `export --template` and by "Publish as template" in the dashboard.
 */
export const deriveSkillDraft = (tree: PackageTree): string => {
  const nodes = [...walkNodes(tree.nodes)];
  const bases = nodes.filter((node) => node.type === "base");
  const airapps = nodes.filter(isAirApp);
  const name = tree.manifest.name;
  const description = tree.manifest.description || `TODO: one line on what ${name} does.`;

  // Quoted, always. A description is free text and routinely contains a colon
  // ("Inbox triage: drafts and approvals"), which unquoted turns the line into a
  // nested mapping and makes the whole frontmatter unparseable — so the draft
  // this function exists to hand the author would arrive already broken.
  // JSON string syntax is a subset of YAML's double-quoted scalar, so
  // `JSON.stringify` is both correct and escape-complete here.
  const yamlString = (value: string): string => JSON.stringify(value);

  const resourceLines = bases.map((node) => `      - ${yamlString(node.slug)}`).join("\n");
  const resourceDocs = bases
    .map((node) => {
      if (node.type !== "base") return "";
      const fields = node.base.fields.map((field) => field.slug).join(", ");
      return `- \`${node.slug}\`: ${node.description || "TODO: what this table is for."}${
        fields ? ` Fields: ${fields}.` : ""
      }`;
    })
    .filter(Boolean)
    .join("\n");

  return `---
name: ${yamlString(name)}
description: ${yamlString(description)}
metadata:
  busabase:
    template: true
${bases.length ? `    resources:\n${resourceLines}\n` : ""}---

# ${name}

TODO: describe the job this app does, and when an agent should reach for it.

## Busabase resources

${resourceDocs || "TODO: list this app's tables and what each one holds."}
${
  airapps.length
    ? `\n## App\n\n\`${airapps[0].slug}\` is the app's interface. Point the user at it rather than describing rows back to them.\n`
    : ""
}
## Boundary

TODO: state what this app must never do — send messages, call external APIs,
merge its own proposals. Be explicit; an agent follows what is written here.

## Workflow

Propose changes as Change Requests and wait for a human to review them. Never
review or merge your own proposal.
`;
};
