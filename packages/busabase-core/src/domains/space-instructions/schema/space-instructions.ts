import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

/** Shared workspace configuration, fetched separately from the node/sidebar payload. */
export const busabaseSpaceInstructions = pgTable("busabase_space_instructions", {
  spaceId: spaceIdColumn().primaryKey(),
  body: text("body").notNull().default(""),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
