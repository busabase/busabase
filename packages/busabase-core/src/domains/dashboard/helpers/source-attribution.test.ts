import { describe, expect, it } from "vitest";
import { resolveSubmissionIdentity } from "./source-attribution";

describe("resolveSubmissionIdentity", () => {
  it("formats an API-key submission for Inbox, Activity, and detail", () => {
    expect(
      resolveSubmissionIdentity({ id: "usr_1", name: "Leon", email: null, image: null }, "usr_1", {
        displayName: "Codex",
        ownerName: "Leon",
        channel: "mcp",
      }),
    ).toMatchObject({
      ownerLabel: "Leon",
      credentialLabel: "Codex",
      inboxLabel: "Leon via Codex",
      activityByline: "via Codex · MCP",
      identityUnavailable: false,
    });
  });

  it("uses the channel as source when no credential name exists", () => {
    expect(
      resolveSubmissionIdentity({ id: "usr_1", name: "Leon", email: null, image: null }, "usr_1", {
        displayName: null,
        ownerName: "Leon",
        channel: "web_ui",
      }),
    ).toMatchObject({
      credentialLabel: null,
      inboxLabel: "Leon via Web UI",
      activityByline: "via Web UI",
    });
  });

  it("shows a legacy label without calling it an unknown user", () => {
    expect(resolveSubmissionIdentity(null, "Codex", null)).toMatchObject({
      ownerLabel: "Codex",
      inboxLabel: "Codex",
      identityUnavailable: true,
    });
  });

  it("treats a playbook-only attribution (no channel, no names) like no attribution", () => {
    const playbookOnly = {
      displayName: null,
      ownerName: null,
      channel: null,
      playbook: {
        kind: "skill" as const,
        accessible: true,
        nodeId: "nod_1",
        key: null,
        nodeType: "skill",
        nodeSlug: "triage",
        label: "Triage",
      },
    };
    const user = { id: "usr_1", name: "Leon", email: null, image: null };
    expect(resolveSubmissionIdentity(user, "usr_1", playbookOnly)).toEqual(
      resolveSubmissionIdentity(user, "usr_1", null),
    );
    expect(resolveSubmissionIdentity(null, "Codex", playbookOnly)).toEqual(
      resolveSubmissionIdentity(null, "Codex", null),
    );
  });
});
