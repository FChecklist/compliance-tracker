import { pgSchema, pgEnum, text, boolean, integer, timestamp, numeric, jsonb, date } from 'drizzle-orm/pg-core'
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
  entityType: text('entity_type'), // M-08: Pvt Ltd, LLP, OPC, etc. -- the org's OWN legal form
  accountType: text('account_type').notNull().default('company'), // Wave 7: 'company' | 'ca_firm' | 'legal_firm' | 'consultant' -- distinct from entityType above; does this account serve one client (itself) or many?
  // Wave 7: these 4 columns were referenced by PATCH /api/me since before
  // this session (orgAddress/orgCin/orgGstin/orgPan) but never actually
  // existed on this table -- every admin settings save that touched org
  // details was throwing a raw "column does not exist" Postgres error.
  address: text('address'),
  cinNumber: text('cin_number'),
  gstin: text('gstin'),
  panNumber: text('pan_number'),
  // Wave 8: 'listed_company' | 'bank_nbfc' | 'insurer' | 'general' -- drives
  // which sector-regulator module (SEBI/RBI/IRDAI) shows real content vs an
  // honest "not applicable" notice. A third, independent axis from
  // entityType (own legal form) and accountType (single-client vs firm).
  regulatoryEntityType: text('regulatory_entity_type').notNull().default('general'),
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
// orgId added Wave 7: the old RLS policy only covered rows with
// complianceItemId set (joining through compliance_items for org scoping),
// which meant documents attached only to a notice (complianceItemId null)
// were invisible under RLS -- a real bug, not a hypothetical. A direct
// orgId column (matching every other table's pattern) fixes that AND makes
// documents usable as a general evidence store (cost receipts, dispatch
// proofs) that isn't forced to link to a complianceItem or notice at all.
export const documents = complianceSchemaDB.table('documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  fileUrl: text('file_url').notNull(), // storage object path within the private 'compliance-documents' bucket, not a public URL -- always resolved to a signed URL server-side
  fileType: text('file_type'),
  fileSize: integer('file_size'),
  complianceItemId: text('compliance_item_id'),
  noticeId: text('notice_id'),           // M-12: notice documents
  extractedData: jsonb('extracted_data'), // M-02: AI extracted fields
  uploadedById: text('uploaded_by_id').notNull(),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // Wave 1
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Compliance Costs (Wave 7) ───────────────────────────────────────────
// Actual money spent EXECUTING a compliance obligation -- government filing
// fees, consultant/CA/CS fees, other out-of-pocket costs -- each with its
// own receipt as evidence. Distinct from `complianceItems.amount`, which is
// the ESTIMATED penalty / cost-of-NON-compliance (risk exposure if this
// item is missed), not money actually paid. A single item can have several
// cost rows (e.g. one government fee + one consultant fee), which is why
// this isn't just another column on complianceItems.
export const costTypeEnum = complianceSchemaDB.enum('cost_type', ['government_fee', 'consultant_fee', 'penalty_paid', 'other'])
// 'pending' is deliberately distinct from 'unpaid': pending = invoice/amount
// not yet finalized or awaiting approval to pay; unpaid = a finalized
// obligation with zero paid against it. paymentStatus is a stated workflow
// field, kept honest by amountPaid + the costPayments ledger below rather
// than trusted blindly -- see the payment-consistency check in the POST
// route (Part below), which recomputes status from real payment rows.
export const paymentStatusEnum = complianceSchemaDB.enum('payment_status', ['pending', 'unpaid', 'partially_paid', 'paid'])

export const complianceCosts = complianceSchemaDB.table('compliance_costs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  complianceItemId: text('compliance_item_id'), // cost can attach to a compliance item OR a notice, not necessarily both
  noticeId: text('notice_id'),
  costType: costTypeEnum('cost_type').notNull(),
  description: text('description'), // e.g. "MCA Form MGT-7 filing fee", "Consultant fee -- Sharma & Associates"
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(), // total amount owed
  amountPaid: numeric('amount_paid', { precision: 14, scale: 2 }).notNull().default('0'), // denormalized running total, recomputed from costPayments on every payment write -- never hand-edited directly
  paymentStatus: paymentStatusEnum('payment_status').notNull().default('pending'),
  paidTo: text('paid_to'), // vendor / consultant / government department name
  dueDate: timestamp('due_date'), // when payment is expected -- lets "unpaid past due date" be queried directly
  receiptDocumentId: text('receipt_document_id'), // -> documents.id, the primary receipt/invoice evidence
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Append-only payment ledger -- this, not `complianceCosts.paymentStatus`
// alone, is what actually prevents "we paid this, no you didn't" disputes.
// Every real payment event is its own row: who recorded it, exactly when,
// how much, and (optionally) its own receipt -- rows are never edited or
// deleted, only added, same immutability principle as audit_logs. A
// "part paid" cost is simply one whose payments sum to less than `amount`.
export const costPayments = complianceSchemaDB.table('cost_payments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  complianceCostId: text('compliance_cost_id').notNull(),
  amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
  paymentDate: timestamp('payment_date').notNull(),
  paymentMethod: text('payment_method'), // 'bank_transfer' | 'cheque' | 'cash' | 'upi' | 'other'
  referenceNumber: text('reference_number'), // transaction ref / cheque number / UTR
  receiptDocumentId: text('receipt_document_id'), // -> documents.id, this specific payment's own receipt
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(), // when this payment was RECORDED -- the dispute-proof timestamp, distinct from paymentDate (when the payment itself happened)
})

// ─── Notice Dispatch / Delivery Evidence (Wave 7) ────────────────────────
// "A reply was filed" is a claim; a courier tracking number + POD scan is
// proof. A notice can have multiple dispatch events over its life (a reply,
// then a follow-up submission), so this is its own table, not columns on
// `notices`.
export const noticeDispatches = complianceSchemaDB.table('notice_dispatches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  noticeId: text('notice_id').notNull(),
  dispatchMethod: text('dispatch_method'), // 'courier' | 'speed_post' | 'email' | 'hand_delivery' | 'online_portal'
  trackingNumber: text('tracking_number'),
  courierName: text('courier_name'),
  dispatchDate: timestamp('dispatch_date'),
  deliveryConfirmedDate: timestamp('delivery_confirmed_date'),
  proofDocumentId: text('proof_document_id'), // -> documents.id, courier receipt / proof-of-delivery scan
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
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

// ─── Audit Logs (Wave 7: unified, immutable activity log) ────────────────
// `action` is free text, not the old fixed auditActionEnum -- the enum's 10
// values (create/update/delete/status_change/assign/reassign/login/logout/
// export/invite) remain a documented convention, but new GRC modules need
// new verbs (view/approve/reject/publish_request/escalate/...) constantly,
// and an ALTER TYPE migration per new verb doesn't scale. orgId lets this
// table be queried/filtered per tenant without a join through users (the
// old RLS policy joined through users.org_id); clientEntityId is nullable
// because account-level actions (login, org settings) have no client.
// actorName/actorRole are DENORMALIZED SNAPSHOTS, captured at write time --
// if a user is later renamed/deactivated, the historical log must still
// show who they were AT THE TIME, not a live join that changes retroactively.
// This table is append-only at the DB level: app_runtime has no UPDATE/
// DELETE grant on it (see drizzle/0005_audit_log_upgrade.sql).
// `clientId` (not `clientEntityId`) to match the convention every other
// domain table already established (complianceItems/challans/notices/
// auditPoints/documents/tasks all scope by `clients.id`, not
// `client_entities.id` -- client_entities is a detail/enrichment layer
// under a client, not the primary scoping key. Matching precedent, not
// introducing a second one.
export const auditLogs = complianceSchemaDB.table('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  // Nullable as of Wave 9: an API-key-driven write has no acting human user.
  // For that case apiKeyId (below) is populated instead -- logActivity()
  // guarantees exactly one of userId/apiKeyId is set, this is not a DB
  // CHECK constraint (kept additive rather than a constrained migration).
  userId: text('user_id'),
  actorName: text('actor_name').notNull(),
  actorRole: text('actor_role').notNull(),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  apiKeyId: text('api_key_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
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
// @deprecated Wave 10: /api/mcp now authenticates against the unified
// api_keys table (see resolveToken() in src/app/api/mcp/route.ts) instead
// of this table. Left in place, not dropped, in case any already-issued
// mcp_access_codes token is still held by a caller somewhere -- actual
// removal is a later, separate cleanup once confirmed nothing still uses it.
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

// ─── AI Assistants (Wave 2: User-tier, strictly per-user) ────────────────
// Each user gets 5 numbered assistants, auto-provisioned on signup (see
// autoProvisionUser in auth-guard.ts) and backfilled for pre-existing users.
// RLS scopes these to compliance.current_user_id() -- readable ONLY by the
// owning user, not even by org admins. See orchestra_changes.md Wave 2.
export const aiAssistants = complianceSchemaDB.table('ai_assistants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull(),
  assistantNumber: integer('assistant_number').notNull(),
  label: text('label').notNull(),
  status: text('status').notNull().default('idle'), // 'idle' | 'working' -- plain text in DB, not a pg enum
  personalityConfig: jsonb('personality_config').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// embedding vector(1536) column deliberately omitted -- Drizzle can't type
// pgvector columns, so it's managed via raw SQL (same pattern as `embeddings`,
// see src/lib/embeddings.ts). Insert/query through withTenantContext's tx.execute.
export const assistantMemories = complianceSchemaDB.table('assistant_memories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assistantId: text('assistant_id').notNull(),
  category: text('category').notNull().default('general'),
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const assistantSessions = complianceSchemaDB.table('assistant_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assistantId: text('assistant_id').notNull(),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  endedAt: timestamp('ended_at'),
  taskCount: integer('task_count').notNull().default(0),
})

export const assistantMetricsDaily = complianceSchemaDB.table('assistant_metrics_daily', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assistantId: text('assistant_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  tasksAssigned: integer('tasks_assigned').notNull().default(0),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksAutoSubmitted: integer('tasks_auto_submitted').notNull().default(0),
  avgCompletionTimeMs: integer('avg_completion_time_ms'),
  humanInterventions: integer('human_interventions').notNull().default(0),
  agentsCalledCount: integer('agents_called_count').notNull().default(0),
})

// ─── Worker Agent Library (Wave 3: 4 tiers -- global/customer/client/user) ──
// `tier='global'` rows are platform-managed and immutable (seeded from the
// pre-existing MCP tools, see src/app/api/mcp/route.ts). Other tiers are
// scoped to exactly one of org_id/client_id/user_id, enforced both by a DB
// CHECK constraint and by RLS (app_runtime can never write tier='global').
// capability_embedding / knowledge_embedding vector(1536) columns deliberately
// omitted, same as assistant_memories -- managed via raw SQL.
export const workerAgents = complianceSchemaDB.table('worker_agents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tier: text('tier').notNull(), // 'global' | 'customer' | 'client' | 'user'
  name: text('name').notNull(),
  domain: text('domain'),
  description: text('description'),
  codeReference: text('code_reference'),
  promptTemplate: text('prompt_template'),
  inputSchema: jsonb('input_schema').notNull().default({}),
  outputSchema: jsonb('output_schema').notNull().default({}),
  isImmutable: boolean('is_immutable').notNull().default(false),
  version: integer('version').notNull().default(1),
  usageCount: integer('usage_count').notNull().default(0),
  accuracyScore: numeric('accuracy_score'),
  orgId: text('org_id'),
  clientId: text('client_id'),
  userId: text('user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const workerAgentVersions = complianceSchemaDB.table('worker_agent_versions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workerAgentId: text('worker_agent_id').notNull(),
  version: integer('version').notNull(),
  promptTemplate: text('prompt_template'),
  inputSchema: jsonb('input_schema').notNull().default({}),
  outputSchema: jsonb('output_schema').notNull().default({}),
  changelog: text('changelog'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const workerAgentUsageLog = complianceSchemaDB.table('worker_agent_usage_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workerAgentId: text('worker_agent_id').notNull(),
  orgId: text('org_id'),
  clientId: text('client_id'),
  userId: text('user_id'),
  executedAt: timestamp('executed_at').notNull().defaultNow(),
  durationMs: integer('duration_ms'),
  success: boolean('success').notNull().default(true),
  errorMessage: text('error_message'),
})

// embedding vector(1536) column omitted, see note above.
export const workerAgentLearnings = complianceSchemaDB.table('worker_agent_learnings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workerAgentId: text('worker_agent_id').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const workerAgentDomainIndex = complianceSchemaDB.table('worker_agent_domain_index', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workerAgentId: text('worker_agent_id').notNull(),
  domainPath: text('domain_path').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Task System + Orchestra Layers (Wave 4) ─────────────────────────────
// task_embedding vector(1536) column omitted, same pattern as elsewhere --
// managed via raw SQL through withTenantContext's tx.execute.
export const tasks = complianceSchemaDB.table('tasks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  userId: text('user_id'),
  assistantId: text('assistant_id'),
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'), // pending | in_progress | completed | failed | cancelled
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const taskExecutionPlan = complianceSchemaDB.table('task_execution_plan', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  taskId: text('task_id').notNull(),
  stepNumber: integer('step_number').notNull(),
  workerAgentId: text('worker_agent_id'),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const taskAgentExecutions = complianceSchemaDB.table('task_agent_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  taskExecutionPlanId: text('task_execution_plan_id').notNull(),
  workerAgentId: text('worker_agent_id'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  status: text('status').notNull().default('pending'),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output'),
  errorMessage: text('error_message'),
})

export const taskChatMessages = complianceSchemaDB.table('task_chat_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  taskId: text('task_id').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Seeded with the 5 layers from the master spec: Task OA, User Assistant OA,
// Customer Account OA, Global Intelligence OA, Meta OA. Global read (no
// org scoping), same as subscription_plans.
export const orchestraLayers = complianceSchemaDB.table('orchestra_layers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  layerKey: text('layer_key').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  layerOrder: integer('layer_order').notNull(),
  defaultModelConfig: jsonb('default_model_config').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const orchestraExecutions = complianceSchemaDB.table('orchestra_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orchestraLayerId: text('orchestra_layer_id').notNull(),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  userId: text('user_id'),
  taskId: text('task_id'),
  eventType: text('event_type').notNull(),
  input: jsonb('input').notNull().default({}),
  output: jsonb('output'),
  status: text('status').notNull().default('pending'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Per-org, optionally per-layer BYO model override. orchestraLayerId=null
// means "applies to all layers for this org". Distinct from ai_configurations
// (Wave 0's BYOK table), which is per-org/per-purpose (extraction/QA/drafting),
// not per-orchestra-layer -- see master spec Wave 4.
export const customerModelConfig = complianceSchemaDB.table('customer_model_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  orchestraLayerId: text('orchestra_layer_id'),
  provider: aiProviderEnum('provider').notNull(),
  encryptedApiKey: text('encrypted_api_key'),
  modelName: text('model_name'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Self-Improvement Loops + Knowledge Flow (Wave 5) ────────────────────
// Platform-operational tables, NOT tenant data -- loop_executions and
// friends have no app_runtime RLS policy at all (service_role bypass only),
// since some loops (12/13) deliberately run cross-tenant audits whose
// results must never be exposed through the normal org-scoped app path.
export const loopDefinitions = complianceSchemaDB.table('loop_definitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  loopNumber: integer('loop_number').notNull(),
  loopName: text('loop_name').notNull(),
  description: text('description'),
  observeWhat: text('observe_what'),
  analyzeHow: text('analyze_how'),
  actWhat: text('act_what'),
  measureWhat: text('measure_what'),
  targetOrchestraLayers: text('target_orchestra_layers').array().notNull().default([]),
  executionFrequency: text('execution_frequency'), // interval, read/written as text via raw SQL if ever needed
  isActive: boolean('is_active').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const loopExecutions = complianceSchemaDB.table('loop_executions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  loopId: text('loop_id').notNull(),
  triggeredBy: text('triggered_by').notNull(), // 'scheduled' | 'event' | 'manual'
  observationData: jsonb('observation_data').notNull().default({}),
  analysisResult: jsonb('analysis_result').notNull().default({}),
  actionTaken: jsonb('action_taken').notNull().default({}),
  measurementResult: jsonb('measurement_result').notNull().default({}),
  improvementDelta: numeric('improvement_delta'),
  executionTimeMs: integer('execution_time_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const loopImprovements = complianceSchemaDB.table('loop_improvements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  loopId: text('loop_id').notNull(),
  improvementType: text('improvement_type').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  improvementDelta: numeric('improvement_delta'),
  isDeployed: boolean('is_deployed').notNull().default(false),
  deployedAt: timestamp('deployed_at'),
  rollbackTriggered: boolean('rollback_triggered').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const loopHealthMetrics = complianceSchemaDB.table('loop_health_metrics', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  loopId: text('loop_id').notNull(),
  date: date('date', { mode: 'string' }).notNull(),
  executionsCount: integer('executions_count').notNull().default(0),
  improvementsGenerated: integer('improvements_generated').notNull().default(0),
  improvementsDeployed: integer('improvements_deployed').notNull().default(0),
  improvementsRolledBack: integer('improvements_rolled_back').notNull().default(0),
  avgImprovementDelta: numeric('avg_improvement_delta'),
  systemHealthScore: numeric('system_health_score'),
})

export const knowledgeFlowLog = complianceSchemaDB.table('knowledge_flow_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  direction: text('direction').notNull(), // 'up' | 'down'
  fromTier: text('from_tier').notNull(),
  toTier: text('to_tier').notNull(),
  sourceAgentId: text('source_agent_id'),
  targetAgentId: text('target_agent_id'),
  knowledgeType: text('knowledge_type').notNull(),
  contentSummary: text('content_summary'),
  isAnonymized: boolean('is_anonymized').notNull().default(false),
  anonymizationMethod: text('anonymization_method'),
  orgId: text('org_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const dataSeparationAudit = complianceSchemaDB.table('data_separation_audit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  auditType: text('audit_type').notNull(), // 'access_check' | 'query_analysis' | 'cross_contamination_test'
  orgId: text('org_id'),
  userId: text('user_id'),
  queryText: text('query_text'),
  vectorSpacesAccessed: text('vector_spaces_accessed').array(),
  crossContaminationDetected: boolean('cross_contamination_detected').notNull().default(false),
  details: jsonb('details').notNull().default({}),
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
  branches: many(branches),
  clients: many(clients),
}))

export const branchesRelations = relations(branches, ({ one, many }) => ({
  org: one(organisations, { fields: [branches.orgId], references: [organisations.id] }),
  clients: many(clients),
}))

export const clientsRelations = relations(clients, ({ one, many }) => ({
  org: one(organisations, { fields: [clients.orgId], references: [organisations.id] }),
  branch: one(branches, { fields: [clients.branchId], references: [branches.id] }),
  entities: many(clientEntities),
  userAccess: many(userClientAccess),
}))

export const clientEntitiesRelations = relations(clientEntities, ({ one }) => ({
  client: one(clients, { fields: [clientEntities.clientId], references: [clients.id] }),
}))

export const userClientAccessRelations = relations(userClientAccess, ({ one }) => ({
  user: one(users, { fields: [userClientAccess.userId], references: [users.id] }),
  client: one(clients, { fields: [userClientAccess.clientId], references: [clients.id] }),
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
  costs: many(complianceCosts),
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
  costs: many(complianceCosts),
  dispatches: many(noticeDispatches),
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

export const complianceCostsRelations = relations(complianceCosts, ({ one, many }) => ({
  complianceItem: one(complianceItems, { fields: [complianceCosts.complianceItemId], references: [complianceItems.id] }),
  notice: one(notices, { fields: [complianceCosts.noticeId], references: [notices.id] }),
  receiptDocument: one(documents, { fields: [complianceCosts.receiptDocumentId], references: [documents.id] }),
  recordedBy: one(users, { fields: [complianceCosts.recordedById], references: [users.id] }),
  payments: many(costPayments),
}))

export const costPaymentsRelations = relations(costPayments, ({ one }) => ({
  cost: one(complianceCosts, { fields: [costPayments.complianceCostId], references: [complianceCosts.id] }),
  receiptDocument: one(documents, { fields: [costPayments.receiptDocumentId], references: [documents.id] }),
  recordedBy: one(users, { fields: [costPayments.recordedById], references: [users.id] }),
}))

export const noticeDispatchesRelations = relations(noticeDispatches, ({ one }) => ({
  notice: one(notices, { fields: [noticeDispatches.noticeId], references: [notices.id] }),
  proofDocument: one(documents, { fields: [noticeDispatches.proofDocumentId], references: [documents.id] }),
  recordedBy: one(users, { fields: [noticeDispatches.recordedById], references: [users.id] }),
}))

export const commentsRelations = relations(comments, ({ one }) => ({
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
  complianceItem: one(complianceItems, { fields: [comments.complianceItemId], references: [complianceItems.id] }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
  org: one(organisations, { fields: [auditLogs.orgId], references: [organisations.id] }),
  client: one(clients, { fields: [auditLogs.clientId], references: [clients.id] }),
  apiKey: one(apiKeys, { fields: [auditLogs.apiKeyId], references: [apiKeys.id] }),
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

export const aiAssistantsRelations = relations(aiAssistants, ({ one, many }) => ({
  user: one(users, { fields: [aiAssistants.userId], references: [users.id] }),
  memories: many(assistantMemories),
  sessions: many(assistantSessions),
  metricsDaily: many(assistantMetricsDaily),
}))

export const assistantMemoriesRelations = relations(assistantMemories, ({ one }) => ({
  assistant: one(aiAssistants, { fields: [assistantMemories.assistantId], references: [aiAssistants.id] }),
}))

export const assistantSessionsRelations = relations(assistantSessions, ({ one }) => ({
  assistant: one(aiAssistants, { fields: [assistantSessions.assistantId], references: [aiAssistants.id] }),
}))

export const assistantMetricsDailyRelations = relations(assistantMetricsDaily, ({ one }) => ({
  assistant: one(aiAssistants, { fields: [assistantMetricsDaily.assistantId], references: [aiAssistants.id] }),
}))

export const workerAgentsRelations = relations(workerAgents, ({ many }) => ({
  versions: many(workerAgentVersions),
  usageLog: many(workerAgentUsageLog),
  learnings: many(workerAgentLearnings),
  domainIndex: many(workerAgentDomainIndex),
}))

export const workerAgentVersionsRelations = relations(workerAgentVersions, ({ one }) => ({
  workerAgent: one(workerAgents, { fields: [workerAgentVersions.workerAgentId], references: [workerAgents.id] }),
}))

export const workerAgentUsageLogRelations = relations(workerAgentUsageLog, ({ one }) => ({
  workerAgent: one(workerAgents, { fields: [workerAgentUsageLog.workerAgentId], references: [workerAgents.id] }),
}))

export const workerAgentLearningsRelations = relations(workerAgentLearnings, ({ one }) => ({
  workerAgent: one(workerAgents, { fields: [workerAgentLearnings.workerAgentId], references: [workerAgents.id] }),
}))

export const workerAgentDomainIndexRelations = relations(workerAgentDomainIndex, ({ one }) => ({
  workerAgent: one(workerAgents, { fields: [workerAgentDomainIndex.workerAgentId], references: [workerAgents.id] }),
}))

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  assistant: one(aiAssistants, { fields: [tasks.assistantId], references: [aiAssistants.id] }),
  executionPlan: many(taskExecutionPlan),
  chatMessages: many(taskChatMessages),
}))

export const taskExecutionPlanRelations = relations(taskExecutionPlan, ({ one, many }) => ({
  task: one(tasks, { fields: [taskExecutionPlan.taskId], references: [tasks.id] }),
  workerAgent: one(workerAgents, { fields: [taskExecutionPlan.workerAgentId], references: [workerAgents.id] }),
  agentExecutions: many(taskAgentExecutions),
}))

export const taskAgentExecutionsRelations = relations(taskAgentExecutions, ({ one }) => ({
  executionPlan: one(taskExecutionPlan, { fields: [taskAgentExecutions.taskExecutionPlanId], references: [taskExecutionPlan.id] }),
  workerAgent: one(workerAgents, { fields: [taskAgentExecutions.workerAgentId], references: [workerAgents.id] }),
}))

export const taskChatMessagesRelations = relations(taskChatMessages, ({ one }) => ({
  task: one(tasks, { fields: [taskChatMessages.taskId], references: [tasks.id] }),
}))

export const orchestraLayersRelations = relations(orchestraLayers, ({ many }) => ({
  executions: many(orchestraExecutions),
  modelConfigs: many(customerModelConfig),
}))

export const orchestraExecutionsRelations = relations(orchestraExecutions, ({ one }) => ({
  layer: one(orchestraLayers, { fields: [orchestraExecutions.orchestraLayerId], references: [orchestraLayers.id] }),
  task: one(tasks, { fields: [orchestraExecutions.taskId], references: [tasks.id] }),
}))

export const customerModelConfigRelations = relations(customerModelConfig, ({ one }) => ({
  layer: one(orchestraLayers, { fields: [customerModelConfig.orchestraLayerId], references: [orchestraLayers.id] }),
}))

export const loopDefinitionsRelations = relations(loopDefinitions, ({ many }) => ({
  executions: many(loopExecutions),
  improvements: many(loopImprovements),
  healthMetrics: many(loopHealthMetrics),
}))

export const loopExecutionsRelations = relations(loopExecutions, ({ one }) => ({
  loop: one(loopDefinitions, { fields: [loopExecutions.loopId], references: [loopDefinitions.id] }),
}))

export const loopImprovementsRelations = relations(loopImprovements, ({ one }) => ({
  loop: one(loopDefinitions, { fields: [loopImprovements.loopId], references: [loopDefinitions.id] }),
}))

export const loopHealthMetricsRelations = relations(loopHealthMetrics, ({ one }) => ({
  loop: one(loopDefinitions, { fields: [loopHealthMetrics.loopId], references: [loopDefinitions.id] }),
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

// ═══════════════════════════════════════════════════════════════════════
// Wave 8 — Full GRC module breadth, matching the design-mockup session.
// All tables follow the Wave 7 conventions: id via createId(), orgId
// NOT NULL + clientId nullable (scoping precedent from Wave 7), RLS via
// `org_id = compliance.current_org_id()` applied in the migration, every
// write logged via src/lib/audit.ts's logActivity(). `classification`
// columns (text, not enum -- see src/lib/classification.ts) default to the
// mockup's documented default per module.
// ═══════════════════════════════════════════════════════════════════════

// ─── GOVERNANCE ──────────────────────────────────────────────────────────
export const boardMeetingTypeEnum = complianceSchemaDB.enum('board_meeting_type', ['board_meeting', 'agm', 'egm', 'committee_meeting'])
export const boardMeetingStatusEnum = complianceSchemaDB.enum('board_meeting_status', ['scheduled', 'held', 'cancelled'])

export const boardMeetings = complianceSchemaDB.table('board_meetings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  meetingType: boardMeetingTypeEnum('meeting_type').notNull().default('board_meeting'),
  meetingDate: timestamp('meeting_date').notNull(),
  status: boardMeetingStatusEnum('status').notNull().default('scheduled'),
  agenda: jsonb('agenda').notNull().default([]), // string[]
  attendees: jsonb('attendees').notNull().default([]), // string[] -- names, not FK'd to users (external directors may not be app users)
  minutes: text('minutes'),
  minutesHistory: jsonb('minutes_history').notNull().default([]), // { date, amendedBy, text }[] -- amendments append, never overwrite
  classification: text('classification').notNull().default('board_only'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const boardActionItems = complianceSchemaDB.table('board_action_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  boardMeetingId: text('board_meeting_id').notNull(),
  item: text('item').notNull(),
  ownerId: text('owner_id'),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('open'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const committees = complianceSchemaDB.table('committees', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  charter: text('charter'),
  chairId: text('chair_id'),
  cadence: text('cadence'),
  lastMetDate: timestamp('last_met_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const rptApprovalStatusEnum = complianceSchemaDB.enum('rpt_approval_status', ['pending', 'approved', 'rejected'])

export const relatedPartyTransactions = complianceSchemaDB.table('related_party_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  partyName: text('party_name').notNull(),
  natureOfTransaction: text('nature_of_transaction'),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  approvalStatus: rptApprovalStatusEnum('approval_status').notNull().default('pending'),
  approvedById: text('approved_by_id'),
  transactionDate: timestamp('transaction_date'),
  classification: text('classification').notNull().default('board_only'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const delegationOfAuthority = complianceSchemaDB.table('delegation_of_authority', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  activity: text('activity').notNull(),
  thresholdDescription: text('threshold_description'),
  approverRole: text('approver_role'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const directorsKmp = complianceSchemaDB.table('directors_kmp', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  din: text('din'),
  designation: text('designation'),
  isIndependent: boolean('is_independent').notNull().default(false),
  kycStatus: text('kyc_status').default('valid'),
  kycValidTill: timestamp('kyc_valid_till'),
  appointedDate: timestamp('appointed_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const boardEvaluations = complianceSchemaDB.table('board_evaluations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  cycle: text('cycle').notNull(),
  currentStage: text('current_stage').notNull().default('initiated'),
  scope: jsonb('scope').notNull().default([]),
  respondents: jsonb('respondents').notNull().default([]), // { name, role, responded }[]
  actionItems: jsonb('action_items').notNull().default([]), // { item, owner, status }[]
  history: jsonb('history').notNull().default([]), // { cycle, completedDate, outcome }[]
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const policyStatusEnum = complianceSchemaDB.enum('policy_status', ['draft', 'under_review', 'published'])

export const policies = complianceSchemaDB.table('policies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  category: text('category').notNull().default('governance'), // governance|hr|environment|data_privacy|third_party
  version: text('version').notNull().default('v1.0'),
  status: policyStatusEnum('status').notNull().default('draft'),
  attestationRate: integer('attestation_rate').notNull().default(0),
  history: jsonb('history').notNull().default([]), // { version, date, editedBy, note }[]
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Generic maker-checker used across modules (policy publish, RPT approval,
// ...) instead of each module inventing its own approval mechanism.
export const approvalRequestStatusEnum = complianceSchemaDB.enum('approval_request_status', ['pending', 'approved', 'rejected'])

export const approvalRequests = complianceSchemaDB.table('approval_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  requestType: text('request_type').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  description: text('description'),
  status: approvalRequestStatusEnum('status').notNull().default('pending'),
  requestedById: text('requested_by_id').notNull(),
  approvedById: text('approved_by_id'),
  rejectionReason: text('rejection_reason'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
})

// ─── COMPANY SECRETARIAL ─────────────────────────────────────────────────
export const capTableEntries = complianceSchemaDB.table('cap_table_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  holderName: text('holder_name').notNull(),
  shares: integer('shares').notNull(),
  percent: numeric('percent', { precision: 5, scale: 2 }),
  shareClass: text('share_class').default('Equity'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const capTableEvents = complianceSchemaDB.table('cap_table_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  eventType: text('event_type').notNull(), // 'allotment' | 'transfer' | 'esop_grant' | 'buyback'
  description: text('description'),
  shares: integer('shares'),
  eventDate: timestamp('event_date'),
  status: text('status').default('registered'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const companyCharges = complianceSchemaDB.table('company_charges', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  chargeHolder: text('charge_holder').notNull(),
  chargeType: text('charge_type'),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  filingReference: text('filing_reference'),
  status: text('status').notNull().default('open'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const secretarialAudits = complianceSchemaDB.table('secretarial_audits', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  period: text('period').notNull(),
  auditorName: text('auditor_name'),
  status: text('status').notNull().default('in_progress'),
  dueDate: timestamp('due_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Honest by design (matches the mockup's disclaimer): this tracks
// preparation/status/SRN of an MCA filing. It does NOT file anything --
// actual submission requires the Company Secretary's own Digital Signature
// Certificate on the government MCA portal. No code path here should ever
// imply otherwise.
export const mcaFilings = complianceSchemaDB.table('mca_filings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  formType: text('form_type').notNull(),
  description: text('description'),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('preparing'), // 'preparing' | 'ready_to_file' | 'filed'
  srn: text('srn'),
  filedDate: timestamp('filed_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── LEGAL ───────────────────────────────────────────────────────────────
export const legalVendors = complianceSchemaDB.table('legal_vendors', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  vendorType: text('vendor_type'), // 'Law Firm' | 'CS Agency' | 'Tax Advisory' | 'Independent Counsel'
  engagementType: text('engagement_type'), // 'Retainer' | 'Ad-hoc'
  currentMatter: text('current_matter'),
  status: text('status').notNull().default('active'),
  fee: numeric('fee', { precision: 14, scale: 2 }),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const litigationStageEnum = complianceSchemaDB.enum('litigation_stage', ['filed', 'hearing_scheduled', 'judgment_reserved', 'judgment_passed', 'appeal_filed', 'closed'])

export const litigationMatters = complianceSchemaDB.table('litigation_matters', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  matter: text('matter').notNull(),
  matterType: text('matter_type'),
  forum: text('forum'),
  stage: litigationStageEnum('stage').notNull().default('filed'),
  nextHearingDate: timestamp('next_hearing_date'),
  counsel: text('counsel'),
  amount: numeric('amount', { precision: 14, scale: 2 }),
  linkedNoticeId: text('linked_notice_id'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const ipPortfolio = complianceSchemaDB.table('ip_portfolio', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  mark: text('mark').notNull(),
  ipType: text('ip_type'), // 'Trademark' | 'Patent' | 'Copyright' | 'Design'
  status: text('status').notNull().default('application_filed'),
  renewalDate: timestamp('renewal_date'),
  classDescription: text('class_description'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const legalOpinions = complianceSchemaDB.table('legal_opinions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  topic: text('topic').notNull(),
  opinionDate: timestamp('opinion_date'),
  advisor: text('advisor'),
  linkedRiskId: text('linked_risk_id'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── PEOPLE & HR ─────────────────────────────────────────────────────────
export const hrComplianceItems = complianceSchemaDB.table('hr_compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  item: text('item').notNull(),
  governingLaw: text('governing_law'),
  state: text('state').notNull().default('All India'),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('not_due_yet'), // 'filed' | 'overdue' | 'not_due_yet'
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const leavePolicyEntries = complianceSchemaDB.table('leave_policy_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  leaveType: text('leave_type').notNull(),
  governingLaw: text('governing_law'),
  entitlement: text('entitlement'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const holidayListFilings = complianceSchemaDB.table('holiday_list_filings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  state: text('state').notNull(),
  year: text('year').notNull(),
  status: text('status').notNull().default('pending_filing'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const poshCommittee = complianceSchemaDB.table('posh_committee', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  memberName: text('member_name').notNull(),
  role: text('role'), // 'Presiding Officer' | 'Member' | 'External Member'
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Case detail is deliberately NOT a column here -- only a case reference,
// matching the mockup's rule that even the shared activity/audit log never
// records POSH case content, just that a case was logged. Full case
// handling stays outside this platform's data model by design.
export const poshComplaints = complianceSchemaDB.table('posh_complaints', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caseRef: text('case_ref').notNull(),
  receivedDate: timestamp('received_date').notNull(),
  status: text('status').notNull().default('under_inquiry'),
  classification: text('classification').notNull().default('confidential'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const poshAnnualReports = complianceSchemaDB.table('posh_annual_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  year: text('year').notNull(),
  filedWith: text('filed_with'),
  status: text('status').notNull().default('pending'),
  filedDate: timestamp('filed_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── RISK ────────────────────────────────────────────────────────────────
export const riskCategoryEnum = complianceSchemaDB.enum('risk_category', ['regulatory', 'operational', 'financial', 'strategic', 'reputational', 'cyber'])
export const riskStatusEnum = complianceSchemaDB.enum('risk_status', ['open', 'mitigating', 'closed'])

export const risks = complianceSchemaDB.table('risks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  category: riskCategoryEnum('category').notNull().default('operational'),
  likelihood: integer('likelihood').notNull().default(3),
  impact: integer('impact').notNull().default(3),
  ownerId: text('owner_id'),
  ownerDept: text('owner_dept'),
  status: riskStatusEnum('status').notNull().default('open'),
  linkedControlIds: jsonb('linked_control_ids').notNull().default([]),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── SECTOR REGULATORS ───────────────────────────────────────────────────
// Gated by organisations.accountType-adjacent concept: entityType here is
// per-org 'listed_company' | 'bank_nbfc' | 'insurer' | 'general' -- see the
// organisations.regulatoryEntityType column below. Not shown as
// universally applicable, same principle as the mockup's sectorGate().
export const sebiComplianceItems = complianceSchemaDB.table('sebi_compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  requirement: text('requirement').notNull(),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('not_due_yet'),
  linkedModule: text('linked_module'), // 'rpt' | 'esg' -- for UI cross-linking
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const rbiComplianceItems = complianceSchemaDB.table('rbi_compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  circular: text('circular').notNull(),
  category: text('category'),
  status: text('status').notNull().default('not_started'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const irdaiComplianceItems = complianceSchemaDB.table('irdai_compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  requirement: text('requirement').notNull(),
  category: text('category'),
  status: text('status').notNull().default('not_started'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── AUDIT — Controls & Framework Library, risk-based Audit Management ───
export const complianceFrameworks = complianceSchemaDB.table('compliance_frameworks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  frameworkKey: text('framework_key').notNull(), // 'iso27001'|'soc2'|'india_statutory'|'dpdp'|'coso'|'nist'|'pcidss'|'hipaa'
  name: text('name').notNull(),
  relevanceNote: text('relevance_note'), // set for opt-in frameworks (PCI DSS/HIPAA) -- see mockup's Section 15
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const frameworkControls = complianceSchemaDB.table('framework_controls', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  frameworkId: text('framework_id').notNull(),
  controlRef: text('control_ref').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('not_started'), // 'not_started'|'in_progress'|'implemented'|'verified'
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const auditEngagements = complianceSchemaDB.table('audit_engagements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  auditType: text('audit_type').notNull().default('internal'), // 'internal'|'certification'|'statutory'
  status: text('status').notNull().default('planned'),
  coversRiskIds: jsonb('covers_risk_ids').notNull().default([]),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const auditFindings = complianceSchemaDB.table('audit_findings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  auditEngagementId: text('audit_engagement_id').notNull(),
  title: text('title').notNull(),
  severity: text('severity').notNull().default('medium'),
  capaStatus: text('capa_status').notNull().default('open'), // 'open'|'in_progress'|'closed'
  linkedRiskId: text('linked_risk_id'),
  ownerId: text('owner_id'),
  dueDate: timestamp('due_date'),
  retestResult: text('retest_result').default('not_started'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── THIRD-PARTY & ESG ───────────────────────────────────────────────────
export const vendorRiskProfiles = complianceSchemaDB.table('vendor_risk_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  riskTier: text('risk_tier').notNull().default('medium'),
  certifications: jsonb('certifications').notNull().default([]),
  lastAssessedDate: timestamp('last_assessed_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// pillar values computed at read time by the ESG API route where possible
// (POSH resolution rate, policy attestation) -- rows here are the ones with
// no live equivalent elsewhere (emissions, water, diversity, etc).
export const esgMetrics = complianceSchemaDB.table('esg_metrics', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  pillar: text('pillar').notNull(), // 'environment'|'social'|'governance'
  label: text('label').notNull(),
  valuePercent: integer('value_percent').notNull().default(0),
  note: text('note'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── INTEGRITY ───────────────────────────────────────────────────────────
export const whistleblowerCases = complianceSchemaDB.table('whistleblower_cases', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  caseRef: text('case_ref').notNull(),
  category: text('category'),
  receivedDate: timestamp('received_date').notNull(),
  status: text('status').notNull().default('open'),
  classification: text('classification').notNull().default('confidential'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const bcmPlans = complianceSchemaDB.table('bcm_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planName: text('plan_name').notNull(),
  lastTestedDate: timestamp('last_tested_date'),
  status: text('status').notNull().default('not_tested'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const contractComplianceItems = complianceSchemaDB.table('contract_compliance_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  vendorName: text('vendor_name').notNull(),
  clauseDescription: text('clause_description'),
  renewalDate: timestamp('renewal_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── INCIDENTS & EVENTS ──────────────────────────────────────────────────
export const incidentStageEnum = complianceSchemaDB.enum('incident_stage', ['logged', 'triaged', 'investigating', 'contained', 'notified', 'remediated', 'closed'])

export const incidents = complianceSchemaDB.table('incidents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  category: text('category').notNull(), // 'Security / Data Breach' | 'Operational' | 'Safety' | 'Financial'
  severity: text('severity').notNull().default('medium'),
  classification: text('classification').notNull().default('department'),
  stage: incidentStageEnum('stage').notNull().default('logged'),
  linkedRiskId: text('linked_risk_id'),
  linkedControlId: text('linked_control_id'),
  regulatoryNotifyRequired: boolean('regulatory_notify_required').notNull().default(false),
  notifyDeadline: text('notify_deadline'),
  notified: boolean('notified').notNull().default(false),
  capaOwnerId: text('capa_owner_id'),
  capaDueDate: timestamp('capa_due_date'),
  closedDate: timestamp('closed_date'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  reportedById: text('reported_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Relations for the new tables that benefit from Drizzle's `with:` API ─
export const approvalRequestsRelations = relations(approvalRequests, ({ one }) => ({
  requestedBy: one(users, { fields: [approvalRequests.requestedById], references: [users.id], relationName: 'approvalRequestedBy' }),
  approvedBy: one(users, { fields: [approvalRequests.approvedById], references: [users.id], relationName: 'approvalApprovedBy' }),
}))
export const boardMeetingsRelations = relations(boardMeetings, ({ many }) => ({
  actionItems: many(boardActionItems),
}))
export const boardActionItemsRelations = relations(boardActionItems, ({ one }) => ({
  meeting: one(boardMeetings, { fields: [boardActionItems.boardMeetingId], references: [boardMeetings.id] }),
}))
export const auditEngagementsRelations = relations(auditEngagements, ({ many }) => ({
  findings: many(auditFindings),
}))
export const auditFindingsRelations = relations(auditFindings, ({ one }) => ({
  engagement: one(auditEngagements, { fields: [auditFindings.auditEngagementId], references: [auditEngagements.id] }),
}))
export const complianceFrameworksRelations = relations(complianceFrameworks, ({ many }) => ({
  controls: many(frameworkControls),
}))
export const frameworkControlsRelations = relations(frameworkControls, ({ one }) => ({
  framework: one(complianceFrameworks, { fields: [frameworkControls.frameworkId], references: [complianceFrameworks.id] }),
}))
