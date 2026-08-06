import { describe, expect, it } from "vitest";
import { GET } from "../src/app/SETUP_SKILL.md/route";

describe("local SETUP_SKILL route", () => {
  it("starts the confirmed Personal Desktop workflow without asking for an edition", async () => {
    const response = await GET(new Request("http://localhost:15419/SETUP_SKILL.md"));
    const doc = await response.text();

    expect(response.status).toBe(200);
    expect(doc).toContain("## Step 0 — Connect to Busabase Personal Desktop");
    expect(doc).toContain(
      "## Step 1 — Install & start (pick the execution mode that fits this machine)",
    );
    expect(doc).toContain("| 1 | 🔌 **Connect** | Step 0 + Step 1 | the local API");
    expect(Array.from(doc.matchAll(/^## Step (\d+) —/gm), (match) => Number(match[1]))).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(doc).toContain("Skip to **Step 2** to set it up");
    expect(doc).toContain("Jump to **Step 4 (ongoing use)**");
    expect(doc).toContain("| 2 | 🏗️ **Initialize if required** | Step 2 + Step 3 |");
    expect(doc).not.toContain("## Step 1 — Device sign-in recovery");
    expect(doc).toContain("curl -fsS http://localhost:15419/api/v1/bases");
    expect(
      doc.split("\n").filter((line) => line.startsWith("npx --yes busabase-cli@latest ")),
    ).toEqual([
      'npx --yes busabase-cli@latest login --base-url "http://localhost:15419"',
      'npx --yes busabase-cli@latest login --profile local --base-url "http://localhost:15419"   # adds an account, switches to it',
      "npx --yes busabase-cli@latest auth status                                   # see them all (* = active)",
    ]);
    expect(doc).not.toContain("npm exec -y --package busabase-cli@latest -- busabase-cli");
    expect(doc).not.toContain("set -a; . ~/.busabase/.env; set +a");
    expect(doc).not.toMatch(/^npx busabase-cli (?:login|auth status)/m);
    expect(doc).not.toContain("--use-default-space");
    expect(doc).not.toContain("Open Busabase Dashboard");
    expect(doc).not.toContain("/dashboard/{space_id}/home");
    expect(doc).not.toContain("## Step 0 — Welcome and confirm the edition");
  });
});
