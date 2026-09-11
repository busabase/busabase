import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { buildSkillMarkdown } from "busabase-core/skill-doc";

/**
 * `busabase-cli skill` — print (or install) the Busabase Agent Skill without needing
 * the skill to already be installed.
 *
 * The gap this closes: a user can end up with ONLY the CLI — `npx busabase-cli` in a
 * CI step, a shell one-liner an agent found, a machine where `npx skills add` never
 * ran. Until now that user had `guide`, which is a pure passthrough to the server's
 * `GET /guides/{topic}`: unauthenticated agents, unreachable servers, and self-hosted
 * installs (whose guide catalog carries only `workspace` + `airapp`, never `setup`)
 * all got nothing back at exactly the moment they needed onboarding most.
 *
 * So the CLI carries its own copy. `busabase-core/skill-doc` is a zero-import module
 * of template literals — the same function both `/SETUP_SKILL.md` routes call — so
 * bundling it into `dist` costs a few KB of text and makes `skill` work with no
 * network, no credential, and no server at all.
 *
 * Two documents, one source:
 * - `skill` (default topic `busabase`) — the RUNTIME manual for an already-connected
 *   workspace. Generated locally and deterministically from the resolved base URL, so
 *   it never fails.
 * - `skill setup` — the BOOTSTRAP doc, byte-identical to `GET /SETUP_SKILL.md`. Fetched
 *   from the server first (it is edition-aware and always current), with the bundled
 *   copy as the fallback so an old server or a dead network still produces a document.
 */

/** Topics `busabase-cli skill` accepts. `busabase` is the default. */
export const SKILL_TOPICS = ["busabase", "setup"] as const;
export type SkillTopic = (typeof SKILL_TOPICS)[number];

/**
 * The single-tenant space id an open-source/Desktop install always reports.
 * Duplicated as a literal rather than imported from `busabase-core/context`: that
 * module pulls in drizzle and AsyncLocalStorage, which would drag the whole server
 * graph into this published CLI. `skill-doc` is the only part of core safe to bundle.
 */
const LOCAL_SPACE_ID = "local";

/** Where the canonical, non-personalised copies of the skills are published. */
export const SKILL_REGISTRY_HINT =
  "npx skills add busabase/skills --skill busabase busabase-app-creator";

export type SkillMode = "local" | "cloud";

export function parseSkillTopic(raw: string | undefined): SkillTopic {
  if (raw === undefined) return "busabase";
  const topic = raw.trim().toLowerCase();
  if ((SKILL_TOPICS as readonly string[]).includes(topic)) return topic as SkillTopic;
  throw new Error(
    `Unknown skill topic "${raw}". Available: ${SKILL_TOPICS.join(", ")}. ` +
      "Omit the topic for the everyday Busabase skill.",
  );
}

/**
 * Which edition this CLI is pointed at, which decides whether the document teaches
 * an `Authorization` header and space targeting at all.
 *
 * An explicit `--mode` wins. Otherwise a space id of `local` is decisive (that is the
 * only value a single-tenant install ever reports), and failing that the host decides
 * — reusing `isLocalHost` from the login flow rather than growing a second, subtly
 * different notion of "is this a local server" that could disagree with it.
 */
export function resolveSkillMode(input: {
  baseUrl: string;
  spaceId?: string;
  override?: string;
  isLocalHost: (baseUrl: string) => boolean;
}): SkillMode {
  if (input.override === "local" || input.override === "cloud") return input.override;
  if (input.spaceId === LOCAL_SPACE_ID) return "local";
  return input.isLocalHost(input.baseUrl) ? "local" : "cloud";
}

export interface SkillDocOptions {
  baseUrl: string;
  mode: SkillMode;
  spaceId?: string;
  /**
   * Opt-in only. The runtime document interpolates this key into every example, and
   * `skill install` writes that document to a file inside the user's project — so the
   * default has to be the placeholder, or `--install` would quietly commit a live
   * credential to a repo.
   */
  apiKey?: string;
}

/** The everyday `busabase` skill: how to drive an already-connected workspace. */
export function buildRuntimeSkillDoc(opts: SkillDocOptions): string {
  return buildSkillMarkdown(opts.baseUrl, {
    mode: opts.mode,
    // A cloud document with no space id falls back to the `YOUR_SPACE_ID` placeholder
    // inside `buildSkillMarkdown`, which is what an unconfigured CLI should print.
    spaceId: opts.mode === "local" ? LOCAL_SPACE_ID : opts.spaceId,
    apiKey: opts.apiKey,
  });
}

/**
 * The bundled stand-in for `GET /SETUP_SKILL.md`. `editionConfirmed` is true because,
 * unlike the website dispatcher, a CLI run already knows which edition it is talking
 * to — the base URL it was configured with. Asking the user to pick an edition again
 * would be a step backwards.
 */
export function buildBootstrapSkillDoc(opts: SkillDocOptions): string {
  return buildSkillMarkdown(opts.baseUrl, {
    mode: opts.mode,
    stage: "bootstrap",
    editionConfirmed: true,
    spaceId: opts.mode === "local" ? undefined : opts.spaceId,
    apiKey: opts.apiKey,
  });
}

export interface SetupFetchResult {
  content: string | null;
  /** Why the live document was not used — surfaced on stderr so a stale doc is never silent. */
  reason?: string;
}

/**
 * Try the server's own `/SETUP_SKILL.md`. Unauthenticated on every edition, so this
 * works before login. Any failure returns `null` with a reason instead of throwing:
 * the caller's fallback is a complete document, so a network blip must not turn into
 * a non-zero exit for a command whose entire job is "explain how to get started".
 */
export async function fetchSetupSkill(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<SetupFetchResult> {
  const url = new URL("/SETUP_SKILL.md", `${baseUrl.replace(/\/$/, "")}/`).toString();
  try {
    const response = await fetchImpl(url, { headers: { accept: "text/plain, text/markdown" } });
    if (!response.ok) {
      return {
        content: null,
        reason: `${url} returned HTTP ${response.status} (a server older than this document, or not a Busabase host)`,
      };
    }
    const body = await response.text();
    // A reverse proxy or a captive portal answering 200 with an HTML login page is a
    // realistic failure here, and shipping that to stdout as "your skill" would be
    // worse than falling back. Every generated document opens with YAML frontmatter.
    if (!body.trimStart().startsWith("---")) {
      return { content: null, reason: `${url} did not return a skill document` };
    }
    return { content: body };
  } catch (error) {
    return { content: null, reason: `${url} is unreachable (${(error as Error).message})` };
  }
}

/**
 * Where an installed skill goes. Preference order is "the project the user is standing
 * in, if it already keeps skills" before "this user's global Claude directory" — an
 * existing `.agents/skills` is unambiguous evidence of where this repo wants them, and
 * creating a stray one next to it would split the registry.
 */
export function resolveSkillsDir(input: {
  explicit?: string;
  cwd: string;
  home: string;
  exists: (path: string) => boolean;
}): string {
  if (input.explicit) {
    return isAbsolute(input.explicit) ? input.explicit : resolve(input.cwd, input.explicit);
  }
  for (const candidate of [".agents/skills", ".claude/skills"]) {
    const dir = join(input.cwd, candidate);
    if (input.exists(dir)) return dir;
  }
  return join(input.home, ".claude", "skills");
}

export interface InstallSkillResult {
  path: string;
  written: boolean;
  /** Set when nothing was written, so the caller can explain why without re-deriving it. */
  reason?: string;
}

/**
 * Write `<dir>/busabase/SKILL.md`. Refuses to clobber by default: the file may well be
 * a copy the user has since edited for their own workspace, and silently replacing it
 * with a freshly generated one would destroy that with no way back.
 */
export function installSkillDoc(input: {
  dir: string;
  content: string;
  force: boolean;
  exists?: (path: string) => boolean;
  write?: (path: string, content: string) => void;
}): InstallSkillResult {
  const exists = input.exists ?? existsSync;
  const write =
    input.write ??
    ((path: string, content: string) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    });
  const path = join(input.dir, "busabase", "SKILL.md");
  if (exists(path) && !input.force) {
    return {
      path,
      written: false,
      reason: "a skill is already installed there; pass --force to replace it",
    };
  }
  write(path, content(input.content));
  return { path, written: true };
}

/** Documents are written with a trailing newline, so appending to them stays clean. */
const content = (body: string): string => (body.endsWith("\n") ? body : `${body}\n`);

export const skillsDirDefaultHint = (): string => join(homedir(), ".claude", "skills");

export interface ResolvedSkillDocument {
  content: string;
  source: "embedded" | "server";
  /** Non-empty whenever the printed document is NOT the live one, so it is never silent. */
  note?: string;
}

/**
 * Decide which copy of the requested document to print.
 *
 * The runtime skill is always generated locally: it is a deterministic function of the
 * base URL and edition, no server holds a better version, and going to the network for
 * it would only add a way to fail. The bootstrap doc is the opposite — the server's copy
 * is edition-aware and tracks the product, so it wins whenever it can be had, and the
 * bundled copy exists purely so that "can't reach it" still produces a document.
 */
export async function resolveSkillDocument(
  topic: SkillTopic,
  doc: SkillDocOptions,
  runtime: { offline: boolean; fetchImpl: typeof fetch; cliVersion: string },
): Promise<ResolvedSkillDocument> {
  if (topic === "busabase") return { content: buildRuntimeSkillDoc(doc), source: "embedded" };
  const bundled = (reason: string): ResolvedSkillDocument => ({
    content: buildBootstrapSkillDoc(doc),
    source: "embedded",
    note: `printed the copy bundled with busabase-cli ${runtime.cliVersion} — ${reason}.`,
  });
  if (runtime.offline) return bundled("--offline was set");
  const live = await fetchSetupSkill(doc.baseUrl, runtime.fetchImpl);
  return live.content
    ? { content: live.content, source: "server" }
    : bundled(live.reason ?? "the live document could not be read");
}
