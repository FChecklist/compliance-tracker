import {
  pgTable, uuid, text, boolean, jsonb, timestamp, integer, numeric,
  index, uniqueIndex,
} from "drizzle-orm/pg-core";

// ============ ORGANISATIONS ============
export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  plan_type: text("plan_type").notNull().default("single_entity"),
  owner_id: uuid("owner_id").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  settings: jsonb("settings").default({}).$type<Record<string, unknown>>(),
  onboarding_step: integer("onboarding_step").notNull().default(0),
  onboarding_completed: boolean("onboarding_completed").notNull().default(false),
  onboarding_skipped_ai: boolean("onboarding_skipped_ai").notNull().default(false),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  financial_year_start: text("financial_year_start").notNull().default("April"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("organisations_slug_idx").on(table.slug),
  index("organisations_owner_idx").on(table.owner_id),
]);

// ============ USERS ============
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  phone: text("phone"),
  full_name: text("full_name").notNull(),
  avatar_url: text("avatar_url"),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("viewer"),
  is_active: boolean("is_active").notNull().default(true),
  passcode_hash: text("passcode_hash"),
  last_login_at: timestamp("last_login_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
  index("users_org_idx").on(table.org_id),
  index("users_role_idx").on(table.role),
]);

// ============ DEPARTMENTS ============
export const departments = pgTable("departments", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  head_user_id: uuid("head_user_id").references(() => users.id),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("departments_org_idx").on(table.org_id),
]);

// ============ COMPLIANCE ============
export const compliance = pgTable("compliance", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  department_id: uuid("department_id").references(() => departments.id),
  title: text("title").notNull(),
  description: text("description").default(""),
  compliance_type: text("compliance_type").notNull().default("other"),
  status: text("status").notNull().default("draft"),
  priority: text("priority").notNull().default("medium"),
  assignee_id: uuid("assignee_id").references(() => users.id),
  due_date: timestamp("due_date", { withTimezone: true }),
  unique_url_slug: text("unique_url_slug").notNull().unique(),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("compliance_slug_idx").on(table.unique_url_slug),
  index("compliance_org_idx").on(table.org_id),
  index("compliance_status_idx").on(table.status),
  index("compliance_priority_idx").on(table.priority),
  index("compliance_due_date_idx").on(table.due_date),
  index("compliance_assignee_idx").on(table.assignee_id),
  index("compliance_dept_idx").on(table.department_id),
  index("compliance_type_idx").on(table.compliance_type),
]);

// ============ COMPLIANCE HISTORY ============
export const complianceHistory = pgTable("compliance_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  compliance_id: uuid("compliance_id").notNull().references(() => compliance.id, { onDelete: "cascade" }),
  old_status: text("old_status"),
  new_status: text("new_status").notNull(),
  changed_by: uuid("changed_by").notNull().references(() => users.id),
  change_reason: text("change_reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("compliance_history_compliance_idx").on(table.compliance_id),
  index("compliance_history_changed_by_idx").on(table.changed_by),
]);

// ============ AUDIT POINTS ============
export const auditPoints = pgTable("audit_points", {
  id: uuid("id").defaultRandom().primaryKey(),
  compliance_id: uuid("compliance_id").notNull().references(() => compliance.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  assignee_id: uuid("assignee_id").references(() => users.id),
  due_date: timestamp("due_date", { withTimezone: true }),
  evidence_required: boolean("evidence_required").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_points_compliance_idx").on(table.compliance_id),
  index("audit_points_assignee_idx").on(table.assignee_id),
]);

// ============ COMMENTS ============
// Self-referencing FK: parent_comment_id -> comments.id
// We define the base table first, then add the self-ref via separate export
const commentsTable = pgTable("comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  compliance_id: uuid("compliance_id").notNull().references(() => compliance.id, { onDelete: "cascade" }),
  parent_comment_id: uuid("parent_comment_id"), // self-ref added below
  author_id: uuid("author_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("comments_compliance_idx").on(table.compliance_id),
  index("comments_parent_idx").on(table.parent_comment_id),
  index("comments_author_idx").on(table.author_id),
]);
export { commentsTable as comments };

// ============ AUDIT LOG ============
export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id),
  user_id: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id: text("entity_id").notNull(),
  ip_address: text("ip_address"),
  machine_id: text("machine_id"),
  metadata: jsonb("metadata").default({}).$type<Record<string, unknown>>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_log_org_idx").on(table.org_id),
  index("audit_log_user_idx").on(table.user_id),
  index("audit_log_entity_idx").on(table.entity_type, table.entity_id),
  index("audit_log_created_idx").on(table.created_at),
]);

// ============ DOCUMENTS ============
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  compliance_id: uuid("compliance_id").references(() => compliance.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storage_path: text("storage_path").notNull(),
  mime_type: text("mime_type").notNull(),
  size_bytes: integer("size_bytes").notNull(),
  uploaded_by: uuid("uploaded_by").references(() => users.id),
  version: integer("version").notNull().default(1),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("documents_org_idx").on(table.org_id),
  index("documents_compliance_idx").on(table.compliance_id),
]);

// ============ NOTIFICATIONS ============
export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  is_read: boolean("is_read").notNull().default(false),
  link_url: text("link_url"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("notifications_user_idx").on(table.user_id),
  index("notifications_read_idx").on(table.user_id, table.is_read),
  index("notifications_org_idx").on(table.org_id),
]);

// ============ PERMISSION SCOPES ============
export const permissionScopes = pgTable("permission_scopes", {
  id: uuid("id").defaultRandom().primaryKey(),
  role: text("role").notNull(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("permission_scopes_unique_idx").on(table.role, table.resource, table.action),
]);

// ============ API TOKENS ============
export const apiTokens = pgTable("api_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  token_hash: text("token_hash").notNull(),
  permissions: text("permissions").array().default([]),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  expires_at: timestamp("expires_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("api_tokens_org_idx").on(table.org_id),
]);

// ============ WEBHOOKS ============
export const webhooks = pgTable("webhooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  events: text("events").array().notNull(),
  secret_hash: text("secret_hash").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("webhooks_org_idx").on(table.org_id),
]);

// ============ SALES AGENTS ============
export const salesAgents = pgTable("sales_agents", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  commission_rate: numeric("commission_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  is_active: boolean("is_active").notNull().default(true),
  unique_referral_code: text("unique_referral_code").notNull().unique(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sales_agents_referral_idx").on(table.unique_referral_code),
  index("sales_agents_org_idx").on(table.org_id),
]);

// ============ DISCOUNT CODES ============
export const discountCodes = pgTable("discount_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  code: text("code").notNull().unique(),
  discount_percent: integer("discount_percent").notNull(),
  valid_from: timestamp("valid_from", { withTimezone: true }).notNull(),
  valid_until: timestamp("valid_until", { withTimezone: true }).notNull(),
  max_uses: integer("max_uses"),
  uses_count: integer("uses_count").notNull().default(0),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("discount_codes_code_idx").on(table.code),
]);

// ============ COMMISSIONS ============
export const commissions = pgTable("commissions", {
  id: uuid("id").defaultRandom().primaryKey(),
  agent_id: uuid("agent_id").notNull().references(() => salesAgents.id, { onDelete: "cascade" }),
  order_id: text("order_id").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("commissions_agent_idx").on(table.agent_id),
]);

// ============ INCENTIVES ============
export const incentives = pgTable("incentives", {
  id: uuid("id").defaultRandom().primaryKey(),
  agent_id: uuid("agent_id").notNull().references(() => salesAgents.id, { onDelete: "cascade" }),
  milestone_description: text("milestone_description").notNull(),
  target_count: integer("target_count").notNull(),
  reward_amount: numeric("reward_amount", { precision: 10, scale: 2 }).notNull(),
  achieved: boolean("achieved").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("incentives_agent_idx").on(table.agent_id),
]);

// ============ SALES CHANNELS ============
export const salesChannels = pgTable("sales_channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  channel_type: text("channel_type").notNull(),
  name: text("name").notNull(),
  is_active: boolean("is_active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ============ ACCESS REQUESTS ============
export const accessRequests = pgTable("access_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  requester_id: uuid("requester_id").notNull().references(() => users.id),
  compliance_id: uuid("compliance_id").references(() => compliance.id, { onDelete: "cascade" }),
  requested_access_level: text("requested_access_level").notNull(),
  status: text("status").notNull().default("pending"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("access_requests_org_idx").on(table.org_id),
  index("access_requests_requester_idx").on(table.requester_id),
]);

// ============ EMAIL LOGS ============
export const emailLogs = pgTable("email_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  org_id: uuid("org_id").notNull().references(() => organisations.id),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(),
  provider: text("provider").notNull().default("resend"),
  provider_id: text("provider_id"),
  sent_at: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  index("email_logs_org_idx").on(table.org_id),
]);

// ============ TYPE EXPORTS ============
export type Organisation = typeof organisations.$inferSelect;
export type NewOrganisation = typeof organisations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Department = typeof departments.$inferSelect;
export type Compliance = typeof compliance.$inferSelect;
export type NewCompliance = typeof compliance.$inferInsert;
export type ComplianceHistory = typeof complianceHistory.$inferSelect;
export type AuditPoint = typeof auditPoints.$inferSelect;
export type Comment = typeof commentsTable.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type ApiToken = typeof apiTokens.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type SalesAgent = typeof salesAgents.$inferSelect;
export type DiscountCode = typeof discountCodes.$inferSelect;
export type Commission = typeof commissions.$inferSelect;
export type Incentive = typeof incentives.$inferSelect;
export type SalesChannel = typeof salesChannels.$inferSelect;
export type AccessRequest = typeof accessRequests.$inferSelect;
export type EmailLog = typeof emailLogs.$inferSelect;