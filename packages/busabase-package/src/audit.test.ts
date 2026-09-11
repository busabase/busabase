/**
 * Each case starts from one valid package and breaks exactly one thing, so every
 * rule is shown to fire rather than merely shown not to crash.
 *
 * The other half matters just as much: `auditPackage` and `auditSkill` must stay
 * silent on things `validateTemplate` already owns. Duplicating a rule across the two
 * would mean one of them eventually disagrees with the other.
 */
import { describe, expect, it } from "vitest";

import { auditPackage, auditSkill } from "./audit";
import { type PackageFiles, readPackageTree } from "./layout-read";

const NAME = "fixture-desk";

const SKILL_MD = `---
name: ${NAME}
description: "A fixture: does nothing, correctly."
metadata:
  busabase:
    template: true
    resources:
      - reviews
---

# Fixture Desk

Read \`references/taxonomy.md\` before classifying anything.
`;

const MANIFEST = {
  format: "busabase-package@1",
  name: NAME,
  description: "A fixture.",
  version: "1.0.0",
  template: {
    category: "ops",
    screenshots: ["assets/screenshots/overview.webp"],
    agentPrompts: ["Show me what is waiting for review."],
  },
};

const BASE = {
  name: "Reviews",
  description: "Review items",
  position: 0,
  // A publishable package tells the user what THIS app is for, per node — see
  // the `template/node-without-prompts` case below.
  agentPrompts: [
    {
      key: "triage",
      label: "Triage today's review queue",
      body: "Read the `fixture-desk` skill in this folder, then triage {target}.",
    },
  ],
  fields: [],
  views: [],
};

const files = (overrides: Record<string, string | null> = {}): PackageFiles => {
  const base: Record<string, string> = {
    "SKILL.md": SKILL_MD,
    "references/taxonomy.md": "# Taxonomy\n",
    "busabase.json": JSON.stringify(MANIFEST),
    "assets/screenshots/overview.webp": "not really a webp",
    "content/_folder.json": JSON.stringify({ name: "Fixture Desk" }),
    "content/reviews/base.json": JSON.stringify(BASE),
    "content/reviews/records.ndjson": `${JSON.stringify({ key: "r1", fields: { name: "Hi" } })}\n`,
  };
  const map: PackageFiles = new Map();
  for (const [path, contents] of Object.entries({ ...base, ...overrides })) {
    if (contents === null) continue;
    map.set(path, Buffer.from(contents));
  }
  return map;
};

const audit = (
  overrides: Record<string, string | null> = {},
  options: { directoryName?: string } = { directoryName: NAME },
) => {
  const map = files(overrides);
  const tree = readPackageTree(map);
  return [...auditPackage(tree, map, options), ...auditSkill(map, options)];
};

const rules = (findings: ReturnType<typeof audit>, severity: "error" | "warning" = "error") =>
  findings.filter((finding) => finding.severity === severity).map((finding) => finding.rule);

describe("a package fit to publish", () => {
  it("reports no errors", () => {
    expect(rules(audit())).toEqual([]);
  });

  it("reports no warnings either, so warnings stay meaningful", () => {
    expect(rules(audit(), "warning")).toEqual([]);
  });

  it("skips the identity rule when the directory name was not supplied", () => {
    expect(rules(audit({}, {}))).toEqual([]);
  });
});

describe("identity and the catalog card", () => {
  it("catches a directory name that drifted from the manifest", () => {
    expect(rules(audit({}, { directoryName: "renamed" }))).toContain("package/identity");
  });

  /**
   * Deliberately an audit rule and not a `validateTemplate` hard condition: promoting
   * it would stop a template installing over a missing image.
   */
  it("catches a declared screenshot that is not in the package", () => {
    expect(rules(audit({ "assets/screenshots/overview.webp": null }))).toContain(
      "package/screenshot-missing",
    );
  });

  it("catches a declared demo clip that is not in the package", () => {
    const withVideo = {
      ...MANIFEST,
      template: { ...MANIFEST.template, video: "assets/recordings/fixture.mp4" },
    };
    expect(rules(audit({ "busabase.json": JSON.stringify(withVideo) }))).toContain(
      "package/video-missing",
    );
  });

  it("accepts a declared demo clip that ships with the package", () => {
    const withVideo = {
      ...MANIFEST,
      template: { ...MANIFEST.template, video: "assets/recordings/fixture.mp4" },
    };
    expect(
      rules(
        audit({
          "busabase.json": JSON.stringify(withVideo),
          "assets/recordings/fixture.mp4": "not really an mp4",
        }),
      ),
    ).not.toContain("package/video-missing");
  });
});

describe("what must never be published", () => {
  it("catches a committed .env", () => {
    expect(rules(audit({ "content/reviews/.env": "KEY=live" }))).toContain("package/dotenv");
  });

  it("allows a .env.example", () => {
    expect(rules(audit({ ".env.example": "KEY=" }))).not.toContain("package/dotenv");
  });

  it("catches key material", () => {
    expect(rules(audit({ "server.pem": "-----BEGIN" }))).toContain("package/key-material");
  });

  it("catches a materialized workspace id", () => {
    const contents = JSON.stringify({ ...MANIFEST, description: "node nodmf3k29ax7b2q1z9" });
    expect(rules(audit({ "busabase.json": contents }))).toContain("package/workspace-ids");
  });

  it("does not mistake an ordinary word for an id", () => {
    const contents = JSON.stringify({
      ...MANIFEST,
      description: "recommendations and comparisons",
    });
    expect(rules(audit({ "busabase.json": contents }))).not.toContain("package/workspace-ids");
  });

  /**
   * A file that asserts a string is absent necessarily contains it. Scanning those
   * turns a correctly-guarded package into a failure.
   */
  it("does not scan a check script for what it forbids", () => {
    const check = 'if (/nodmf3k29ax7b2q1z9/.test(source)) throw new Error("id leaked");\n';
    expect(rules(audit({ "scripts/check.mjs": check }))).not.toContain("package/workspace-ids");
  });

  it("warns about committed build output", () => {
    expect(rules(audit({ "content/reviews/dist/bundle.js": "x" }), "warning")).toContain(
      "package/build-output",
    );
  });
});

describe("the manual an agent acts on", () => {
  it("catches an unfinished export draft", () => {
    const skill = SKILL_MD.replace("# Fixture Desk", "# Fixture Desk\n\nTODO: describe the job.");
    expect(rules(audit({ "SKILL.md": skill }))).toContain("skill/todo");
  });

  it("catches an empty description, which is a Skill that never gets picked", () => {
    const skill = SKILL_MD.replace(
      'description: "A fixture: does nothing, correctly."',
      'description: ""',
    );
    expect(rules(audit({ "SKILL.md": skill }))).toContain("skill/description");
  });

  it("warns about a reference the package does not ship", () => {
    expect(rules(audit({ "references/taxonomy.md": null }), "warning")).toContain(
      "skill/missing-reference",
    );
  });

  it("reports nothing for a plain package with no manual", () => {
    const map = files({ "SKILL.md": null, "references/taxonomy.md": null });
    expect(auditSkill(map)).toEqual([]);
  });
});

describe('installs, then leaves the user asking "now what?"', () => {
  it("warns when the package ships no manual to install beside its resources", () => {
    expect(rules(audit({ "SKILL.md": null, "references/taxonomy.md": null }), "warning")).toContain(
      "template/no-skill-node",
    );
  });

  it("warns about nodes with no scenario prompts, and names them", () => {
    const { agentPrompts: _drop, ...noPrompts } = BASE;
    const warnings = audit({ "content/reviews/base.json": JSON.stringify(noPrompts) }).filter(
      (finding) => finding.rule === "template/node-without-prompts",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("reviews");
  });

  it("does not count folders — a container has nothing to ask an agent for", () => {
    const map = files({
      "content/reviews/base.json": null,
      "content/reviews/records.ndjson": null,
      "content/notes/_folder.json": JSON.stringify({ name: "Notes" }),
    });
    const tree = readPackageTree(map);
    expect(
      auditPackage(tree, map, { directoryName: NAME }).map((finding) => finding.rule),
    ).not.toContain("template/node-without-prompts");
  });

  it("stays a warning — nothing here stops a package installing", () => {
    const { agentPrompts: _drop, ...noPrompts } = BASE;
    const findings = audit({
      "SKILL.md": null,
      "references/taxonomy.md": null,
      "content/reviews/base.json": JSON.stringify(noPrompts),
    });
    expect(findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });
});

/**
 * The split these two functions exist to preserve. `validateTemplate` classifies —
 * its verdict changes what install does, so four consumers must agree on it. The
 * audit advises. A rule living in both eventually means the two disagree.
 */
describe("no overlap with validateTemplate", () => {
  it("leaves a resource the manual invented to validateTemplate", () => {
    const skill = SKILL_MD.replace("- reviews", "- invoices");
    const reported = rules(audit({ "SKILL.md": skill }));
    expect(reported).not.toContain("resources/declared-missing");
    expect(reported).toEqual([]);
  });

  it("leaves name agreement between manifest and manual to validateTemplate", () => {
    const skill = SKILL_MD.replace(`name: ${NAME}`, "name: something-else");
    // The directory still matches the manifest, so the audit's own identity rule is silent.
    expect(rules(audit({ "SKILL.md": skill }))).toEqual([]);
  });
});
