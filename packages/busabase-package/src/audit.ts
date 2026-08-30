/**
 * Is this package **fit to publish**?
 *
 * Deliberately a different question from {@link validateTemplate}, and the split is
 * the point rather than an organisational preference:
 *
 * - `validateTemplate` **classifies**. Its verdict changes what install *does* — a
 *   Skill node, ownership stamps and a sample merge, versus a plain package install.
 *   Four consumers must agree on it or the catalog lies about what an install does,
 *   so it stays small and stable.
 * - `auditPackage` / `auditSkill` **advise**. Nothing behaves differently based on
 *   their verdict; they exist for the author and the reviewer, and are free to grow.
 *
 * The practical consequence: a declared screenshot that is not on disk belongs here,
 * never in `validateTemplate`. Promoting it there would stop a template installing
 * over a missing image, which is the wrong lever entirely.
 *
 * Nothing here re-checks what `validateTemplate` already decides (declared resources,
 * the sample-row ceiling, name agreement between manifest and manual, an unambiguous
 * primary AirApp). Run both; they compose.
 *
 * Purely static: no install, no network, and none of the package's own code is
 * executed — safe to run in CI over a pull request from someone you do not know.
 */

import {
  PACKAGE_SKILL_ENTRY,
  PACKAGE_SKILL_SIDECAR_DIRS,
} from "busabase-contract/domains/package/template";
import { SkillFrontmatterSchema } from "busabase-contract/domains/skill/frontmatter";

import { parseFrontmatter } from "./frontmatter";
import type { PackageFiles } from "./layout-read";
import type { PackageTree } from "./tree";

export type AuditSeverity = "error" | "warning";

export interface AuditFinding {
  severity: AuditSeverity;
  /** Stable kebab-case id, so callers can group or allowlist without matching prose. */
  rule: string;
  message: string;
}

export interface AuditOptions {
  /**
   * The directory the package was read from. The directory name IS the template's
   * identity — it must equal `busabase.json`'s `name` and the manual's `name` — so
   * without it that rule cannot run and is skipped rather than guessed.
   */
  directoryName?: string;
  /** Path prefix the files were read under, matching `readPackageTree`'s `root`. */
  root?: string;
}

/**
 * A materialized workspace id: busabase-core's `id()` is a three-letter prefix, the
 * creation time in base36, then seven random characters.
 *
 * The lookahead requiring a digit is what keeps ordinary words out — `recommendation`
 * has the right prefix and the wrong shape. A real id always carries its timestamp.
 */
const WORKSPACE_ID =
  /(?<![0-9a-z])(?:nod|bse|viw|rec|crq|ast|com|fom|shr|fvl|opr|cmt|rev|whd|aud)(?=[0-9a-z]{15}(?![0-9a-z]))(?=[0-9a-z]*\d)[0-9a-z]{15}/;

const TEXT_EXTENSIONS =
  /\.(?:js|mjs|cjs|ts|mts|cts|json|ndjson|md|html|css|ya?ml|txt)$|(?:^|\/)\.env(?:\.|$)/;

/**
 * Files that exist to *forbid* a string necessarily contain it. An AirApp's own
 * `scripts/check.mjs` asserts the obsolete API prefix is absent, and a test fixture
 * spells out the credential it proves gets rejected — scanning those turns a
 * correctly-guarded package into a failure.
 */
const IS_ASSERTION_CODE = /(?:^|\/)(?:scripts\/check\.mjs|tests?\/|[^/]*\.test\.[cm]?[jt]s)$/;

/** Lockfiles carry integrity hashes that are not ours to interpret. */
const NOT_SOURCE = /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/;

const relativePaths = (files: PackageFiles, root = ""): string[] => {
  const prefix = root ? `${root.replace(/\/+$/, "")}/` : "";
  const out: string[] = [];
  for (const key of files.keys()) {
    if (!prefix || key.startsWith(prefix)) out.push(key.slice(prefix.length));
  }
  return out;
};

const readText = (files: PackageFiles, root: string, relative: string): string | undefined => {
  const prefix = root ? `${root.replace(/\/+$/, "")}/` : "";
  return files.get(`${prefix}${relative}`)?.toString("utf8");
};

/**
 * Audit the package layer: identity, the assets the catalog promises, and anything
 * that must never be published.
 *
 * `files` is the flat map `readPackageTree` was given, not the tree. That is load-bearing:
 * `assets/screenshots/` holds no nodes and so never reaches the tree, and "the manifest
 * promises a screenshot that does not exist" is exactly a file-level question.
 */
export const auditPackage = (
  tree: PackageTree,
  files: PackageFiles,
  options: AuditOptions = {},
): AuditFinding[] => {
  const findings: AuditFinding[] = [];
  const error = (rule: string, message: string) =>
    findings.push({ severity: "error", rule, message });
  const warn = (rule: string, message: string) =>
    findings.push({ severity: "warning", rule, message });
  const root = options.root ?? "";
  const paths = relativePaths(files, root);
  const present = new Set(paths);

  // ── One identity ───────────────────────────────────────────────────────────
  if (options.directoryName !== undefined && options.directoryName !== tree.manifest.name) {
    error(
      "package/identity",
      `Directory is "${options.directoryName}" but busabase.json declares "${tree.manifest.name}". The directory name is the package's identity, not a label beside it.`,
    );
  }

  // ── The catalog card is not a promise the repo cannot keep ─────────────────
  for (const screenshot of tree.manifest.template?.screenshots ?? []) {
    if (!present.has(screenshot)) {
      error(
        "package/screenshot-missing",
        `busabase.json declares screenshot "${screenshot}", which is not in the package. The Template Center card would render a broken image.`,
      );
    }
  }

  // ── What must never be published ───────────────────────────────────────────
  for (const relative of paths) {
    const base = relative.slice(relative.lastIndexOf("/") + 1);
    if (/^\.env(?!\.example$)(?:\.|$)/.test(base)) {
      error(
        "package/dotenv",
        `${relative} is part of the package. Credentials belong in Vault, never in something people install.`,
      );
    }
    if (/^(?:id_rsa|id_ed25519)$/.test(base) || /\.(?:pem|p12|pfx|keystore)$/.test(base)) {
      error(
        "package/key-material",
        `${relative} looks like key material and must not be published.`,
      );
    }
    if (/(?:^|\/)(?:node_modules|dist|build)\//.test(relative)) {
      warn(
        "package/build-output",
        `${relative} looks like installed or built output. Ship source; the installer builds nothing.`,
      );
    }
  }

  // ── Somebody's live workspace, shipped to everyone ─────────────────────────
  for (const relative of paths) {
    if (!TEXT_EXTENSIONS.test(relative)) continue;
    if (NOT_SOURCE.test(relative) || IS_ASSERTION_CODE.test(relative)) continue;
    const source = readText(files, root, relative);
    if (source === undefined) continue;
    const found = WORKSPACE_ID.exec(source);
    if (found) {
      // One report per file: the fix is the same for every id in it.
      error(
        "package/workspace-ids",
        `${relative} contains "${found[0]}", a materialized workspace id. Node, Base and Space ids are whoever last ran setup's runtime state — publishing them ships one person's workspace layout to everyone.`,
      );
    }
  }

  return findings;
};

/**
 * Audit the Skill layer: is the manual one an agent can actually act on?
 *
 * Runs for any directory carrying a root `SKILL.md` — package or not, template or not.
 * It reports nothing at all when there is no manual: a package without one is a
 * perfectly legitimate thing to publish, not a Skill that failed.
 *
 * The honest limit: a checker can tell you the frontmatter parses and the files the
 * manual points at exist. It cannot tell you the manual is *true*. Everything in
 * `SKILL.md` becomes instructions an agent acts on, and no static rule catches a
 * confident, wrong sentence about what a table means.
 */
export const auditSkill = (files: PackageFiles, options: AuditOptions = {}): AuditFinding[] => {
  const findings: AuditFinding[] = [];
  const error = (rule: string, message: string) =>
    findings.push({ severity: "error", rule, message });
  const warn = (rule: string, message: string) =>
    findings.push({ severity: "warning", rule, message });
  const root = options.root ?? "";

  // Gated on the file, not on a package tree. A Skill needs no `busabase.json` and no
  // `content/` — most Skills are not packages at all — so requiring a tree here would
  // leave the commonest kind of Skill with nothing checking it, which is the gap this
  // function exists to close.
  const source = readText(files, root, PACKAGE_SKILL_ENTRY);
  if (source === undefined) return findings;

  let body = "";
  try {
    const parsed = parseFrontmatter(source, PACKAGE_SKILL_ENTRY);
    body = parsed.body;
    const frontmatter = SkillFrontmatterSchema.safeParse(parsed.data);
    if (!frontmatter.success) {
      error(
        "skill/frontmatter",
        `${PACKAGE_SKILL_ENTRY} frontmatter is not a valid Skill declaration: ${frontmatter.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
          .join("; ")}`,
      );
    } else if (frontmatter.data.description.trim() === "") {
      error(
        "skill/description",
        `${PACKAGE_SKILL_ENTRY} has no description. An agent chooses whether to reach for a Skill by reading it, so an empty one is not cosmetic — it is a Skill that never gets picked.`,
      );
    }
  } catch (cause) {
    error("skill/frontmatter", `${PACKAGE_SKILL_ENTRY}: ${(cause as Error).message}`);
    return findings;
  }

  // ── An unfinished export draft ─────────────────────────────────────────────
  const todos = (body.match(/^.*\bTODO\b.*$/gm) ?? []).length;
  if (todos > 0) {
    error(
      "skill/todo",
      `${PACKAGE_SKILL_ENTRY} still carries ${todos} TODO line(s). The export draft leaves them on purpose — an agent acts on what this file says, and a blank the author was meant to fill in is worse than nothing once it ships.`,
    );
  }

  // ── A reference that does not travel is an instruction nobody can follow ───
  const present = new Set(relativePaths(files, root));
  const sidecar = new RegExp(
    `\\]\\((\\.?/?(?:${PACKAGE_SIDECARS})/[^)\\s]+)\\)|\`((?:${PACKAGE_SIDECARS})/[^\`\\s]+)\``,
    "g",
  );
  const seen = new Set<string>();
  for (const match of body.matchAll(sidecar)) {
    const target = (match[1] ?? match[2]).replace(/^\.?\//, "");
    if (seen.has(target)) continue;
    seen.add(target);
    if (!present.has(target)) {
      warn(
        "skill/missing-reference",
        `${PACKAGE_SKILL_ENTRY} points at "${target}", which the package does not ship. An agent told to read it has an instruction it cannot satisfy.`,
      );
    }
  }

  return findings;
};

const PACKAGE_SIDECARS = PACKAGE_SKILL_SIDECAR_DIRS.join("|");
