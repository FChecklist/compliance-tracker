import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * approvalPreferences – persisted per-user approval decisions.
 *
 * Placed logically right after the `dynamicChains` export in
 * src/lib/db/schema.ts (following its exact Drizzle style).
 *
 * Columns mirror the migration drizzle/0136_wave161_approval_preferences.sql.
 */
export const approvalPreferences = pgTable("approval_preferences", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  userId: text("user_id").notNull(),
  scopeType: text("scope_type").notNull(),
  scopeId: text("scope_id"),
  actionCategory: text("action_category").notNull(),
  decision: text("decision").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
