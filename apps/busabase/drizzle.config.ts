import { defineConfig } from "drizzle-kit";
import { parseDrizzleDbConfig } from "openlib/db";

const { dbCredentials, ...driverConfig } = parseDrizzleDbConfig(
  process.env.PG_DATABASE_URL ?? "pglite://.data/busabase",
);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  ...driverConfig,
  dbCredentials,
});
