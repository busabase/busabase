import { describe, expect, it } from "vitest";
import {
  AIRAPP_MANIFEST_PATH,
  AirAppManifestError,
  isEngineEligible,
  resolveEngine,
  resolveRunPlan,
  substitutePort,
  tokenizeCommand,
} from "./airapp-runtime-descriptor";

const manifest = (value: unknown) => ({ [AIRAPP_MANIFEST_PATH]: JSON.stringify(value) });

describe("resolveRunPlan — backward compatibility", () => {
  it("gives a manifest-less package.json app exactly the previously hardcoded commands", () => {
    const plan = resolveRunPlan({ "package.json": "{}", "server.js": "" });
    expect(plan.runtime).toBe("node");
    expect(plan.install).toBe("npm install");
    expect(plan.start).toBe("npm run dev");
    expect(plan.source).toBe("inferred");
  });

  it("defaults to node when there is no manifest and no marker file at all", () => {
    const plan = resolveRunPlan({ "index.html": "<h1>hi</h1>" });
    expect(plan.runtime).toBe("node");
    expect(plan.install).toBe("npm install");
    expect(plan.source).toBe("default");
  });

  it("always explains how the runtime was decided", () => {
    expect(resolveRunPlan({ "package.json": "{}" }).explanation).toContain("inferred");
    expect(resolveRunPlan({}).explanation).toContain("defaulting");
    expect(resolveRunPlan(manifest({ runtime: "python" })).explanation).toContain("declared");
  });
});

describe("resolveRunPlan — inference", () => {
  it("infers python from requirements.txt and picks the matching install command", () => {
    const plan = resolveRunPlan({ "requirements.txt": "fastapi\n", "main.py": "" });
    expect(plan.runtime).toBe("python");
    expect(plan.install).toContain("python3 -m venv .venv");
    expect(plan.install).toContain("pip install -r requirements.txt");
    expect(plan.start).toContain("uvicorn");
  });

  it("infers python from pyproject.toml and installs the project itself instead", () => {
    const plan = resolveRunPlan({ "pyproject.toml": "[project]\n", "main.py": "" });
    expect(plan.install).toContain("pip install -e .");
  });

  it("prefers python over node when both markers exist, and says so", () => {
    const plan = resolveRunPlan({ "package.json": "{}", "requirements.txt": "" });
    expect(plan.runtime).toBe("python");
    expect(plan.explanation).toContain("node");
  });
});

describe("resolveRunPlan — explicit manifest", () => {
  it("lets a one-line manifest select a runtime while keeping that runtime's defaults", () => {
    const plan = resolveRunPlan({ ...manifest({ runtime: "python" }), "main.py": "" });
    expect(plan.runtime).toBe("python");
    expect(plan.install).toContain("pip install -e ."); // no requirements.txt present
    expect(plan.source).toBe("manifest");
  });

  it("honours explicit install/start/port/preferredEngine", () => {
    const plan = resolveRunPlan(
      manifest({
        runtime: "python",
        install: "poetry install",
        start: "python app.py",
        port: 4321,
        preferredEngine: "local",
      }),
    );
    expect(plan.install).toBe("poetry install");
    expect(plan.start).toBe("python app.py");
    expect(plan.port).toBe(4321);
    expect(plan.preferredEngine).toBe("local");
  });

  it("rejects a malformed manifest rather than silently falling back", () => {
    expect(() => resolveRunPlan({ [AIRAPP_MANIFEST_PATH]: "{ not json" })).toThrow(
      AirAppManifestError,
    );
    expect(() => resolveRunPlan(manifest({ runtime: "ruby" }))).toThrow(/unknown runtime/);
    expect(() => resolveRunPlan(manifest({ port: 0 }))).toThrow(/port/);
    expect(() => resolveRunPlan(manifest({ start: "  " }))).toThrow(/start/);
    expect(() => resolveRunPlan(manifest({ preferredEngine: "webcontainer" }))).toThrow(
      /preferredEngine/,
    );
  });

  it("does not claim there is no manifest when there is one", () => {
    // A manifest carrying only `preferredEngine` still goes down the inference
    // path for `runtime`. Reporting that as "no airapp.json" is a log line the
    // reader can check and find false, and it sends them debugging a file that
    // was read correctly.
    const plan = resolveRunPlan(manifest({ preferredEngine: "local" }));
    expect(plan.explanation).not.toContain("no airapp.json");
    expect(plan.explanation).toContain('airapp.json declares no "runtime"');
    expect(plan.preferredEngine).toBe("local");
    // The genuine absence still reads as absence.
    expect(resolveRunPlan({ "package.json": "{}" }).explanation).toContain("no airapp.json");
  });

  it("accepts a retired engine name and resolves it to the current one", () => {
    // An `airapp.json` lives in someone else's repository. Busabase renamed
    // these values and cannot rewrite the manifests that pinned the old ones,
    // so rejecting them would fail apps over a rename they had no part in.
    expect(resolveRunPlan(manifest({ preferredEngine: "nodepod" })).preferredEngine).toBe(
      "browser",
    );
    expect(resolveRunPlan(manifest({ preferredEngine: "sandock" })).preferredEngine).toBe("remote");
    expect(resolveRunPlan(manifest({ preferredEngine: "local-node" })).preferredEngine).toBe(
      "local",
    );
  });

  it("names the removed engine specifically instead of listing valid values at it", () => {
    // `srt` was real, not a typo. Told only "must be one of browser, local,
    // remote", the author has to diff two lists and still learns nothing about
    // why theirs went away.
    expect(() => resolveRunPlan(manifest({ preferredEngine: "srt" }))).toThrow(/removed/);
    expect(() => resolveRunPlan(manifest({ preferredEngine: "srt" }))).toThrow(/remote/);
  });
});

describe("engine eligibility", () => {
  it("lets node run anywhere but confines python to real OS processes", () => {
    expect(isEngineEligible("browser", "node")).toBe(true);
    expect(isEngineEligible("local", "node")).toBe(true);
    expect(isEngineEligible("browser", "python")).toBe(false);
    expect(isEngineEligible("local", "python")).toBe(true);
    expect(isEngineEligible("remote", "python")).toBe(true);
  });

  it("never auto-selects an engine that cannot run the app", () => {
    // The failure this prevents: a Python app auto-running on the constant
    // "browser" default the instant its node is opened.
    expect(resolveEngine("python", "browser", ["browser", "local", "remote"])).toBe("local");
  });

  it("honours the wanted engine when it is eligible and available", () => {
    expect(resolveEngine("node", "browser", ["browser", "local"])).toBe("browser");
    expect(resolveEngine("python", "remote", ["browser", "local", "remote"])).toBe("remote");
  });

  it("falls back rather than failing when the wanted engine is unavailable here", () => {
    expect(resolveEngine("node", "remote", ["browser"])).toBe("browser");
  });

  it("returns null when this deployment cannot run the app at all", () => {
    expect(resolveEngine("python", "browser", ["browser"])).toBeNull();
  });
});

describe("virtualenv isolation", () => {
  it("builds a per-run virtualenv rather than installing system-wide", () => {
    // A system-wide `pip install` is refused outright on any PEP 668 host
    // (Debian, Ubuntu, Fedora, Homebrew Python) with an
    // `externally-managed-environment` error the AirApp author cannot act on.
    const plan = resolveRunPlan({ "requirements.txt": "fastapi\n" });
    expect(plan.install).toContain("python3 -m venv .venv");
    expect(plan.pathPrepend).toEqual([".venv/bin"]);
  });

  it("tokenizes the two-step install into a single shell invocation", () => {
    const plan = resolveRunPlan({ "requirements.txt": "" });
    const argv = tokenizeCommand(plan.install);
    expect(argv[0]).toBe("sh");
    expect(argv[1]).toBe("-c");
    // `&&` stays inside one argument — the tokenizer must not interpret it.
    expect(argv[2]).toContain("&&");
    expect(argv).toHaveLength(3);
  });

  it("adds nothing to PATH for node, which npm already handles", () => {
    expect(resolveRunPlan({ "package.json": "{}" }).pathPrepend).toEqual([]);
  });
});

describe("tokenizeCommand", () => {
  it("still splits the plain commands that used to be hardcoded", () => {
    expect(tokenizeCommand("npm install")).toEqual(["npm", "install"]);
    expect(tokenizeCommand("npm run dev")).toEqual(["npm", "run", "dev"]);
  });

  it("keeps a quoted argument as one argument", () => {
    // `command.split(" ")` turned this into five broken tokens.
    expect(tokenizeCommand('python -c "import app; app.run()"')).toEqual([
      "python",
      "-c",
      "import app; app.run()",
    ]);
  });

  it("handles single quotes, escapes, empty quoted args and repeated whitespace", () => {
    expect(tokenizeCommand("sh -c 'echo hi'")).toEqual(["sh", "-c", "echo hi"]);
    expect(tokenizeCommand('echo "a\\"b"')).toEqual(["echo", 'a"b']);
    expect(tokenizeCommand('prog "" x')).toEqual(["prog", "", "x"]);
    expect(tokenizeCommand("  npm   install  ")).toEqual(["npm", "install"]);
    expect(tokenizeCommand("")).toEqual([]);
  });
});

describe("substitutePort", () => {
  it("substitutes the placeholder wherever the author put it", () => {
    expect(substitutePort("uvicorn main:app --port $PORT", 5051)).toBe(
      "uvicorn main:app --port 5051",
    );
    expect(substitutePort("serve --bind 0.0.0.0:$PORT", 8080)).toBe("serve --bind 0.0.0.0:8080");
  });

  it("leaves a command without the placeholder untouched", () => {
    expect(substitutePort("npm run dev", 3000)).toBe("npm run dev");
  });
});

describe("ready patterns", () => {
  const portFrom = (runtimeFiles: Record<string, string>, line: string): number | null => {
    for (const pattern of resolveRunPlan(runtimeFiles).readyPatterns) {
      const match = pattern.exec(line);
      if (match) return Number(match[1]);
    }
    return null;
  };

  it("matches the node dev-server line the previous implementation matched", () => {
    expect(portFrom({ "package.json": "{}" }, "listening on port 3000")).toBe(3000);
  });

  it("matches uvicorn and flask startup lines for python apps", () => {
    const files = { "requirements.txt": "" };
    expect(portFrom(files, "Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C)")).toBe(8000);
    expect(portFrom(files, " * Running on http://127.0.0.1:5000")).toBe(5000);
  });
});
