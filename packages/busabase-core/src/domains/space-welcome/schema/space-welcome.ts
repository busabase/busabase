import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { spaceIdColumn } from "../../../db/space-column";

/**
 * One welcome page per space: a pointer to an ordinary Doc/HTML node a manager
 * chose. Deliberately no foreign key — a node that is later trashed, archived
 * or purged simply stops rendering (Home reads it through `nodes.get`), the
 * same as a node the viewer is not allowed to read.
 */
export const busabaseSpaceWelcome = pgTable("busabase_space_welcome", {
  spaceId: spaceIdColumn().primaryKey(),
  nodeId: text("node_id"),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
