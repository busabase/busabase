import { describe, expect, it } from "vitest";
import { buildSkillMarkdown } from "../src/skill-doc";

/**
 * The skill doc is the agent-facing contract for the HTTP API. It previously told
 * agents to loop one change request per record, to merge a folder before
 * referencing it, and to upload files through the old attachments CLI. Those are
 * all now false. These assertions pin that the doc advertises the bulk / batch /
 * temp-ref / assets capabilities and never reintroduces stale guidance.
 */

const cloud = buildSkillMarkdown("https://busabase.com", { mode: "cloud", spaceId: "spc_x" });
const local = buildSkillMarkdown("http://localhost:15419", { mode: "local" });
const cloudBootstrap = buildSkillMarkdown("https://busabase.com", {
  mode: "cloud",
  stage: "bootstrap",
  editionConfirmed: true,
  spaceId: "spc_x",
});
const localBootstrap = buildSkillMarkdown("https://busabase.com", {
  mode: "local",
  stage: "bootstrap",
  editionConfirmed: true,
});
const cloudDispatcher = buildSkillMarkdown("https://busabase.com", {
  mode: "cloud",
  stage: "bootstrap",
  spaceId: "spc_x",
});
const desktopDispatcher = buildSkillMarkdown("https://busabase.com", {
  mode: "local",
  stage: "bootstrap",
});

const setupDescription =
  "Guide users through choosing and connecting to Busabase, authorizing Busabase Cloud when needed, and installing the Busabase Agent Skills for ongoing use.";

function canonicalUrl(doc: string, label: "Cloud" | "Personal Desktop"): URL {
  const prefix = label === "Cloud" ? "- **A / Cloud:** " : "- **B / Personal Desktop:** ";
  const line = doc.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`Missing ${label} canonical URL`);
  return new URL(line.slice(prefix.length));
}

function setupStepNumbers(doc: string): number[] {
  return Array.from(doc.matchAll(/^## Step (\d+) —/gm), (match) => Number(match[1]));
}

describe("buildSkillMarkdown advertises the batch/bulk/temp-ref/assets surface", () => {
  it("documents standard OAuth access tokens without the removed session format", () => {
    const authenticated = buildSkillMarkdown("https://busabase.com", {
      apiKey: "bso_example",
      mode: "cloud",
      spaceId: "spc_x",
    });
    expect(authenticated).toContain("rotating OAuth\naccess token");
    expect(authenticated).toContain("`bso_…`");
    expect(authenticated).not.toContain("`bss_…`");
  });

  it("documents the bulk record change-request endpoint", () => {
    for (const doc of [cloud, local]) {
      expect(doc).toContain("/records/bulk-change-request");
      expect(doc).toContain('"records"');
    }
  });

  it("documents batch review and merge", () => {
    expect(cloud).toContain("/change-requests/reviews");
    expect(cloud).toContain("/change-requests/merge");
    expect(cloud).toContain('"changeRequestIds"');
  });

  it("documents in-CR node temp references", () => {
    expect(cloud).toContain("parentNodeRef");
    expect(cloud).toContain('"ref"');
  });

  it("documents asset-backed attachment uploads", () => {
    for (const doc of [cloud, local]) {
      expect(doc).toContain("/api/v1/assets/upload-urls");
      expect(doc).toContain("/api/v1/assets/confirmations");
      expect(doc).toContain("busabase-cli assets upload");
      expect(doc).toContain("assetId");
      expect(doc).toContain("attachmentId");
    }
  });

  it("does not reintroduce the removed attachments upload command", () => {
    for (const doc of [cloud, local]) {
      expect(doc).not.toContain("busabase-cli attachments upload");
    }
  });

  it("no longer claims there is no bulk endpoint", () => {
    for (const doc of [cloud, local]) {
      expect(doc).not.toContain("there is no bulk endpoint");
    }
  });

  it("describes the multi-space guard as a rejection, not a silent fallback", () => {
    // Cloud space-targeting section must reflect the 400-on-ambiguity behavior.
    expect(cloud).toMatch(/rejected|400/);
    expect(cloud).not.toContain("silently falls back to the\nuser's default space");
  });
});

describe("generated Cloud onboarding", () => {
  it("installs both permanent Busabase skills explicitly", () => {
    for (const doc of [cloudBootstrap, localBootstrap]) {
      expect(doc).toMatch(
        /^npx skills add busabase\/skills --skill busabase busabase-app-creator$/m,
      );
      expect(doc).toContain("`busabase` and `busabase-app-creator` are permanent");
    }
  });

  it("uses device authorization without exposing or requesting secrets", () => {
    const cloudWithoutPreselectedSpace = buildSkillMarkdown("https://busabase.com", {
      mode: "cloud",
      stage: "bootstrap",
      editionConfirmed: true,
    });

    expect(
      cloudWithoutPreselectedSpace
        .split("\n")
        .find((line) => line.startsWith("npx --yes busabase-cli@latest login ")),
    ).toBe("npx --yes busabase-cli@latest login --device-code --base-url https://busabase.com");
    expect(cloudWithoutPreselectedSpace).toContain("Login never asks which Space to use");
    expect(cloudWithoutPreselectedSpace).toContain(
      "it takes the server default (the Space the user was most\nrecently active in)",
    );
    expect(cloudBootstrap).not.toContain("--use-default-space");
    expect(localBootstrap).not.toContain("--use-default-space");
    expect(cloudWithoutPreselectedSpace).not.toContain("--use-default-space");
    expect(cloudWithoutPreselectedSpace).not.toContain("--non-interactive");
    expect(cloudBootstrap).toContain("selects an\nexisting API key or creates a new one");
    expect(cloudBootstrap).toContain("The browser never receives the\nkey secret");
    expect(cloudBootstrap).not.toContain("cat ~/.busabase/.env");
    expect(cloudBootstrap).not.toContain("<paste the new key>");
    expect(cloudBootstrap).not.toContain('export BUSABASE_API_KEY="sk_');
  });

  it("requires the agent to surface the selected Space to the user, not just switch silently", () => {
    const cloudWithoutPreselectedSpace = buildSkillMarkdown("https://busabase.com", {
      mode: "cloud",
      stage: "bootstrap",
      editionConfirmed: true,
    });

    expect(cloudWithoutPreselectedSpace).toContain("availableSpaces");
    expect(cloudWithoutPreselectedSpace).toContain(
      "Always tell the user which Space was selected (name + id)",
    );
    expect(cloudWithoutPreselectedSpace).toContain("busabase-cli@latest space use <id>");
    expect(cloudWithoutPreselectedSpace).not.toContain(
      "if the selected Space is not the\none intended, switch with",
    );
  });

  it("asks the user to confirm the Space only when the account has more than one", () => {
    const cloudWithoutPreselectedSpace = buildSkillMarkdown("https://busabase.com", {
      mode: "cloud",
      stage: "bootstrap",
      editionConfirmed: true,
    });

    expect(cloudWithoutPreselectedSpace).toContain("### 0b. Confirm the target Space");
    expect(cloudWithoutPreselectedSpace).toContain(
      "- **One** → nothing to choose. Continue with the `bootstrapRequired` branch from 0a.",
    );
    expect(cloudWithoutPreselectedSpace).toContain(
      "- **More than one** → ask once, a lettered choice in the user's language",
    );
    // `space use <id>` is the agent's own mechanism, never an instruction handed to the user.
    expect(cloudWithoutPreselectedSpace).toContain(
      "Offer Spaces, never commands — switching is your job,\n  so never tell the user to run anything",
    );
    expect(cloudWithoutPreselectedSpace).toContain(
      "re-decide the 0a branch from the new `bootstrapRequired`",
    );
    // A dashboard-preselected Space is locked, so there is no confirmation question at all.
    expect(cloudBootstrap).not.toContain("### 0b. Confirm the target Space");
    expect(cloudBootstrap).toContain("never ask the user to pick one");
  });

  it("uses the cross-platform CLI runner for every connection-stage command", () => {
    const cloudCliLines = cloudBootstrap
      .split("\n")
      .filter((line) => line.startsWith("npx --yes busabase-cli@latest "));
    const desktopCliLines = localBootstrap
      .split("\n")
      .filter((line) => line.startsWith("npx --yes busabase-cli@latest "));

    expect(cloudCliLines).toEqual([
      "npx --yes busabase-cli@latest login --device-code --base-url https://busabase.com --space-id spc_x",
    ]);
    expect(desktopCliLines).toEqual([
      'npx --yes busabase-cli@latest login --base-url "http://localhost:15419"',
      'npx --yes busabase-cli@latest login --profile local --base-url "http://localhost:15419"   # adds an account, switches to it',
      "npx --yes busabase-cli@latest auth status                                   # see them all (* = active)",
    ]);

    for (const doc of [cloudBootstrap, localBootstrap]) {
      expect(doc).not.toContain("npm exec -y --package busabase-cli@latest -- busabase-cli");
      expect(doc).not.toContain("set -a; . ~/.busabase/.env; set +a");
      expect(doc).not.toMatch(/^npx busabase-cli (?:login|auth status)/m);
    }
  });

  it("branches on the persistent bootstrap marker instead of Space emptiness", () => {
    expect(cloudBootstrap).toContain("bootstrapRequired: true");
    expect(cloudBootstrap).toContain("bootstrapRequired: false");
    expect(cloudBootstrap).toContain("agentBootstrapVersion");
    expect(cloudBootstrap).not.toContain("`bases` is `[]`");
  });

  it("uses a dashboard-selected Space as a locked target, not as proof it is existing", () => {
    expect(cloudBootstrap).toContain(
      "The dashboard supplied `--space-id spc_x` — lock it as the target",
    );
    expect(cloudBootstrap).toContain(
      "Preselection only fixes *which* Space; it does not\ndecide whether that Space needs initializing",
    );
    expect(cloudBootstrap).toContain("including a preselected empty Space with no");
    expect(cloudBootstrap).toContain(
      "initialize this\n  Space even when the dashboard preselected it",
    );
    expect(cloudBootstrap).not.toContain("and no dashboard Space was\npreselected");
  });

  it("auto-merges idempotent system starter data and marks completion", () => {
    expect(cloudBootstrap).toContain('"submittedBy": "system-onboarding"');
    expect(cloudBootstrap).toContain(
      '"idempotencyKey": "system-onboarding:v1:content:launch-announcement"',
    );
    expect(cloudBootstrap).toContain('"autoMerge": true');
    expect(cloudBootstrap).toContain("/api/v1/onboarding/bootstrap-complete");
    expect(cloudBootstrap).not.toContain("First approval");
  });
});

describe("bootstrap edition confirmation", () => {
  it("uses one generic setup description for the dispatcher and both confirmed editions", () => {
    for (const doc of [cloudDispatcher, desktopDispatcher, cloudBootstrap, localBootstrap]) {
      expect(doc).toContain(`description: ${setupDescription}`);
    }
  });

  it("keeps an unconfirmed preference command-free and asks one A/B edition question", () => {
    for (const doc of [cloudDispatcher, desktopDispatcher]) {
      expect(doc).toContain("## Step 0 — Welcome and confirm the edition");
      expect(doc).toContain("Your first reply must follow the model below");
      expect(doc).toContain("👋 Welcome! This is **Busabase** (https://busabase.com)");
      expect(doc).toContain("A wrong move stays a harmless\n> proposal until you approve it.");
      expect(doc).toContain("Before I connect, which edition would you like to use?");
      expect(doc).toContain("**A. Busabase Cloud**");
      expect(doc).toContain("**B. Busabase Personal Desktop**");
      expect(doc).not.toContain("## Step 1 — Confirm the edition");
      expect(doc).not.toContain("```bash");
      expect(doc).not.toContain("curl ");
      expect(doc).not.toContain("login --device-code");
      expect(doc).not.toContain("npx skills add");
      expect(doc).not.toContain("/api/v1/");
    }
  });

  it("always dispatches to explicit confirmed URLs and scopes space to Cloud", () => {
    const cloudUrl = canonicalUrl(cloudDispatcher, "Cloud");
    const desktopUrl = canonicalUrl(cloudDispatcher, "Personal Desktop");

    expect(cloudUrl.searchParams.get("edition")).toBe("cloud");
    expect(cloudUrl.searchParams.get("editionConfirmed")).toBe("1");
    expect(cloudUrl.searchParams.get("space")).toBe("spc_x");
    expect(desktopUrl.searchParams.get("edition")).toBe("desktop");
    expect(desktopUrl.searchParams.get("editionConfirmed")).toBe("1");
    expect(desktopUrl.searchParams.has("space")).toBe(false);

    expect(canonicalUrl(desktopDispatcher, "Cloud").searchParams.has("space")).toBe(false);
    expect(canonicalUrl(desktopDispatcher, "Personal Desktop").searchParams.has("space")).toBe(
      false,
    );
  });

  it("starts confirmed documents at edition-specific connection without asking again", () => {
    expect(cloudBootstrap).toContain("## Step 0 — Connect to Busabase Cloud");
    expect(localBootstrap).toContain("## Step 0 — Connect to Busabase Personal Desktop");
    expect(cloudBootstrap).not.toContain("## Step 1 — Device sign-in recovery");
    expect(cloudBootstrap).toContain(
      "If the code expires or authorization fails, explain what happened; if the user still wants to\ncontinue, rerun the same login command above once.",
    );
    expect(cloudBootstrap).toContain("| 1 | 🔌 **Connect** | Step 0 | device login");
    expect(localBootstrap).toContain(
      "## Step 1 — Install & start (pick the execution mode that fits this machine)",
    );
    expect(localBootstrap).toContain("| 1 | 🔌 **Connect** | Step 0 + Step 1 | the local API");
    expect(setupStepNumbers(cloudBootstrap)).toEqual([0, 1, 2, 3]);
    expect(setupStepNumbers(localBootstrap)).toEqual([0, 1, 2, 3, 4]);
    expect(cloudBootstrap).toContain("jump to Step 3 with zero structure or record writes");
    expect(cloudBootstrap).toContain("Ask the Step 1 scenario question");
    expect(cloudBootstrap).toContain("safely resumes Step 2");
    expect(cloudBootstrap).toContain("| 2 | 🏗️ **Initialize if required** | Step 1 + Step 2 |");
    expect(localBootstrap).toContain("Jump to **Step 4 (ongoing use)**");
    expect(localBootstrap).toContain("Skip to **Step 2** to set it up");
    for (const doc of [cloudBootstrap, localBootstrap]) {
      expect(doc).not.toContain("## Step 0 — Welcome and confirm the edition");
      expect(doc).not.toContain("Before I connect, which edition would you like to use?");
      expect(doc).not.toContain("## Step 1 — Confirm the edition");
    }
  });

  it("does not offer a second Cloud switch inside the confirmed Desktop workflow", () => {
    expect(localBootstrap).not.toContain("Path C — Cloud");
  });

  it("ends Cloud congratulations with a real-space Dashboard link only", () => {
    expect(cloudBootstrap).toContain("clickable Markdown link labeled **Open Busabase Dashboard**");
    expect(cloudBootstrap).toContain(
      "> 🔗 [Open Busabase Dashboard](https://busabase.com/dashboard/spc_x/home)",
    );
    expect(cloudBootstrap).toContain(
      "Step 0 locked the Space ID used below; before replying, verify login confirmed that same Space.",
    );
    expect(cloudBootstrap).toContain(
      "Never show `$BUSABASE_SPACE_ID`, `{space_id}`, `YOUR_SPACE_ID`, or any other placeholder",
    );
    const cloudWithoutPreselectedSpace = buildSkillMarkdown("https://busabase.com", {
      mode: "cloud",
      stage: "bootstrap",
      editionConfirmed: true,
    });
    expect(cloudWithoutPreselectedSpace).toContain(
      "> 🔗 [Open Busabase Dashboard](https://busabase.com/dashboard/{space_id}/home)",
    );
    expect(cloudWithoutPreselectedSpace).toContain(
      "Replace `{space_id}` with the real Space ID that Step 0 confirmed and saved as\n`BUSABASE_SPACE_ID` before replying.",
    );
    expect(localBootstrap).not.toContain("Open Busabase Dashboard");
    expect(localBootstrap).not.toContain("/dashboard/{space_id}/home");
  });
});
