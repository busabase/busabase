import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const requireFromApp = createRequire(`${process.cwd()}/package.json`);
const requireFromCore = createRequire(
  resolve(process.cwd(), "../../packages/busabase-core/package.json"),
);

const requiredAppModules = ["busabase-core/dashboard", "kui/styles.css", "openlib/ui/dashboard"];

const requiredCoreModules = ["@orpc/tanstack-query", "open-domains/attachments/types"];

const requiredEnv = ["PG_DATABASE_URL", "STORAGE_URL"] as const;

const loadEnvFile = () => {
  const envFile = resolve(process.cwd(), ".env");
  if (!existsSync(envFile)) {
    return;
  }
  const content = readFileSync(envFile, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    process.env[key] ??= rawValue.replace(/^['"]|['"]$/g, "");
  }
};

const assertModuleResolution = () => {
  const missingApp = requiredAppModules.filter((moduleName) => {
    try {
      requireFromApp.resolve(moduleName);
      return false;
    } catch {
      return true;
    }
  });
  const missingCore = requiredCoreModules.filter((moduleName) => {
    try {
      requireFromCore.resolve(moduleName);
      return false;
    } catch {
      return true;
    }
  });
  const missing = [...missingApp, ...missingCore];

  if (missing.length > 0) {
    throw new Error(
      [
        "Missing Busabase workspace dependencies:",
        ...missing.map((moduleName) => `- ${moduleName}`),
        "",
        "Run `pnpm install` from the repository root before starting Busabase.",
      ].join("\n"),
    );
  }
};

const assertEnvironment = () => {
  const envFile = resolve(process.cwd(), ".env");
  const missingEnv = requiredEnv.filter((name) => !process.env[name]);
  if (missingEnv.length === 0) {
    return;
  }

  throw new Error(
    [
      "Missing Busabase local environment:",
      ...missingEnv.map((name) => `- ${name}`),
      "",
      existsSync(resolve(process.cwd(), ".env.example"))
        ? "Run `cp apps/busabase/.env.example apps/busabase/.env`, or pass PG_DATABASE_URL and STORAGE_URL explicitly."
        : "Create apps/busabase/.env with PG_DATABASE_URL and STORAGE_URL.",
      `Expected env file: ${envFile}`,
    ].join("\n"),
  );
};

const ensureLocalDirs = () => {
  const pgUrl = process.env.PG_DATABASE_URL ?? "";
  const storageUrl = process.env.STORAGE_URL ?? "";

  if (pgUrl.startsWith("pglite://") && !pgUrl.includes("memory://")) {
    const dbPath = pgUrl.replace(/^pglite:\/\//, "");
    if (dbPath) {
      mkdirSync(resolve(process.cwd(), dbPath), { recursive: true });
    }
  }

  if (storageUrl.startsWith("local:")) {
    const localPath = storageUrl.replace(/^local:/, "").split("?")[0];
    if (localPath) {
      mkdirSync(resolve(process.cwd(), dirname(localPath)), { recursive: true });
      mkdirSync(resolve(process.cwd(), localPath), { recursive: true });
    }
  }
};

try {
  loadEnvFile();
  assertModuleResolution();
  assertEnvironment();
  ensureLocalDirs();
  console.log("Busabase local start check passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
