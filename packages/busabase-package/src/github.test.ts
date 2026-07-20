import { BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import {
  downloadGithubZip,
  extractZip,
  GITHUB_ALLOWED_HOSTS,
  normalizeArchivePath,
  parseGithubUrl,
} from "./github";

/** Build a GitHub-shaped zipball: every entry under one generated root directory. */
const buildZip = async (
  entries: Record<string, string>,
  root = "acme-repo-abc123",
): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(`${root}/${path}`, new TextReader(content));
  }
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
};

/** A zipball with a raw, un-prefixed entry name — the zip-slip attack shape. */
const buildRawZip = async (entries: Record<string, string>): Promise<Buffer> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, content] of Object.entries(entries)) {
    await writer.add(path, new TextReader(content));
  }
  const blob = await writer.close();
  return Buffer.from(await blob.arrayBuffer());
};

describe("parseGithubUrl", () => {
  it("parses a bare repo URL", () => {
    expect(parseGithubUrl("https://github.com/acme/support-kb-template")).toEqual({
      owner: "acme",
      repo: "support-kb-template",
      ref: undefined,
      subdir: undefined,
    });
  });

  it("parses /tree/<ref>", () => {
    expect(parseGithubUrl("https://github.com/acme/packages/tree/v1.2.0")).toEqual({
      owner: "acme",
      repo: "packages",
      ref: "v1.2.0",
      subdir: undefined,
    });
  });

  it("parses /tree/<ref>/<subdir>", () => {
    expect(
      parseGithubUrl("https://github.com/acme/packages/tree/v1.2.0/skills/pdf-summarizer"),
    ).toEqual({
      owner: "acme",
      repo: "packages",
      ref: "v1.2.0",
      subdir: "skills/pdf-summarizer",
    });
  });

  it("strips a .git suffix and a trailing slash", () => {
    expect(parseGithubUrl("https://github.com/acme/repo.git/")).toMatchObject({
      owner: "acme",
      repo: "repo",
    });
  });

  it("rejects a non-GitHub host", () => {
    expect(() => parseGithubUrl("https://gitlab.com/acme/repo")).toThrow(/not a github url/i);
  });

  it("rejects a host that merely CONTAINS github.com — the substring-match trap", () => {
    // buda's importer regex matches `github.com/...` anywhere in the string, so this
    // URL passes there and fetches from an attacker-controlled host.
    expect(() => parseGithubUrl("https://evil.example/github.com/acme/repo")).toThrow(
      /not a github url/i,
    );
  });

  it("rejects a URL with no repo", () => {
    expect(() => parseGithubUrl("https://github.com/acme")).toThrow(/missing owner\/repo/i);
  });

  it("rejects a non-URL", () => {
    expect(() => parseGithubUrl("not a url")).toThrow(/not a valid url/i);
  });
});

describe("normalizeArchivePath", () => {
  it("normalizes separators and strips leading slashes", () => {
    expect(normalizeArchivePath("a\\b/c")).toBe("a/b/c");
    expect(normalizeArchivePath("/a/b/")).toBe("a/b");
  });

  it("rejects .. traversal", () => {
    expect(() => normalizeArchivePath("../../evil")).toThrow(/unsafe archive path/i);
    expect(() => normalizeArchivePath("a/../../evil")).toThrow(/unsafe archive path/i);
  });

  it("rejects a Windows drive prefix", () => {
    expect(() => normalizeArchivePath("C:\\evil")).toThrow(/unsafe archive path/i);
  });
});

describe("extractZip", () => {
  it("strips the generated archive root", async () => {
    const zip = await buildZip({ "busabase.json": "{}", "content/faq.md": "hi" });
    const files = await extractZip(zip);
    expect([...files.keys()].sort()).toEqual(["busabase.json", "content/faq.md"]);
    expect(files.get("content/faq.md")?.toString("utf8")).toBe("hi");
  });

  it("extracts only the addressed subdir and strips it", async () => {
    const zip = await buildZip({
      "README.md": "root",
      "skills/pdf/busabase.json": "{}",
      "skills/pdf/content/a.md": "a",
      "skills/other/busabase.json": "{}",
    });
    const files = await extractZip(zip, { subdir: "skills/pdf" });
    expect([...files.keys()].sort()).toEqual(["busabase.json", "content/a.md"]);
  });

  it("rejects a zip-slip entry named ../../evil", async () => {
    const zip = await buildRawZip({ "acme-repo-abc/ok.md": "ok", "../../evil": "pwned" });
    await expect(extractZip(zip)).rejects.toThrow(/unsafe archive path/i);
  });

  it("rejects a zip-slip entry even when it sits outside the addressed subdir", async () => {
    const zip = await buildRawZip({
      "acme-repo-abc/skills/pdf/busabase.json": "{}",
      "acme-repo-abc/../../evil": "pwned",
    });
    await expect(extractZip(zip, { subdir: "skills/pdf" })).rejects.toThrow(/unsafe archive path/i);
  });

  it("refuses an archive with too many files before reading any bytes", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < 12; i++) entries[`content/f${i}.md`] = "x";
    const zip = await buildZip(entries);
    await expect(extractZip(zip, { maxFiles: 5 })).rejects.toThrow(/above the 5-file limit/i);
  });

  it("refuses an oversized file", async () => {
    const zip = await buildZip({ "content/big.md": "x".repeat(4096) });
    await expect(extractZip(zip, { maxFileBytes: 128 })).rejects.toThrow(/per-file limit/i);
  });

  it("refuses an archive over the total size limit", async () => {
    const zip = await buildZip({
      "content/a.md": "x".repeat(400),
      "content/b.md": "y".repeat(400),
    });
    await expect(extractZip(zip, { maxTotalBytes: 500 })).rejects.toThrow(/total limit/i);
  });
});

describe("downloadGithubZip", () => {
  const okResponse = () => new Response(new Uint8Array([1, 2, 3]), { status: 200 });

  it("fetches a tag from codeload by ref — not a branch-only /refs/heads/ URL", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return okResponse();
    };
    await downloadGithubZip(
      { owner: "acme", repo: "pkg", ref: "v1.2.0" },
      { fetcher: fetcher as typeof fetch },
    );
    expect(urls).toEqual(["https://codeload.github.com/acme/pkg/zip/v1.2.0"]);
  });

  it("uses HEAD for the default branch", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return okResponse();
    };
    await downloadGithubZip(
      { owner: "acme", repo: "pkg", ref: undefined },
      { fetcher: fetcher as typeof fetch },
    );
    expect(urls).toEqual(["https://codeload.github.com/acme/pkg/zip/HEAD"]);
  });

  it("names GITHUB_TOKEN when a repo 404s and no token is set", async () => {
    const fetcher = async () => new Response("", { status: 404 });
    await expect(
      downloadGithubZip(
        { owner: "acme", repo: "secret", ref: undefined },
        { fetcher: fetcher as typeof fetch },
      ),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("falls back to the authenticated API when a token is set", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      return url.startsWith("https://codeload") ? new Response("", { status: 404 }) : okResponse();
    };
    await downloadGithubZip(
      { owner: "acme", repo: "secret", ref: "main" },
      { fetcher: fetcher as typeof fetch, githubToken: "ghp_x" },
    );
    expect(urls).toEqual([
      "https://codeload.github.com/acme/secret/zip/main",
      "https://api.github.com/repos/acme/secret/zipball/main",
    ]);
  });

  it("reports a rejected token distinctly from a missing repo", async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).startsWith("https://codeload")
        ? new Response("", { status: 404 })
        : new Response("", { status: 401 });
    await expect(
      downloadGithubZip(
        { owner: "acme", repo: "secret", ref: undefined },
        { fetcher: fetcher as typeof fetch, githubToken: "bad" },
      ),
    ).rejects.toThrow(/rejected GITHUB_TOKEN/i);
  });

  it("only ever connects to allowlisted GitHub hosts", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return String(input).startsWith("https://codeload")
        ? new Response("", { status: 404 })
        : okResponse();
    };
    await downloadGithubZip(
      { owner: "acme", repo: "pkg", ref: "main" },
      { fetcher: fetcher as typeof fetch, githubToken: "ghp_x" },
    );
    for (const url of urls) {
      expect(GITHUB_ALLOWED_HOSTS).toContain(new URL(url).hostname);
    }
  });
});
