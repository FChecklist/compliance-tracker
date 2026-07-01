import { pgSchema, pgEnum, text, boolean, integer, timestamp, numeric, jsonb } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { relations } from 'drizzle-orm'

export const complianceSchemaDB = pgSchema('compliance')

// ─── Enums ───────────────────────────────────────────────────────────────
export const userRoleEnum = complianceSchemaDB.enum('user_role', [
  'admin', 'manager', 'member', 'viewer', // original 4
  'veridian_admin', 'branch_manager', 'senior_professional', 'team_member', 'client_viewer', 'external_auditor', // Wave 1 additions
])
export const complianceStatusEnum = complianceSchemaDB.enum('compliance_status', ['pending', 'in_progress', 'completed', 'overdue', 'not_applicable', 'draft'])
export const priorityEnum = complianceSchemaDB.enum('priority', ['low', 'medium', 'high', 'critical'])
export const complianceTypeEnum = complianceSchemaDB.enum('compliance_type', ['GST', 'TDS', 'MCA', 'PF', 'ESIC', 'INCOME_TAX', 'ROC', 'LABOUR', 'ENVIRONMENTAL', 'OTHER'])
export const notificationTypeEnum = complianceSchemaDB.enum('notification_type', ['deadline_reminder', 'assignment', 'status_change', 'comment', 'system', 'mention'])
export const auditActionEnum = complianceSchemaDB.enum('audit_action', ['create', 'update', 'delete', 'status_change', 'assign', 'reassign', 'login', 'logout', 'export', 'invite'])
export const recurrenceTypeEnum = complianceSchemaDB.enum('recurrence_type', ['none', 'monthly', 'quarterly', 'half_yearly', 'annually'])
export const noticeStatusEnum = complianceSchemaDB.enum('notice_status', ['received', 'in_progress', 'replied', 'closed', 'appealed'])
export const aiProviderEnum = complianceSchemaDB.enum('ai_provider', ['groq', 'openai', 'anthropic', 'google'])
export const webhookEventEnum = complianceSchemaDB.enum('webhook_event', ['item.created', 'item.completed', 'item.overdue', 'notice.received', 'challan.recorded', 'item.status_changed'])

// ─── Organisations (M-17: trial fields added) ───────────────────────────
export const organisations = complianceSchemaDB.table('organisations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  plan: text('plan').notNull().default('free'),
  entityType: text('entity_type'), // M-08: Pvt Ltd, LLP, OPC, etc.
  isActive: boolean('is_active').notNull().default(true),
  trialStartsAt: timestamp('trial_starts_at'), // M-17
  trialEndsAt: timestamp('trial_ends_at'),     // M-17
  isReadOnly: boolean('is_read_only').notNull().default(false), // M-17: after trial
  subscriptionPlanId: text('subscription_plan_id'), // Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Branches / Clients / Client Entities (Wave 1: Customer Account hierarchy) ──
// organisations IS the Customer Account (kept as-is -- every existing route
// already references it). These are the new layers underneath it.
export const branches = complianceSchemaDB.table('branches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const clients = complianceSchemaDB.table('clients', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  branchId: text('branch_id'),
  name: text('name').notNull(),
  isSelf: boolean('is_self').notNull().default(false), // the implicit "Self / Direct" client backfilled for existing orgs
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const clientEntities = complianceSchemaDB.table('client_entities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull(),
  legalName: text('legal_name').notNull(),
  entityType: text('entity_type'),
  gstin: text('gstin'),
  pan: text('pan'),
  cin: text('cin'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const userClientAccess = complianceSchemaDB.table('user_client_access', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  clientId: text('client_id').notNull(),
  accessLevel: text('access_level').notNull().default('full'), // 'full' | 'aggregate_only'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const subscriptionPlans = complianceSchemaDB.table('subscription_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull().unique(),
  userPackSize: integer('user_pack_size').notNull(),
  assistantsPerUser: integer('assistants_per_user').notNull().default(5),
  priceMonthly: numeric('price_monthly', { precision: 10, scale: 2 }),
  features: jsonb('features').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Departments ─────────────────────────────────────────────────────────
export const departments = complianceSchemaDB.table('departments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  orgId: text('org_id').notNull(),
  headId: text('head_id').unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Users ───────────────────────────────────────────────────────────────
export const users = complianceSchemaDB.table('users', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: userRoleEnum('role').notNull().default('member'),
  avatarUrl: text('avatar_url'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  orgId: text('org_id'),
  departmentId: text('department_id'),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false), // M-20
  authUserId: text('auth_user_id'), // links to auth.users.id (Supabase Auth) -- Wave 1
  reportingToId: text('reporting_to_id'), // direct manager, self-FK -- Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Compliance Items (M-07/09/10/11/14/G-21 fields added) ──────────────
export const complianceItems = complianceSchemaDB.table('compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  complianceType: complianceTypeEnum('compliance_type').notNull(),
  status: complianceStatusEnum('status').notNull().default('pending'),
  priority: priorityEnum('priority').notNull().default('medium'),
  dueDate: timestamp('due_date').notNull(),
  completedAt: timestamp('completed_at'),
  filedDate: timestamp('filed_date'),         // G-21
  paidDate: timestamp('paid_date'),           // G-21
  departmentId: text('department_id').notNull(),
  assignedToId: text('assigned_to_id'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // Wave 1 -- nullable during rollout, backfilled for existing rows
  // M-09: Period / Financial Year
  period: text('period'),                     // e.g. "June 2026", "Q1 FY2026-27"
  financialYear: text('financial_year'),      // e.g. "2026-27"
  // M-10: Acknowledgement / Reference Number
  acknowledgementNumber: text('acknowledgement_number'), // ARN, SRN, ITR ack
  // M-14: Registration Numbers
  registrationNumber: text('registration_number'), // GSTIN / TAN / PAN / CIN / PF Code
  // M-07: Recurrence
  recurrenceType: recurrenceTypeEnum('recurrence_type').notNull().default('none'),
  recurrenceParentId: text('recurrence_parent_id'),
  // M-08: Template-based
  isTemplateSuggested: boolean('is_template_suggested').notNull().default(false),
  // Amount for penalty calculation
  amount: numeric('amount', { precision: 14, scale: 2 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Challan Payments (M-11) ────────────────────────────────────────────
export const challans = complianceSchemaDB.table('challans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  complianceItemId: text('compliance_item_id').notNull(),
  bsrCode: text('bsr_code'),
  challanSerialNumber: text('challan_serial_number'),
  paymentDate: timestamp('payment_date'),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  bankName: text('bank_name'),
  description: text('description'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // Wave 1
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Government Notices / SCN (M-12) ────────────────────────────────────
export const notices = complianceSchemaDB.table('notices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  noticeNumber: text('notice_number'),
  authority: text('authority'),
  dateReceived: timestamp('date_received').notNull(),
  demandAmount: numeric('demand_amount', { precision: 14, scale: 2 }),
  replyDeadline: timestamp('reply_deadline'),
  status: noticeStatusEnum('status').notNull().default('received'),
  description: text('description'),
  complianceItemId: text('compliance_item_id'), // link to related compliance item
  departmentId: text('department_id').notNull(),
  assignedToId: text('assigned_to_id'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Audit Points ────────────────────────────────────────────────────────
export const auditPoints = complianceSchemaDB.table('audit_points', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  description: text('description'),
  status: complianceStatusEnum('status').notNull().default('pending'),
  dueDate: timestamp('due_date'),
  completedAt: timestamp('completed_at'),
  complianceItemId: text('compliance_item_id').notNull(),
  assignedToId: text('assigned_to_id'),
  clientId: text('client_id'), // Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Documents ───────────────────────────────────────────────────────────
export const documents = complianceSchemaDB.table('documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  fileUrl: text('file_url').notNull(),
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  complianceItemId: text('compliance_item_id'),
  noticeId: text('notice_id'),           // M-12: notice documents
  extractedData: jsonb('extracted_data'), // M-02: AI extracted fields
  uploadedById: text('uploaded_by_id').notNull(),
  clientId: text('client_id'), // Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Comments ────────────────────────────────────────────────────────────
export const comments = complianceSchemaDB.table('comments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  content: text('content').notNull(),
  entityId: text('entity_id').notNull(),
  entityType: text('entity_type').notNull().default('compliance'),
  authorId: text('author_id').notNull(),
  complianceItemId: text('compliance_item_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Notifications ───────────────────────────────────────────────────────
export const notifications = complianceSchemaDB.table('notifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  type: notificationTypeEnum('type').notNull().default('system'),
  isRead: boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Audit Logs ──────────────────────────────────────────────────────────
export const auditLogs = complianceSchemaDB.table('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: auditActionEnum('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  userId: text('user_id').notNull(),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── API Keys (M-03: Open API) ──────────────────────────────────────────
export const apiKeys = complianceSchemaDB.table('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyPrefix: text('key_prefix').notNull(), // first 8 chars for display
  orgId: text('org_id').notNull(),
  scopes: text('scopes').notNull().default('read'), // comma-separated: read,write
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Webhooks (M-16: Outbound) ──────────────────────────────────────────
export const webhooks = complianceSchemaDB.table('webhooks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').notNull(), // comma-separated event types
  isActive: boolean('is_active').notNull().default(true),
  orgId: text('org_id').notNull(),
  lastDeliveryAt: timestamp('last_delivery_at'),
  lastStatusCode: integer('last_status_code'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Webhook Delivery Logs ──────────────────────────────────────────────
export const webhookDeliveries = complianceSchemaDB.table('webhook_deliveries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  webhookId: text('webhook_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  response: text('response'),
  attempt: integer('attempt').notNull().default(1),
  success: boolean('success').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── BYOK AI Configuration (M-04) ────────────────────────────────────────
export const aiConfigurations = complianceSchemaDB.table('ai_configurations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  provider: aiProviderEnum('provider').notNull(),
  encryptedApiKey: text('encrypted_api_key'), // encrypted at rest
  isDefault: boolean('is_default').notNull().default(false),
  useForExtraction: boolean('use_for_extraction').notNull().default(false),
  useForQA: boolean('use_for_qa').notNull().default(false),
  useForDrafting: boolean('use_for_drafting').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Embeddings (M-01: pgvector) ────────────────────────────────────────
export const embeddings = complianceSchemaDB.table('embeddings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  entityType: text('entity_type').notNull(), // compliance_item, notice, document, knowledge_base
  entityId: text('entity_id').notNull(),
  contentHash: text('content_hash').notNull(),
  content: text('content'), // the text that was embedded
  orgId: text('org_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── MCP Access Codes ────────────────────────────────────────────────────
export const mcpAccessCodes = complianceSchemaDB.table('mcp_access_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  token: text('token').notNull().unique(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull().default('Default'),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Onboarding Steps (M-20) ────────────────────────────────────────────
export const onboardingSteps = complianceSchemaDB.table('onboarding_steps', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  step: text('step').notNull(), // e.g. "profile", "first_compliance", "invite_team", "upload_doc"
  completed: boolean('completed').notNull().default(false),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Relations ───────────────────────────────────────────────────────────
export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  departments: many(departments),
  complianceItems: many(complianceItems),
  notices: many(notices),
  challans: many(challans),
  apiKeys: many(apiKeys),
  webhooks: many(webhooks),
  aiConfigurations: many(aiConfigurations),
  embeddings: many(embeddings),
}))

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  org: one(organisations, { fields: [departments.orgId], references: [organisations.id] }),
  head: one(users, { fields: [departments.headId], references: [users.id], relationName: 'deptHead' }),
  users: many(users),
  complianceItems: many(complianceItems),
  notices: many(notices),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  org: one(organisations, { fields: [users.orgId], references: [organisations.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  assignedCompliance: many(complianceItems, { relationName: 'assignedTo' }),
  auditPointAssignments: many(auditPoints, { relationName: 'auditAssignee' }),
  headOfDept: one(departments, { fields: [users.id], references: [departments.headId], relationName: 'deptHead' }),
  auditLogs: many(auditLogs),
  comments: many(comments),
  uploadedDocuments: many(documents),
  onboardingSteps: many(onboardingSteps),
}))

export const complianceItemsRelations = relations(complianceItems, ({ one, many }) => ({
  department: one(departments, { fields: [complianceItems.departmentId], references: [departments.id] }),
  assignedTo: one(users, { fields: [complianceItems.assignedToId], references: [users.id], relationName: 'assignedTo' }),
  org: one(organisations, { fields: [complianceItems.orgId], references: [organisations.id] }),
  parentItem: one(complianceItems, { fields: [complianceItems.recurrenceParentId], references: [complianceItems.id], relationName: 'recurrenceChildren' }),
  childItems: many(complianceItems, { relationName: 'recurrenceChildren' }),
  auditPoints: many(auditPoints),
  documents: many(documents),
  comments: many(comments),
  challans: many(challans),
}))

export const challansRelations = relations(challans, ({ one }) => ({
  complianceItem: one(complianceItems, { fields: [challans.complianceItemId], references: [complianceItems.id] }),
  org: one(organisations, { fields: [challans.orgId], references: [organisations.id] }),
  createdBy: one(users, { fields: [challans.createdById], references: [users.id] }),
}))

export const noticesRelations = relations(notices, ({ one, many }) => ({
  department: one(departments, { fields: [notices.departmentId], references: [departments.id] }),
  assignedTo: one(users, { fields: [notices.assignedToId], references: [users.id], relationName: 'noticeAssignee' }),
  org: one(organisations, { fields: [notices.orgId], references: [organisations.id] }),
  complianceItem: one(complianceItems, { fields: [notices.complianceItemId], references: [complianceItems.id] }),
  documents: many(documents),
}))

export const auditPointsRelations = relations(auditPoints, ({ one }) => ({
  complianceItem: one(complianceItems, { fields: [auditPoints.complianceItemId], references: [complianceItems.id] }),
  assignedTo: one(users, { fields: [auditPoints.assignedToId], references: [users.id], relationName: 'auditAssignee' }),
}))

export const documentsRelations = relations(documents, ({ one }) => ({
  complianceItem: one(complianceItems, { fields: [documents.complianceItemId], references: [complianceItems.id] }),
  notice: one(notices, { fields: [documents.noticeId], references: [notices.id] }),
  uploadedBy: one(users, { fields: [documents.uploadedById], references: [users.id] }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  complianceItem: one(complianceItems, { fields: [comments.complianceItemId], references: [complianceItems.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}))

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  org: one(organisations, { fields: [apiKeys.orgId], references: [organisations.id] }),
}))

export const webhooksRelations = relations(webhooks, ({ one, many }) => ({
  org: one(organisations, { fields: [webhooks.orgId], references: [organisations.id] }),
  deliveries: many(webhookDeliveries),
}))

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}))

export const aiConfigurationsRelations = relations(aiConfigurations, ({ one }) => ({
  org: one(organisations, { fields: [aiConfigurations.orgId], references: [organisations.id] }),
}))

export const mcpAccessCodesRelations = relations(mcpAccessCodes, ({ one }) => ({
  org: one(organisations, { fields: [mcpAccessCodes.orgId], references: [organisations.id] }),
}))

export const onboardingStepsRelations = relations(onboardingSteps, ({ one }) => ({
  user: one(users, { fields: [onboardingSteps.userId], references: [users.id] }),
}))

// ---------------------------------------------------------------------------
// File ingestion pipeline — staging tables
// ---------------------------------------------------------------------------

export const ingestionBatchStatusEnum = complianceSchemaDB.enum('ingestion_batch_status', [
  'processing', 'review_pending', 'confirmed', 'cancelled', 'failed'
])

export const ingestionItemStatusEnum = complianceSchemaDB.enum('ingestion_item_status', [
  'pending', 'approved', 'rejected', 'edited'
])

export const ingestionBatches = complianceSchemaDB.table('ingestion_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(),        // xlsx | csv | pdf
  fileSizeBytes: integer('file_size_bytes'),
  fileUrl: text('file_url'),
  orgId: text('org_id').notNull(),
  uploadedById: text('uploaded_by_id').notNull(),
  status: ingestionBatchStatusEnum('status').notNull().default('processing'),
  totalRows: integer('total_rows'),
  extractedCount: integer('extracted_count'),
  approvedCount: integer('approved_count'),
  rejectedCount: integer('rejected_count'),
  confirmedCount: integer('confirmed_count'),
  aiModel: text('ai_model'),
  extractionSummary: text('extraction_summary'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  cancelledAt: timestamp('cancelled_at'),
})

export const ingestionItems = complianceSchemaDB.table('ingestion_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  batchId: text('batch_id').notNull(),
  sourceRow: integer('source_row'),
  title: text('title'),
  complianceType: text('compliance_type'),
  dueDate: text('due_date'),
  status: text('status').default('pending'),
  priority: text('priority').default('medium'),
  departmentName: text('department_name'),
  departmentId: text('department_id'),
  assignedToName: text('assigned_to_name'),
  assignedToId: text('assigned_to_id'),
  description: text('description'),
  extraData: text('extra_data'),
  confidence: text('confidence').default('0'),
  reviewStatus: ingestionItemStatusEnum('review_status').notNull().default('pending'),
  warnings: text('warnings'),
  missingFields: text('missing_fields'),
  isDuplicate: boolean('is_duplicate').default(false),
  duplicateOfId: text('duplicate_of_id'),
  createdItemId: text('created_item_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const ingestionBatchesRelations = relations(ingestionBatches, ({ one, many }) => ({
  org: one(organisations, { fields: [ingestionBatches.orgId], references: [organisations.id] }),
  uploadedBy: one(users, { fields: [ingestionBatches.uploadedById], references: [users.id] }),
  items: many(ingestionItems),
}))

export const ingestionItemsRelations = relations(ingestionItems, ({ one }) => ({
  batch: one(ingestionBatches, { fields: [ingestionItems.batchId], references: [ingestionBatches.id] }),
}))
