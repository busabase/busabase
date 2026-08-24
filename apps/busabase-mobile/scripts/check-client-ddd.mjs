import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const domainsRoot = path.join(root, "src/domains");
const allowedDomainDirectories = new Set(["components", "hooks", "types", "utils", "data"]);
const sourcePattern = /\.(ts|tsx)$/;

const sourceFilesUnder = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesUnder(entryPath);
    return sourcePattern.test(entry.name) ? [entryPath] : [];
  });

const domainEntries = fs
  .readdirSync(domainsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory());
const violations = [];

if (domainEntries.length === 0) violations.push("no client domain boundaries found");

for (const domain of domainEntries) {
  const domainRoot = path.join(domainsRoot, domain.name);
  for (const barrel of ["index.ts", "index.tsx"]) {
    const barrelPath = path.join(domainRoot, barrel);
    if (fs.existsSync(barrelPath)) violations.push(`domain-root barrel: ${barrelPath}`);
  }

  for (const entry of fs.readdirSync(domainRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !allowedDomainDirectories.has(entry.name)) {
      violations.push(`unsupported domain directory: ${path.join(domainRoot, entry.name)}`);
    }
  }
}

const sourceFiles = [path.join(root, "app"), path.join(root, "src")].flatMap(sourceFilesUnder);
for (const file of sourceFiles) {
  const lineCount = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lineCount > 500) violations.push(`source over 500 lines: ${file} (${lineCount})`);
}

const productionDomainFiles = domainEntries
  .flatMap((entry) => sourceFilesUnder(path.join(domainsRoot, entry.name)))
  .filter((file) => !/\.test\.[^.]+$/.test(file));

for (const file of productionDomainFiles) {
  const source = fs.readFileSync(file, "utf8");
  if (/(\bfetch\s*\(|axios)/.test(source)) {
    violations.push(`direct domain network call: ${file}`);
  }
  if (/from ["']~\/(db|server)|drizzle-orm/.test(source)) {
    violations.push(`server dependency in client domain: ${file}`);
  }
}

const domainUtils = domainEntries.flatMap((entry) => {
  const directory = path.join(domainsRoot, entry.name, "utils");
  return fs.existsSync(directory) ? sourceFilesUnder(directory) : [];
});
for (const file of domainUtils) {
  const source = fs.readFileSync(file, "utf8");
  if (/from ["'](react|react-native|expo-|@react-native)/.test(source)) {
    violations.push(`platform or React dependency in pure domain util: ${file}`);
  }
}

if (violations.length > 0) {
  console.error(
    `Busabase Mobile Client DDD violations:\n${violations.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(`Busabase Mobile Client DDD check passed (${sourceFiles.length} source files).`);
