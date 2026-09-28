import { describe, expect, it } from "vitest";
import { toPublicAuditMetadata, toPublicSourceMetadata } from "../src/logic/source-attribution";

describe("public source attribution", () => {
  const rawSourceMeta = {
    subject: "record",
    provenance: {
      owner: {
        id: "usr_1",
        name: "Leon",
        email: "leon@example.com",
        image: "https://example.com/leon.png",
      },
      apiKey: { id: "apk_1", name: "Codex" },
      channel: "mcp",
    },
  };

  it("extracts the safe display fields and removes raw credentials", () => {
    expect(toPublicSourceMetadata(rawSourceMeta)).toEqual({
      sourceAttribution: { displayName: "Codex", ownerName: "Leon", channel: "mcp" },
      sourceMeta: { subject: "record" },
    });
  });

  it("supports legacy flat provenance and normalizes an invalid channel to API", () => {
    expect(
      toPublicSourceMetadata({
        workflow: "sync",
        ownerName: "Leon",
        credentialName: "Importer",
        channel: "made-up-client",
      }),
    ).toEqual({
      sourceAttribution: { displayName: "Importer", ownerName: "Leon", channel: "openapi" },
      sourceMeta: { workflow: "sync" },
    });
  });

  it("preserves unrelated business metadata with generic owner and channel keys", () => {
    expect(toPublicSourceMetadata({ channel: "LinkedIn", owner: "Content" })).toEqual({
      sourceAttribution: null,
      sourceMeta: { channel: "LinkedIn", owner: "Content" },
    });
    expect(toPublicSourceMetadata({ channel: "web_ui", owner: { team: "Content" } })).toEqual({
      sourceAttribution: null,
      sourceMeta: { channel: "web_ui", owner: { team: "Content" } },
    });
  });

  it("sanitizes nested audit sourceMeta without dropping unrelated metadata", () => {
    expect(toPublicAuditMetadata({ verdict: "approved", sourceMeta: rawSourceMeta })).toEqual({
      sourceAttribution: { displayName: "Codex", ownerName: "Leon", channel: "mcp" },
      metadata: { verdict: "approved", sourceMeta: { subject: "record" } },
    });
  });

  it("sanitizes the legacy direct audit provenance shape", () => {
    expect(
      toPublicAuditMetadata({ verdict: "approved", provenance: rawSourceMeta.provenance }),
    ).toEqual({
      sourceAttribution: { displayName: "Codex", ownerName: "Leon", channel: "mcp" },
      metadata: { verdict: "approved" },
    });
  });
  describe("playbook", () => {
    const playbook = {
      kind: "prompt",
      nodeId: "nod_visits",
      key: "log-visit",
      nodeType: "base",
      nodeSlug: "visits",
      label: "Log a customer visit",
    };

    it("surfaces a stored playbook next to the existing attribution", () => {
      expect(
        toPublicSourceMetadata({
          subject: "record",
          provenance: { ...rawSourceMeta.provenance, playbook },
        }),
      ).toEqual({
        sourceAttribution: {
          displayName: "Codex",
          ownerName: "Leon",
          channel: "mcp",
          playbook: { ...playbook, accessible: true },
        },
        sourceMeta: { subject: "record" },
      });
    });

    it("does not invent an API channel for a playbook-only provenance (open-source host)", () => {
      expect(toPublicSourceMetadata({ provenance: { playbook } }).sourceAttribution).toEqual({
        displayName: null,
        ownerName: null,
        channel: null,
        playbook: { ...playbook, accessible: true },
      });
    });

    it("ignores a malformed stored playbook and keeps the old shape", () => {
      const result = toPublicSourceMetadata({
        provenance: { ...rawSourceMeta.provenance, playbook: { kind: "recipe", nodeId: "x" } },
      });
      expect(result.sourceAttribution).toEqual({
        displayName: "Codex",
        ownerName: "Leon",
        channel: "mcp",
      });
    });
  });
});
