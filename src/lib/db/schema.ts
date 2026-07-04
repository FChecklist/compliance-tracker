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
export const notificationTypeEnum = complianceSchemaDB.enum('notification_type', ['deadline_reminder', 'assignment', 'status_change', 'comment', 'system', 'mention', 'instruction_mismatch'])
export const auditActionEnum = complianceSchemaDB.enum('audit_action', ['create', 'update', 'delete', 'status_change', 'assign', 'reassign', 'login', 'logout', 'export', 'invite'])
export const recurrenceTypeEnum = complianceSchemaDB.enum('recurrence_type', ['none', 'monthly', 'quarterly', 'half_yearly', 'annually'])
export const noticeStatusEnum = complianceSchemaDB.enum('notice_status', ['received', 'in_progress', 'replied', 'closed', 'appealed'])
export const aiProviderEnum = complianceSchemaDB.enum('ai_provider', ['groq', 'openai', 'anthropic', 'google', 'openrouter'])
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
  // Wave 24 (PageAgent integration): org-level on/off switch for the
  // client-side GUI agent -- default true, deployed as default per the
  // user's explicit instruction. Distinct from whether a model is actually
  // configured for it (page_agent_oa layer) -- an org can have both a
  // model configured AND this off, or vice versa.
  pageAgentEnabled: boolean('page_agent_enabled').notNull().default(true),
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
  // Wave 14: generic type-specific payload (e.g. instruction_mismatch needs
  // {conversationId, mismatchId} for the topbar's click-through to open the
  // exact chat thread) -- avoids a bespoke FK column per notification type.
  metadata: jsonb('metadata').notNull().default({}),
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
  // Wave 17 (Purpose-Bound AI): null = unconstrained (every pre-existing key's
  // exact current behavior, zero migration risk). If set, /api/mcp's
  // handleTool() rejects any tool call outside this domain before dispatch.
  domainScope: text('domain_scope'),
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
// `embedding vector(1536)` column intentionally omitted here (Drizzle has no
// first-class pgvector type; managed via raw SQL, same pattern as
// task_embedding elsewhere). Wave 45 discovered while testing VERI FDE
// end-to-end that this column had never actually been created on the live
// table at all -- despite embeddings.ts depending on it since inception --
// meaning every storeEmbedding()/findSimilar() call had been silently
// failing in production. Fixed via migration 0037; see PLATFORM_STRATEGY.md §26.
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
  // Wave 22 (MemPalace-inspired temporal versioning): validFrom/validUntil
  // let a memory be superseded rather than silently overwritten --
  // validUntil NULL means "still current". No consumer reads these yet
  // (built ahead of need, per explicit user confirmation) -- every
  // pre-existing row backfills validFrom=createdAt, validUntil=NULL
  // (still current), which is the correct, non-lossy default.
  validFrom: timestamp('valid_from').notNull().defaultNow(),
  validUntil: timestamp('valid_until'),
  supersededByMemoryId: text('superseded_by_memory_id'),
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
  // Wave 16 (VAIOS Worker Agent Governance): the real state machine --
  // `isImmutable` above stays exactly as-is (a live boolean already read by
  // task-execution-engine.ts's dispatch gate and GET /api/worker-agents;
  // redefining it would be a silent breaking change). `lifecycleStatus` is
  // additive: 'draft' | 'proposed' | 'approved' | 'published' | 'retired'.
  // Every pre-existing seeded row backfills to 'published' -- correct and
  // non-lossy, since every one of them has been live/dispatchable already.
  lifecycleStatus: text('lifecycle_status').notNull().default('published'),
  // Self-FK for the constitution's "Digital Department" grouping -- a
  // supervisor agent one or more subordinate agents report to.
  supervisorWorkerAgentId: text('supervisor_worker_agent_id'),
  proposedById: text('proposed_by_id'),
  projectId: text('project_id'), // Wave 19: optional Product/Project (L2) scope -- distinct from tier='client' (a broader client-account scope)
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
  // Wave 15: distinguishes "assigned to me" from "assigned by me, to someone
  // else" for Home's To Do tab -- backfilled to assignedById = userId for
  // every pre-existing row (self-assigned, the only mode that existed
  // before this wave). Nullable because userId itself is nullable.
  assignedById: text('assigned_by_id'),
  projectId: text('project_id'), // Wave 19: optional Product/Project (L2) scope
  dueDate: timestamp('due_date'), // Wave 44: generalized from meettrack-v2's per-action-item target_date
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
  // Wave 22/23 (Langfuse-inspired AI Observability): real, queryable
  // model/token/cost columns -- before this, provider/model were only ever
  // stuffed into the free-form `output` jsonb (see api/ai/orchestrate's
  // logOrchestraExecution), not aggregatable. All nullable/additive; only
  // Wave 23's recordOrchestraExecution() populates them going forward.
  model: text('model'),
  provider: text('provider'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  costUsd: numeric('cost_usd'),
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
  // Wave 18 (VAIOS Shared AI Resource Pool, constitution refinement #10):
  // explicit, per-config opt-in required on the LENDING side -- this is
  // real money/API-key usage, even when it's only ever spent on the
  // platform's OWN internal orchestration work (never another org's
  // workflow -- see resolvePlatformModelConfig() in
  // orchestra-model-resolver.ts for the structural guarantee). Default
  // false: every pre-existing config opts out until an org explicitly
  // turns this on.
  sharedPoolEligible: boolean('shared_pool_eligible').notNull().default(false),
  lastUsedAt: timestamp('last_used_at'), // updated on every real resolution -- "idle" is computed from this, not a second stored flag
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Client-level (Layer 3) BYO model config (Wave 45) ───────────────────
// Mirrors customerModelConfig (Layer 2/org) exactly, one level down the
// tenant hierarchy -- a real, confirmed gap: Layers 1/2/4 (platform/org/
// user) all already had a model-resolution mechanism; Layer 3 (client, e.g.
// a CA/legal firm's individual end-client under an org) had none at all.
// Resolution chain (see resolveClientModelConfig() in
// orchestra-model-resolver.ts): a client-specific row wins, else the
// client's own org's customerModelConfig, else the platform default -- same
// "most-specific-scope-wins, fall back up the hierarchy" pattern
// resolvePageAgentModelConfig() already established for user->org->platform.
export const clientModelConfig = complianceSchemaDB.table('client_model_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  clientId: text('client_id').notNull(),
  orchestraLayerId: text('orchestra_layer_id'),
  provider: aiProviderEnum('provider').notNull(),
  encryptedApiKey: text('encrypted_api_key'),
  modelName: text('model_name'),
  isActive: boolean('is_active').notNull().default(true),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Platform-operational audit table, same posture as loop_executions (Wave
// 5) -- no app_runtime RLS policy at all, service_role bypass only. A
// lender org must never see WHO/WHAT else's capacity was borrowed via the
// normal tenant-scoped app path (that's Layer-1-only visibility); it CAN
// see its own lending history via a dedicated, deliberately narrow read
// (GET /api/settings/model-config/pool-usage), for the transparency this
// wave promises -- "your key was used for platform housekeeping."
export const sharedPoolAllocations = complianceSchemaDB.table('shared_pool_allocations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  lenderOrgId: text('lender_org_id').notNull(),
  purpose: text('purpose').notNull(), // e.g. 'meta_oa_loop_synthesis' -- what PLATFORM-internal work consumed it; never another org's id, there is no borrower org
  customerModelConfigId: text('customer_model_config_id').notNull(),
  orchestraLayerKey: text('orchestra_layer_key').notNull(),
  allocatedAt: timestamp('allocated_at').notNull().defaultNow(),
})

// ─── Module Registry + Product-Branch Enablement (Wave 20) ──────────────
// The catalog that makes "same module, customized rules per scope" real.
// Global-read tables (no org scoping), same posture as orchestra_layers --
// only service_role may write; catalog mutation is a migration-only,
// Layer-1 action, not something any org/route can do.
//
// domain is free text matching purpose-bound-ai.ts's DOMAIN_ALLOWED_TOOLS
// keys by convention, not a real FK -- there is no `domains` table yet
// (single-domain platform today, see purpose-bound-ai.ts's own honesty
// note); promoting this to a real foreign-keyed table is the natural next
// step once a second real domain (Sales/HR/SCM) actually exists.
export const moduleRegistry = complianceSchemaDB.table('module_registry', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  moduleKey: text('module_key').notNull().unique(), // matches the underlying table name 1:1 today; kept distinct from tableName since a future module's key and table COULD diverge (rename/versioning)
  displayName: text('display_name').notNull(),
  tableName: text('table_name').notNull(),
  domain: text('domain').notNull(),
  category: text('category'), // GOVERNANCE | COMPANY_SECRETARIAL | LEGAL | HR | RISK | SECTOR_REGULATORS | AUDIT | ESG | INTEGRITY | INCIDENTS -- mirrors this file's own section headers
  description: text('description'),
  isCore: boolean('is_core').notNull().default(false), // true only for the 4 pre-Wave-7 original tables (compliance_items/challans/notices/audit_points) -- can never be disabled for any product branch
  isActive: boolean('is_active').notNull().default(true), // platform kill-switch, distinct from per-branch enablement below
  // Wave 22 (Agent Skills / Awesome LLM Apps-inspired secondary taxonomy
  // axis): 'data_access' | 'calculation' | 'validation' | 'reporting' |
  // 'orchestration' -- describes HOW a module operates, orthogonal to
  // `domain` (WHICH business capability it belongs to), so the Worker
  // Agent Library / Module Registry can be filtered by both axes.
  toolType: text('tool_type'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Exactly one seeded row today: 'grc'. A platform-wide concept -- distinct
// from Wave 19's org-scoped products/projects (one customer's own internal
// projects, orgId NOT NULL). This is the future VERIDIAN Sales/HR/SCM
// branch concept from PLATFORM_STRATEGY.md §2 -- deliberately a separate
// table, not an overload of Wave 19's products, since a platform branch
// belongs to no single org and forcing it into an orgId-NOT-NULL table
// would need either a nullable orgId (breaking that table's existing RLS
// invariant) or a fake sentinel-org row (an anti-pattern this codebase has
// explicitly avoided elsewhere, see Wave 6's "first org in the DB" bug fix).
export const productBranches = complianceSchemaDB.table('product_branches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  branchKey: text('branch_key').notNull().unique(), // 'grc' today; 'sales' | 'hr' | 'scm' | ... in future Phase D branches
  displayName: text('display_name').notNull(),
  domain: text('domain').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const productBranchModules = complianceSchemaDB.table('product_branch_modules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productBranchId: text('product_branch_id').notNull(),
  moduleKey: text('module_key').notNull(), // FK-by-convention on module_registry.module_key (the stable natural key), not module_registry.id
  isEnabled: boolean('is_enabled').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Module Rules Configuration (Wave 21) ────────────────────────────────
// The generic "same module, customized rules" resolver table. One
// polymorphic scopeType/scopeId discriminator rather than 5 nullable FK
// columns -- at 6 resolution levels this scales better than
// customer_model_config's simpler 2-level nullable-column shape, and makes
// the resolver's per-level lookup mechanical/symmetric instead of a
// hand-written 5-branch if-chain. Real FK integrity is only enforced on
// module_key (always the same table); scope_id is validated at the service
// layer, the same trade-off approval_requests.entity_id/entity_type
// already makes in this codebase.
//
// Resolution chain (most-specific-first): user -> client -> project -> org
// -> productBranch -> platform. user scope is supported by the resolver for
// completeness but has no rule-setting API/UI yet and no seeded rule uses
// it -- most GRC rules are organizational, not personal; wiring real
// per-user overrides is deferred, not built blind.
export const moduleRuleConfigs = complianceSchemaDB.table('module_rule_configs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  moduleKey: text('module_key').notNull(), // FK-by-convention on module_registry.module_key
  ruleKey: text('rule_key').notNull(),
  ruleValue: jsonb('rule_value').notNull().default({}),
  scopeType: text('scope_type').notNull(), // 'platform' | 'product_branch' | 'org' | 'project' | 'client' | 'user'
  scopeId: text('scope_id'), // NULL only when scopeType='platform'
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'), // nullable -- platform-seeded default rows have no human author
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Prompt Operating System (Wave 22, Langfuse-inspired) ────────────────
// Before this, every LLM system prompt in the codebase was a hardcoded
// string literal scattered across chat-service.ts / task-execution-engine.ts
// / loop-engineering-audit.ts / instruction-mismatch-audit.ts / the
// orchestrate route -- no versioning, no way to review/change a prompt
// without a code deploy. Global-read platform catalog, same posture as
// orchestra_layers/module_registry: only service_role may write; prompt
// content is a platform-governed asset, not per-org customizable (that's
// what module_rule_configs is for -- business RULES, not AI prompt text).
export const promptTemplates = complianceSchemaDB.table('prompt_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  templateKey: text('template_key').notNull().unique(), // stable handle, e.g. 'chat.ai_thread_system', 'task_execution.planning_system'
  displayName: text('display_name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const promptVersions = complianceSchemaDB.table('prompt_versions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  promptTemplateId: text('prompt_template_id').notNull(),
  version: integer('version').notNull(),
  content: text('content').notNull(),
  label: text('label'), // 'production' | 'staging' | null -- only one version per template may hold a given label at a time, enforced at the service layer
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'), // nullable -- seeded v1 rows have no human author
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Personal Model Config (Wave 24, PageAgent integration) ──────────────
// The per-user counterpart to customer_model_config's per-org BYO --
// resolved BEFORE the org-level config in resolvePageAgentModelConfig()'s
// most-specific-scope-wins chain (personal -> org -> platform default),
// same philosophy as every other resolver in this codebase. `provider` is
// deliberately free text, NOT the ai_provider enum (groq/openai/anthropic/
// google) -- that enum doesn't cover 'ollama'/'custom' endpoints, which
// PageAgent's BYO story explicitly needs (local models, self-hosted
// OpenAI-compatible endpoints), and altering a shared enum used by
// customer_model_config/ai_configurations is riskier than a new free-text
// column here, matching module_rule_configs.scope_type's own precedent.
// One row per user (UNIQUE(user_id)) -- simpler than the per-orchestra-
// layer shape customer_model_config uses, since page-agent is the only
// consumer of this table today.
export const personalModelConfig = complianceSchemaDB.table('personal_model_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique(),
  provider: text('provider').notNull(), // free text: 'groq' | 'openai' | 'ollama' | 'custom' | ...
  baseUrl: text('base_url'), // required for 'ollama'/'custom'; null for known hosted providers
  modelName: text('model_name').notNull(),
  encryptedApiKey: text('encrypted_api_key'), // nullable -- a local Ollama endpoint needs no key
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

export const workerAgentsRelations = relations(workerAgents, ({ one, many }) => ({
  versions: many(workerAgentVersions),
  usageLog: many(workerAgentUsageLog),
  learnings: many(workerAgentLearnings),
  domainIndex: many(workerAgentDomainIndex),
  // Wave 16: "Digital Department" grouping -- self-referencing, needs
  // relationName to disambiguate the two directions on the same table.
  supervisor: one(workerAgents, { fields: [workerAgents.supervisorWorkerAgentId], references: [workerAgents.id], relationName: 'workerAgentSupervisor' }),
  subordinates: many(workerAgents, { relationName: 'workerAgentSupervisor' }),
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

export const customerModelConfigRelations = relations(customerModelConfig, ({ one, many }) => ({
  layer: one(orchestraLayers, { fields: [customerModelConfig.orchestraLayerId], references: [orchestraLayers.id] }),
  poolAllocations: many(sharedPoolAllocations),
}))

export const clientModelConfigRelations = relations(clientModelConfig, ({ one }) => ({
  client: one(clients, { fields: [clientModelConfig.clientId], references: [clients.id] }),
  layer: one(orchestraLayers, { fields: [clientModelConfig.orchestraLayerId], references: [orchestraLayers.id] }),
}))

export const sharedPoolAllocationsRelations = relations(sharedPoolAllocations, ({ one }) => ({
  config: one(customerModelConfig, { fields: [sharedPoolAllocations.customerModelConfigId], references: [customerModelConfig.id] }),
}))

export const moduleRegistryRelations = relations(moduleRegistry, ({ many }) => ({
  branchEnablements: many(productBranchModules),
  ruleConfigs: many(moduleRuleConfigs),
}))

export const productBranchesRelations = relations(productBranches, ({ many }) => ({
  moduleEnablements: many(productBranchModules),
}))

export const productBranchModulesRelations = relations(productBranchModules, ({ one }) => ({
  productBranch: one(productBranches, { fields: [productBranchModules.productBranchId], references: [productBranches.id] }),
  module: one(moduleRegistry, { fields: [productBranchModules.moduleKey], references: [moduleRegistry.moduleKey] }),
}))

export const moduleRuleConfigsRelations = relations(moduleRuleConfigs, ({ one }) => ({
  module: one(moduleRegistry, { fields: [moduleRuleConfigs.moduleKey], references: [moduleRegistry.moduleKey] }),
}))

export const promptTemplatesRelations = relations(promptTemplates, ({ many }) => ({
  versions: many(promptVersions),
}))

export const promptVersionsRelations = relations(promptVersions, ({ one }) => ({
  template: one(promptTemplates, { fields: [promptVersions.promptTemplateId], references: [promptTemplates.id] }),
}))

export const personalModelConfigRelations = relations(personalModelConfig, ({ one }) => ({
  user: one(users, { fields: [personalModelConfig.userId], references: [users.id] }),
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

// ─── Chat + Instruction Tracking (Wave 12) ───────────────────────────────
// One `messages` table serves both human threads and each user's private
// VERIDIAN AI thread (via `conversations.isAiThread`), rather than a fourth
// parallel messaging table -- `comments` (entity-attached notes) and
// `taskChatMessages` (task-scoped AI chat) already exist for their own
// distinct purposes and aren't reused here. A user's AI thread is strictly
// private, matching the `aiAssistants` precedent (RLS below never lets an
// org admin read someone else's conversation, AI thread or not).
//
// Self-referential RLS on conversation membership (conversation_participants
// checking conversation_participants) is a known Postgres RLS footgun --
// naively repeating the same USING clause on the same table can force the
// planner to keep re-applying the policy to the subquery's own scan of that
// table. The safe, standard fix (same one Supabase's own docs recommend for
// this exact "group chat membership" shape) is a SECURITY DEFINER helper
// function that queries the table directly, bypassing its own RLS for that
// one internal check -- see `compliance.is_conversation_participant()` in
// the migration. `conversations`/`messages`/`conversation_participants` all
// key off that single function so membership logic can't drift across them.
export const conversations = complianceSchemaDB.table('conversations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  type: text('type').notNull().default('direct'), // 'direct' | 'group' | 'ai'
  isAiThread: boolean('is_ai_thread').notNull().default(false),
  title: text('title'),
  // Wave 32 (VERI Chat): what this conversation is "about" -- a policy, a
  // pms_issue, a project, a veri_meeting, etc. Nullable: most existing
  // conversations (Wave 12-13) have no context and stay that way.
  contextEntityType: text('context_entity_type'),
  contextEntityId: text('context_entity_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const conversationParticipants = complianceSchemaDB.table('conversation_participants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').notNull(),
  userId: text('user_id').notNull(),
  lastReadAt: timestamp('last_read_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const messages = complianceSchemaDB.table('messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').notNull(),
  senderId: text('sender_id'), // null == VERIDIAN AI, matches ai_assistants/task_chat_messages' existing "no human sender" convention
  content: text('content').notNull(),
  isInstruction: boolean('is_instruction').notNull().default(false), // denormalized for cheap list rendering (Wave 13's status chip); the actual commitment record lives in instruction_commitments
  // Wave 32 (VERI Chat): which of the 5 Orchestra assistants answered, when
  // senderId is null (AI). Nullable -- pre-existing AI messages have no
  // per-message attribution and stay that way.
  assistantId: text('assistant_id'),
  // Wave 32: where this message came from, when imported via the Web Share
  // Target (see conversation_share_links) or a pasted Slack permalink.
  // Null for every normal in-app message. Slack's actual permalink->content
  // API resolution is explicitly deferred (needs a Slack App the user must
  // register) -- sourceRef just stores the pasted reference text until then.
  sourcePlatform: text('source_platform'), // 'whatsapp' | 'telegram' | 'slack' | null
  sourceRef: text('source_ref'),
  // Wave 36: set when this message was authored by an external guest (via
  // conversation_guest_access), not an internal user or the AI. senderId
  // stays null in that case too -- guestAccessId is what distinguishes
  // "the AI replied" from "the external guest replied", so the existing
  // senderId-null-means-AI convention is never overloaded or broken.
  guestAccessId: text('guest_access_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One row per instruction: assignee is explicit at send time (a `PATCH
// /api/conversations/[id]/messages` body with `isInstruction: true` and an
// explicit `assigneeId`), never NLP-inferred, so a commitment always has an
// unambiguous owner. `status` is deliberately plain text (not a pg enum),
// matching this codebase's post-Wave-4 convention (see `tasks.status`) of
// avoiding ALTER TYPE friction for values still likely to grow.
export const instructionCommitments = complianceSchemaDB.table('instruction_commitments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  messageId: text('message_id').notNull().unique(), // one message -> at most one commitment
  assignerId: text('assigner_id').notNull(),
  assigneeId: text('assignee_id').notNull(),
  describedAction: text('described_action').notNull(),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('pending'), // 'pending' | 'done_as_asked' | 'drifted' | 'resolved'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Surfaced ONLY to the person who gave the instruction (the assigner) -- a
// real DB-level RLS rule (see migration), not just a UI-level filter, since
// this is exactly the kind of "AI silently judged whether you did what I
// asked" data that must never leak to the assignee or a third party.
export const instructionMismatchDetections = complianceSchemaDB.table('instruction_mismatch_detections', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  commitmentId: text('commitment_id').notNull(),
  detectedAt: timestamp('detected_at').notNull().defaultNow(),
  comparisonSummary: text('comparison_summary').notNull(),
  relatedTaskId: text('related_task_id'),
  resolution: text('resolution').notNull().default('unresolved'), // 'unresolved' | 'nudged' | 'confirmed_fine'
  resolvedAt: timestamp('resolved_at'),
  resolvedByUserId: text('resolved_by_user_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const conversationsRelations = relations(conversations, ({ many }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
}))
export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationParticipants.conversationId], references: [conversations.id] }),
  user: one(users, { fields: [conversationParticipants.userId], references: [users.id] }),
}))
export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, { fields: [messages.conversationId], references: [conversations.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
  assistant: one(aiAssistants, { fields: [messages.assistantId], references: [aiAssistants.id] }),
  guestAccess: one(conversationGuestAccess, { fields: [messages.guestAccessId], references: [conversationGuestAccess.id] }),
}))
export const instructionCommitmentsRelations = relations(instructionCommitments, ({ one }) => ({
  message: one(messages, { fields: [instructionCommitments.messageId], references: [messages.id] }),
  assigner: one(users, { fields: [instructionCommitments.assignerId], references: [users.id], relationName: 'instructionAssigner' }),
  assignee: one(users, { fields: [instructionCommitments.assigneeId], references: [users.id], relationName: 'instructionAssignee' }),
}))
export const instructionMismatchDetectionsRelations = relations(instructionMismatchDetections, ({ one }) => ({
  commitment: one(instructionCommitments, { fields: [instructionMismatchDetections.commitmentId], references: [instructionCommitments.id] }),
  relatedTask: one(tasks, { fields: [instructionMismatchDetections.relatedTaskId], references: [tasks.id] }),
}))

// ─── Code-Change-Request workflow (Wave 19) ──────────────────────────────
// Reuses the generic approvalRequests maker-checker (requestType=
// 'code_change_request') exactly as Wave 8's Policy-publish and Wave 16's
// worker_agent_proposal flows already do -- entityId points at this
// satellite table's row rather than a pre-existing entity, since a
// code-change request has nothing pre-existing to point at.
//
// IMPORTANT (stated here and enforced in code, not just documented):
// approving a code_change_request does NOT cause any code to change.
// Implementation/Testing/Deployment remain a human directing a coding
// session outside the running app -- this table is an intake + audit
// trail, not an automated pipeline.
export const codeChangeRequests = complianceSchemaDB.table('code_change_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  approvalRequestId: text('approval_request_id').notNull(),
  originatingLayer: text('originating_layer').notNull(), // 'personal' | 'enterprise' | 'product' -- a human-selected label, not evidence of an autonomous layer (see PLATFORM_STRATEGY.md §11)
  requestedChange: text('requested_change').notNull(),
  justification: text('justification'),
  status: text('status').notNull().default('pending'), // mirrors approval_requests.status, denormalized for query convenience
  implementedAt: timestamp('implemented_at'),
  implementationNote: text('implementation_note'),
  orgId: text('org_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Product/Project scope layer (Wave 19, VAIOS constitution L2) ────────
// The missing "Layer 2 Product/Project" scope analog -- distinct from
// clients/clientEntities (a CA firm's own client companies). A scope/data
// layer only, NOT an AI actor -- see PLATFORM_STRATEGY.md §11's honesty
// section for exactly what this does and doesn't establish.
export const products = complianceSchemaDB.table('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const projects = complianceSchemaDB.table('projects', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull(),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // optional: a project can sit under one of the org's existing clients
  name: text('name').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  // Wave 25 (VERIDIAN AI PMS): additive PM columns -- reused by any org that
  // enables the 'pms' product branch, rather than a parallel project table.
  // Every pre-existing GRC-only project simply leaves these null/default --
  // no PM behavior is implied until an org actually uses this project for
  // PMS work.
  issuePrefix: text('issue_prefix'), // e.g. "ENG" for issue numbers like ENG-123
  issueSequence: integer('issue_sequence').notNull().default(0), // atomically incremented per issue created
  leadUserId: text('lead_user_id'),
  startDate: date('start_date', { mode: 'string' }),
  targetDate: date('target_date', { mode: 'string' }),
  healthStatus: text('health_status'), // 'on_track' | 'at_risk' | 'off_track' | null -- free text, not enum, since only PMS-using projects ever set it
  parentProjectId: text('parent_project_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const codeChangeRequestsRelations = relations(codeChangeRequests, ({ one }) => ({
  approvalRequest: one(approvalRequests, { fields: [codeChangeRequests.approvalRequestId], references: [approvalRequests.id] }),
}))

export const productsRelations = relations(products, ({ many }) => ({
  projects: many(projects),
}))

export const projectsRelations = relations(projects, ({ one }) => ({
  product: one(products, { fields: [projects.productId], references: [products.id] }),
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
}))

// ─── VERIDIAN AI PMS (Wave 25) ────────────────────────────────────────────
// A brand-new, opt-in product branch (see product_branches seed row,
// branchKey='pms') -- VERIDIAN's first genuine second productBranches row
// since 'grc' (Wave 20), validating that architecture's own stated design
// goal. Adapted from studying Huly/OpenProject/Plane (never their code,
// never their AI -- see PLATFORM_STRATEGY.md §14 for the full research and
// every design decision below). Reuses this file's existing conventions
// throughout: text PK via createId(), orgId-scoped RLS, Drizzle relations.

export const pmsIssuePriorityEnum = complianceSchemaDB.enum('pms_issue_priority', ['no_priority', 'urgent', 'high', 'medium', 'low'])
// 'triage' absorbs Plane's intake-queue concept -- no separate table needed.
export const pmsStatusGroupEnum = complianceSchemaDB.enum('pms_status_group', ['backlog', 'unstarted', 'started', 'completed', 'cancelled', 'triage'])
export const pmsIssueRelationTypeEnum = complianceSchemaDB.enum('pms_issue_relation_type', ['blocks', 'blocked_by', 'duplicates', 'relates_to'])
export const pmsMilestoneStatusEnum = complianceSchemaDB.enum('pms_milestone_status', ['planned', 'in_progress', 'completed', 'cancelled'])
export const pmsSprintStatusEnum = complianceSchemaDB.enum('pms_sprint_status', ['planned', 'active', 'completed', 'cancelled'])
export const pmsViewAccessEnum = complianceSchemaDB.enum('pms_view_access', ['private', 'shared'])
export const pmsBudgetLineKindEnum = complianceSchemaDB.enum('pms_budget_line_kind', ['labor', 'material'])

// Which orgs have adopted which product branch -- productBranches/
// productBranchModules (Wave 20) are pure global catalog with no org
// dimension at all; this is the missing "org adoption" table, resolved
// during this wave's design pass rather than bending moduleRuleConfigs
// (Wave 21, shaped for one resolved JSON value per rule) or copying
// organisations.pageAgentEnabled (Wave 24, a bespoke boolean that doesn't
// generalize to a 3rd/4th future branch) into service for something it
// wasn't built for. Explicit row-per-org-branch-pair (not "row absence =
// disabled") so the audit trail survives a disable-then-reenable cycle.
export const orgProductBranchEnablements = complianceSchemaDB.table('org_product_branch_enablements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  productBranchId: text('product_branch_id').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(false),
  enabledAt: timestamp('enabled_at'),
  enabledById: text('enabled_by_id'),
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Org-wide taxonomy (Task/Bug/Epic/Story) -- isEpic is a flag, not a
// separate model, matching Plane's is_epic pattern (confirmed the cleanest
// of the 3 studied tools' approaches). Copy-on-enable: enablePmsForOrg()
// seeds real, org-owned default rows here rather than resolving from a
// platform catalog -- every studied tool treats these as per-workspace
// custom master data, never platform-defaults-with-override.
export const pmsIssueTypes = complianceSchemaDB.table('pms_issue_types', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  isEpic: boolean('is_epic').notNull().default(false),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Per-PROJECT customizable (unlike issue types, which are org-wide) --
// matches Plane's State model exactly: every custom status still maps to
// one of the 6 semantic groups above for cross-project reporting/board
// columns.
export const pmsIssueStatuses = complianceSchemaDB.table('pms_issue_statuses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  group: pmsStatusGroupEnum('group').notNull(),
  color: text('color'),
  position: integer('position').notNull().default(0),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Optional per-type/per-role transition constraint (OpenProject's unique
// contribution) -- absence of a row for a given (type, from, to) pair means
// the transition is unconstrained. `role` reuses the existing userRoleEnum
// rather than a FK to a `roles` table, since no such table exists in this
// schema (confirmed during design) and none is being introduced here.
// NOTE: each row's fromStatusId/toStatusId are themselves project-scoped
// (pmsIssueStatuses.projectId), so an "org-level" transition row is only
// ever meaningfully applicable within whichever single project those two
// status ids belong to -- a real, self-consistent constraint via the FK
// targets, not a portable cross-project rule (flagged during design, kept
// as-is since it works correctly, just worth understanding).
export const pmsWorkflowTransitions = complianceSchemaDB.table('pms_workflow_transitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  issueTypeId: text('issue_type_id').notNull(),
  role: userRoleEnum('role'),
  fromStatusId: text('from_status_id').notNull(),
  toStatusId: text('to_status_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsIssues = complianceSchemaDB.table('pms_issues', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // nullable -- only meaningful for CA-firm/consultant org types managing client-facing PM work
  projectId: text('project_id').notNull(),
  typeId: text('type_id').notNull(),
  statusId: text('status_id').notNull(),
  priority: pmsIssuePriorityEnum('priority').notNull().default('no_priority'),
  number: integer('number').notNull(), // per-project auto-sequence, paired with projects.issueSequence/issuePrefix
  title: text('title').notNull(),
  description: text('description'), // plain text/markdown -- no CRDT/collaborative editing this pass
  // Denormalized "primary assignee" cache, kept in sync by the service
  // layer on every pmsIssueAssignees mutation (not a DB trigger, matching
  // this codebase's convention everywhere else) -- pmsIssueAssignees is
  // the authoritative multi-assignee source.
  assigneeId: text('assignee_id'),
  parentIssueId: text('parent_issue_id'), // self-FK -- sub-issues
  milestoneId: text('milestone_id'),
  estimatePointId: text('estimate_point_id'),
  startDate: date('start_date', { mode: 'string' }),
  dueDate: date('due_date', { mode: 'string' }),
  position: numeric('position').notNull().default('0'), // manual Kanban ordering (lexicographic rank)
  isArchived: boolean('is_archived').notNull().default(false),
  createdById: text('created_by_id'),
  assignedById: text('assigned_by_id'), // mirrors tasks.assignedById's Wave-15 "assigned to me vs by me" convention
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const pmsIssueAssignees = complianceSchemaDB.table('pms_issue_assignees', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  issueId: text('issue_id').notNull(),
  userId: text('user_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Typed relations, kept separate from the parent/child hierarchy above --
// matches Plane's IssueRelation design.
export const pmsIssueRelations = complianceSchemaDB.table('pms_issue_relations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  issueId: text('issue_id').notNull(),
  relatedIssueId: text('related_issue_id').notNull(),
  relationType: pmsIssueRelationTypeEnum('relation_type').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsLabels = complianceSchemaDB.table('pms_labels', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  color: text('color'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsIssueLabels = complianceSchemaDB.table('pms_issue_labels', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  issueId: text('issue_id').notNull(),
  labelId: text('label_id').notNull(),
})

// Fully custom per-project estimate values (Plane's design) rather than a
// hardcoded Fibonacci enum.
export const pmsEstimateSchemes = complianceSchemaDB.table('pms_estimate_schemes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsEstimatePoints = complianceSchemaDB.table('pms_estimate_points', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  schemeId: text('scheme_id').notNull(),
  value: text('value').notNull(), // text, not numeric -- schemes can use non-numeric labels (XS/S/M/L/XL) as well as points
  position: integer('position').notNull().default(0),
})

// Huly's lightweight, non-issue container -- a milestone is a date-boxed
// release marker issues optionally link to, not a heavyweight issue type.
export const pmsMilestones = complianceSchemaDB.table('pms_milestones', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: pmsMilestoneStatusEnum('status').notNull().default('planned'),
  targetDate: date('target_date', { mode: 'string' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Sprints -- named "Sprints" (universal Scrum terminology) rather than
// Plane's "Cycles" or OpenProject's "Sprint" (same word, kept). Join table
// (not a raw FK on pmsIssues) mirrors Plane's CycleIssue design, allowing
// an issue's sprint assignment to be moved/reassigned over time.
export const pmsSprints = complianceSchemaDB.table('pms_sprints', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  goal: text('goal'),
  startDate: date('start_date', { mode: 'string' }),
  endDate: date('end_date', { mode: 'string' }),
  status: pmsSprintStatusEnum('status').notNull().default('planned'),
  progressSnapshot: jsonb('progress_snapshot'), // burndown data, written once at sprint close -- never live-computed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const pmsSprintIssues = complianceSchemaDB.table('pms_sprint_issues', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sprintId: text('sprint_id').notNull(),
  issueId: text('issue_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Saved filter/sort/display configs -- projectId nullable means
// workspace-level (spans all of an org's PMS projects). access='private'
// rows are enforced by a real RLS branch (see migration), not just a
// service-layer filter, mirroring moduleRuleConfigs' own scope_type='user'
// policy precedent.
export const pmsSavedViews = complianceSchemaDB.table('pms_saved_views', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id'),
  ownedById: text('owned_by_id').notNull(),
  name: text('name').notNull(),
  filters: jsonb('filters').notNull().default({}),
  displayFilters: jsonb('display_filters').notNull().default({}),
  access: pmsViewAccessEnum('access').notNull().default('private'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Genuinely new, general-purpose wiki -- kept deliberately SEPARATE from
// the existing `documents` table, which is compliance-coupled
// (complianceItemId/noticeId FKs) and the wrong shape for this. Plain
// text/markdown content, no CRDT/collaborative editing (explicit
// out-of-scope per PLATFORM_STRATEGY.md §14).
export const pmsWikiPages = complianceSchemaDB.table('pms_wiki_pages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  parentPageId: text('parent_page_id'), // self-FK -- page tree
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  version: integer('version').notNull().default(1),
  updatedById: text('updated_by_id'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Time tracking + billable rates (OpenProject's unique contribution among
// the 3 studied tools). isRunning/startedAt support a live timer, matching
// OpenProject's TimeEntry.ongoing? concept.
export const pmsTimeEntries = complianceSchemaDB.table('pms_time_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  issueId: text('issue_id').notNull(),
  userId: text('user_id').notNull(),
  hours: numeric('hours').notNull(),
  spentOn: date('spent_on', { mode: 'string' }).notNull(),
  activityType: text('activity_type'), // free text -- admin-configurable, not a fixed enum
  comments: text('comments'),
  isRunning: boolean('is_running').notNull().default(false),
  startedAt: timestamp('started_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsBillableRates = complianceSchemaDB.table('pms_billable_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id'), // nullable -- null means "org default rate"
  hourlyRate: numeric('hourly_rate').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Project budgeting (OpenProject's unique contribution) -- actuals are
// computed by summing linked pmsTimeEntries x pmsBillableRates at read
// time in the service layer, never a duplicated/stored ledger.
export const pmsBudgets = complianceSchemaDB.table('pms_budgets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  fixedDate: date('fixed_date', { mode: 'string' }),
  authorId: text('author_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsBudgetLineItems = complianceSchemaDB.table('pms_budget_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  budgetId: text('budget_id').notNull(),
  kind: pmsBudgetLineKindEnum('kind').notNull(),
  userId: text('user_id'), // nullable -- only meaningful for kind='labor'
  description: text('description'),
  amount: numeric('amount').notNull(),
  hours: numeric('hours'), // nullable -- only meaningful for kind='labor'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Meeting management (OpenProject's unique contribution) -- project-scoped
// meetings with structured agenda items and outcomes/minutes.
export const pmsMeetings = complianceSchemaDB.table('pms_meetings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  title: text('title').notNull(),
  scheduledAt: timestamp('scheduled_at').notNull(),
  durationMinutes: integer('duration_minutes'),
  recurrenceRule: text('recurrence_rule'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsMeetingAgendaItems = complianceSchemaDB.table('pms_meeting_agenda_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  meetingId: text('meeting_id').notNull(),
  position: integer('position').notNull().default(0),
  title: text('title').notNull(),
  issueId: text('issue_id'),
  durationMinutes: integer('duration_minutes'),
})

export const pmsMeetingOutcomes = complianceSchemaDB.table('pms_meeting_outcomes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  meetingId: text('meeting_id').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsMeetingParticipants = complianceSchemaDB.table('pms_meeting_participants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  meetingId: text('meeting_id').notNull(),
  userId: text('user_id').notNull(),
  responseStatus: text('response_status'), // free text: 'pending' | 'accepted' | 'declined' | 'tentative'
})

// ─── PMS Relations ────────────────────────────────────────────────────────
export const orgProductBranchEnablementsRelations = relations(orgProductBranchEnablements, ({ one }) => ({
  productBranch: one(productBranches, { fields: [orgProductBranchEnablements.productBranchId], references: [productBranches.id] }),
}))

export const pmsIssueTypesRelations = relations(pmsIssueTypes, ({ many }) => ({
  issues: many(pmsIssues),
  workflowTransitions: many(pmsWorkflowTransitions),
}))

export const pmsIssueStatusesRelations = relations(pmsIssueStatuses, ({ one, many }) => ({
  project: one(projects, { fields: [pmsIssueStatuses.projectId], references: [projects.id] }),
  issues: many(pmsIssues),
}))

export const pmsWorkflowTransitionsRelations = relations(pmsWorkflowTransitions, ({ one }) => ({
  issueType: one(pmsIssueTypes, { fields: [pmsWorkflowTransitions.issueTypeId], references: [pmsIssueTypes.id] }),
  fromStatus: one(pmsIssueStatuses, { fields: [pmsWorkflowTransitions.fromStatusId], references: [pmsIssueStatuses.id] }),
  toStatus: one(pmsIssueStatuses, { fields: [pmsWorkflowTransitions.toStatusId], references: [pmsIssueStatuses.id] }),
}))

export const pmsIssuesRelations = relations(pmsIssues, ({ one, many }) => ({
  project: one(projects, { fields: [pmsIssues.projectId], references: [projects.id] }),
  type: one(pmsIssueTypes, { fields: [pmsIssues.typeId], references: [pmsIssueTypes.id] }),
  status: one(pmsIssueStatuses, { fields: [pmsIssues.statusId], references: [pmsIssueStatuses.id] }),
  milestone: one(pmsMilestones, { fields: [pmsIssues.milestoneId], references: [pmsMilestones.id] }),
  parentIssue: one(pmsIssues, { fields: [pmsIssues.parentIssueId], references: [pmsIssues.id] }),
  assignees: many(pmsIssueAssignees),
  labels: many(pmsIssueLabels),
  relations: many(pmsIssueRelations),
  sprintIssues: many(pmsSprintIssues),
  timeEntries: many(pmsTimeEntries),
}))

export const pmsIssueAssigneesRelations = relations(pmsIssueAssignees, ({ one }) => ({
  issue: one(pmsIssues, { fields: [pmsIssueAssignees.issueId], references: [pmsIssues.id] }),
}))

export const pmsIssueRelationsRelations = relations(pmsIssueRelations, ({ one }) => ({
  issue: one(pmsIssues, { fields: [pmsIssueRelations.issueId], references: [pmsIssues.id] }),
}))

export const pmsLabelsRelations = relations(pmsLabels, ({ many }) => ({
  issueLabels: many(pmsIssueLabels),
}))

export const pmsIssueLabelsRelations = relations(pmsIssueLabels, ({ one }) => ({
  issue: one(pmsIssues, { fields: [pmsIssueLabels.issueId], references: [pmsIssues.id] }),
  label: one(pmsLabels, { fields: [pmsIssueLabels.labelId], references: [pmsLabels.id] }),
}))

export const pmsEstimateSchemesRelations = relations(pmsEstimateSchemes, ({ many }) => ({
  points: many(pmsEstimatePoints),
}))

export const pmsEstimatePointsRelations = relations(pmsEstimatePoints, ({ one }) => ({
  scheme: one(pmsEstimateSchemes, { fields: [pmsEstimatePoints.schemeId], references: [pmsEstimateSchemes.id] }),
}))

export const pmsMilestonesRelations = relations(pmsMilestones, ({ one, many }) => ({
  project: one(projects, { fields: [pmsMilestones.projectId], references: [projects.id] }),
  issues: many(pmsIssues),
}))

export const pmsSprintsRelations = relations(pmsSprints, ({ one, many }) => ({
  project: one(projects, { fields: [pmsSprints.projectId], references: [projects.id] }),
  sprintIssues: many(pmsSprintIssues),
}))

export const pmsSprintIssuesRelations = relations(pmsSprintIssues, ({ one }) => ({
  sprint: one(pmsSprints, { fields: [pmsSprintIssues.sprintId], references: [pmsSprints.id] }),
  issue: one(pmsIssues, { fields: [pmsSprintIssues.issueId], references: [pmsIssues.id] }),
}))

export const pmsSavedViewsRelations = relations(pmsSavedViews, ({ one }) => ({
  project: one(projects, { fields: [pmsSavedViews.projectId], references: [projects.id] }),
}))

export const pmsWikiPagesRelations = relations(pmsWikiPages, ({ one, many }) => ({
  project: one(projects, { fields: [pmsWikiPages.projectId], references: [projects.id] }),
  parentPage: one(pmsWikiPages, { fields: [pmsWikiPages.parentPageId], references: [pmsWikiPages.id] }),
}))

export const pmsTimeEntriesRelations = relations(pmsTimeEntries, ({ one }) => ({
  issue: one(pmsIssues, { fields: [pmsTimeEntries.issueId], references: [pmsIssues.id] }),
}))

export const pmsBudgetsRelations = relations(pmsBudgets, ({ one, many }) => ({
  project: one(projects, { fields: [pmsBudgets.projectId], references: [projects.id] }),
  lineItems: many(pmsBudgetLineItems),
}))

export const pmsBudgetLineItemsRelations = relations(pmsBudgetLineItems, ({ one }) => ({
  budget: one(pmsBudgets, { fields: [pmsBudgetLineItems.budgetId], references: [pmsBudgets.id] }),
}))

export const pmsMeetingsRelations = relations(pmsMeetings, ({ one, many }) => ({
  project: one(projects, { fields: [pmsMeetings.projectId], references: [projects.id] }),
  agendaItems: many(pmsMeetingAgendaItems),
  outcomes: many(pmsMeetingOutcomes),
  participants: many(pmsMeetingParticipants),
}))

export const pmsMeetingAgendaItemsRelations = relations(pmsMeetingAgendaItems, ({ one }) => ({
  meeting: one(pmsMeetings, { fields: [pmsMeetingAgendaItems.meetingId], references: [pmsMeetings.id] }),
  issue: one(pmsIssues, { fields: [pmsMeetingAgendaItems.issueId], references: [pmsIssues.id] }),
}))

export const pmsMeetingOutcomesRelations = relations(pmsMeetingOutcomes, ({ one }) => ({
  meeting: one(pmsMeetings, { fields: [pmsMeetingOutcomes.meetingId], references: [pmsMeetings.id] }),
}))

export const pmsMeetingParticipantsRelations = relations(pmsMeetingParticipants, ({ one }) => ({
  meeting: one(pmsMeetings, { fields: [pmsMeetingParticipants.meetingId], references: [pmsMeetings.id] }),
}))

// ─── Knowledge Base (Wave 29, AppFlowy-inspired page-hierarchy pattern) ──
// Deliberately NOT a reuse of pms_wiki_pages -- that table's projectId is
// NOT NULL and every route is requirePmsEnabled()-gated, making it
// structurally PMS-only despite §14.2's original "reusable outside PMS
// too" intent. This table is org-wide, core (always available, no
// enablement toggle), and independent of any product branch. Plain
// markdown content, no CRDT/blocks/database-grid-views -- same v1 scope
// line already drawn for pms_wiki_pages, kept consistent here.
export const knowledgeBasePages = complianceSchemaDB.table('knowledge_base_pages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  parentPageId: text('parent_page_id'), // self-FK -- page tree
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  content: text('content'),
  version: integer('version').notNull().default(1),
  updatedById: text('updated_by_id'),
  isArchived: boolean('is_archived').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const knowledgeBasePagesRelations = relations(knowledgeBasePages, ({ one }) => ({
  parentPage: one(knowledgeBasePages, { fields: [knowledgeBasePages.parentPageId], references: [knowledgeBasePages.id] }),
}))

// ─── Automation Rules (Wave 30, n8n-inspired trigger→condition→action) ──
// Deliberately much smaller than n8n itself: single-condition rules, no
// node-graph, no chained multi-step workflows, no AI/code-execution action
// type. triggerType/actionType are free text (matches this codebase's
// post-Wave-4 convention for values still likely to grow, e.g.
// tasks.status), not a pg enum. triggerConditions is a simple {field,
// operator, value} jsonb match, not an expression language.
export const automationRules = complianceSchemaDB.table('automation_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: text('trigger_type').notNull(), // e.g. 'notice.status_changed' | 'pms_issue.status_changed' | 'compliance_item.overdue'
  triggerConditions: jsonb('trigger_conditions').notNull().default({}), // { field, operator: 'equals', value }
  actionType: text('action_type').notNull(), // 'notify_user' | 'create_task' -- both entity-agnostic (independent of triggerType's source entity), so no per-entity mutation logic is needed in the evaluator
  actionConfig: jsonb('action_config').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Run log -- mirrors orchestra_executions/worker_agent_usage_log's existing
// "log every automated action" convention rather than inventing a new one.
export const automationRuleRuns = complianceSchemaDB.table('automation_rule_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  ruleId: text('rule_id').notNull(),
  triggeredAt: timestamp('triggered_at').notNull().defaultNow(),
  triggerPayload: jsonb('trigger_payload').notNull().default({}),
  status: text('status').notNull(), // 'success' | 'failed'
  resultSummary: text('result_summary'),
  errorMessage: text('error_message'),
})

export const automationRulesRelations = relations(automationRules, ({ many }) => ({
  runs: many(automationRuleRuns),
}))

export const automationRuleRunsRelations = relations(automationRuleRuns, ({ one }) => ({
  rule: one(automationRules, { fields: [automationRuleRuns.ruleId], references: [automationRules.id] }),
}))

// ─── Custom Reports (Wave 31, Metabase/Superset-inspired saved queries) ──
// runReport() (service layer) executes a whitelisted Drizzle query per
// sourceEntity -- never raw SQL. That is the explicit security boundary
// vs. Metabase/Superset's SQL editors, which this pass deliberately does
// not adopt. private/shared visibility reuses pms_saved_views' own
// scope_type='user'-equivalent RLS-branch precedent verbatim.
export const savedReports = complianceSchemaDB.table('saved_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  ownedById: text('owned_by_id').notNull(),
  sourceEntity: text('source_entity').notNull(), // 'compliance_items' | 'notices' | 'risks' | 'pms_issues' | 'incidents'
  filters: jsonb('filters').notNull().default({}),
  groupByField: text('group_by_field'),
  chartType: text('chart_type').notNull().default('table'), // 'table' | 'bar' | 'pie' | 'line'
  visibility: text('visibility').notNull().default('private'), // 'private' | 'shared'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Metric Alert Rules (Wave 38, Grafana-inspired scheduled threshold
// alerting, PLATFORM_STRATEGY.md §22) ─────────────────────────────────────
// Reuses the exact same sourceEntity/filterField whitelist custom-report-
// service.ts already validates against (see metric-alert-service.ts) --
// never a new arbitrary-query surface. Evaluated by a Vercel Cron route,
// not a live-streaming engine like Grafana itself -- see §22.3 for why that
// distinction was deliberate. Also the mechanism Ticketing (Wave 39, §21)
// reuses for SLA-deadline breach detection, one scheduled-evaluation
// mechanism serving two consumers rather than a second cron job.
export const metricAlertRules = complianceSchemaDB.table('metric_alert_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  sourceEntity: text('source_entity').notNull(), // 'compliance_items' | 'notices' | 'risks' | 'pms_issues' | 'incidents'
  filterField: text('filter_field'), // e.g. 'status' -- validated against the same whitelist as savedReports.groupByField
  filterValue: text('filter_value'), // e.g. 'overdue'
  operator: text('operator').notNull().default('gt'), // 'gt' | 'gte' | 'lt' | 'lte' | 'eq'
  threshold: integer('threshold').notNull(),
  notifyUserIds: jsonb('notify_user_ids').notNull().default([]), // string[]
  isActive: boolean('is_active').notNull().default(true),
  lastTriggeredAt: timestamp('last_triggered_at'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── VERI FDE -- Forward Deployed AI (Wave 42, PLATFORM_STRATEGY.md §23) ──
// Adds NO new creation power over what proposeWorkerAgent() (Wave 16)
// already allows -- this is a natural-language front-end to that existing
// role-gated, human-approval-gated pipeline, not a bypass of it. Closes
// the exact gap §11 already named twice: "if none exists, the governing
// layer may create a new Worker Agent Proposal" (refinement #4) and "an
// actual autonomous L2/L3 AI actor... natural next step... not yet
// scoped or started" (the Wave 19 status note).
export const fdeRequests = complianceSchemaDB.table('fde_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  requestText: text('request_text').notNull(),
  status: text('status').notNull().default('matched_existing'), // 'matched_existing' | 'proposed_agent' | 'error'
  matchedWorkerAgentId: text('matched_worker_agent_id'),
  matchedLabel: text('matched_label'), // free text -- e.g. a matched module/automation-rule name, when the match isn't a worker agent row
  createdWorkerAgentId: text('created_worker_agent_id'), // set when a new proposal was drafted
  responseText: text('response_text').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── VERIDIAN CRM (Wave 41, PLATFORM_STRATEGY.md §20) ────────────────────
// Twenty (already rejected in §17.7) and SuiteCRM (AGPL-3.0 PHP monolith)
// evaluated and rejected as software -- a generic CRM (campaigns, quotes,
// email marketing) has no product tie-in for VERIDIAN anyway. Deliberately
// narrow: completes the existing Wave-1 Clients feature with the one thing
// it was missing -- how a CA firm/legal firm/consultant actually gets a
// new client, not just manages an existing one. Gated identically to the
// existing Clients page (accountType !== 'company'). Activity tracking is
// NOT duplicated here -- a lead/opportunity's call/meeting history reuses
// the already-existing polymorphic contextEntityType/contextEntityId on
// `conversations` (VERI Chat, Wave 32) and `veriMeetings` (Wave 34).
export const crmLeads = complianceSchemaDB.table('crm_leads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  source: text('source'), // free text, e.g. 'referral' | 'website' | 'cold_outreach'
  status: text('status').notNull().default('new'), // 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'
  ownerId: text('owner_id'),
  convertedClientId: text('converted_client_id'), // set when convertLeadToClient() runs -- closes the loop into the Wave-1 clients table
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const crmOpportunities = complianceSchemaDB.table('crm_opportunities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  leadId: text('lead_id'), // nullable -- an opportunity can originate from a lead...
  clientId: text('client_id'), // ...or an existing client (e.g. an add-on service) -- at least one of the two is required, enforced in the service layer
  name: text('name').notNull(),
  stage: text('stage').notNull().default('prospecting'), // 'prospecting' | 'proposal' | 'negotiation' | 'won' | 'lost'
  estimatedValue: numeric('estimated_value'),
  expectedCloseDate: date('expected_close_date'),
  ownerId: text('owner_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── VERIDIAN HR (Wave 40, PLATFORM_STRATEGY.md §19) ─────────────────────
// minthcm/erpnext(hrms)/orangehrm were evaluated and rejected as software
// (PHP/Frappe monoliths, none Vercel-serverless-deployable). Closes the
// real gap confirmed by reading this schema: `users` has auth fields plus
// `departmentId`/`reportingToId` (Wave 1) but zero actual employee master
// data, and `leavePolicyEntries` is POLICY TEXT, not a per-employee
// request/balance ledger -- there was no way for an employee to actually
// request leave before this wave. Payroll processing is deliberately out
// of scope (VERIDIAN tracks payroll *compliance*, `hrComplianceItems`,
// never runs payroll itself); org chart needs zero new schema at all --
// it's a read-only tree over the already-existing reportingToId.
export const employeeProfiles = complianceSchemaDB.table('employee_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().unique(),
  orgId: text('org_id').notNull(),
  employeeCode: text('employee_code'),
  jobTitle: text('job_title'),
  employmentType: text('employment_type').notNull().default('full_time'), // 'full_time' | 'part_time' | 'contract' | 'intern'
  dateOfJoining: date('date_of_joining'),
  dateOfBirth: date('date_of_birth'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const leaveRequests = complianceSchemaDB.table('leave_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  leaveType: text('leave_type').notNull(), // free text, matches leave_policy_entries.leave_type
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  numDays: numeric('num_days').notNull(),
  reason: text('reason'),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected' | 'cancelled'
  approverId: text('approver_id'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const leaveBalances = complianceSchemaDB.table('leave_balances', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  leaveType: text('leave_type').notNull(),
  year: integer('year').notNull(),
  totalDays: numeric('total_days').notNull().default('0'),
  usedDays: numeric('used_days').notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── VERIDIAN Ticketing (Wave 39, PLATFORM_STRATEGY.md §21) ──────────────
// Peppermint/Trudesk/FlowInquiry were evaluated and rejected as software
// (each needs its own standalone server -- Node+Postgres+Docker,
// Node+MongoDB, Java/Spring+Postgres respectively). A support ticket is,
// underneath, a structured status/priority/SLA wrapper around a
// conversation thread -- rather than rebuild a second messaging system,
// `conversationId` points at the *already-existing* `conversations` table
// (Wave 12), so every reply, guest message (Wave 36), markdown rendering
// (Wave 37), and attachment (Wave 32) already works for free. External
// customer/vendor participation reuses `conversationGuestAccess` exactly
// as-is -- no new public-facing auth surface invented for this module.
export const tickets = complianceSchemaDB.table('tickets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // nullable -- links to an existing compliance client if this ticket is theirs
  conversationId: text('conversation_id').notNull(),
  subject: text('subject').notNull(),
  category: text('category'), // free text, e.g. 'technical' | 'billing' | 'general'
  priority: priorityEnum('priority').notNull().default('medium'),
  status: text('status').notNull().default('open'), // 'open' | 'in_progress' | 'resolved' | 'closed'
  assigneeId: text('assignee_id'),
  requesterUserId: text('requester_user_id'), // nullable -- the internal user this ticket is on behalf of, if any
  slaDeadline: timestamp('sla_deadline'),
  resolvedAt: timestamp('resolved_at'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── VERI Chat (Wave 32) ──────────────────────────────────────────────────
// Extends Wave 12's conversations/messages -- does not replace them.
// contextEntityType/contextEntityId is the same polymorphic pattern already
// used by embeddings/approval_requests/audit_logs, reused here rather than
// invented fresh, per PLATFORM_STRATEGY.md §16.
export const messageAttachments = complianceSchemaDB.table('message_attachments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  messageId: text('message_id').notNull(),
  documentId: text('document_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Tokenized, time-limited, read-only public share page -- the only safe way
// to put a conversation "into" a wa.me/t.me link, per §16.2's research
// finding that no web link can extract an existing chat, and that raw chat
// content must never sit in a URL bar/history. Revoked/expired links simply
// 404 on the public share route -- no separate "is this valid" boolean
// needed beyond checking those two columns at read time.
export const conversationShareLinks = complianceSchemaDB.table('conversation_share_links', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').notNull(),
  token: text('token').notNull().unique(),
  createdById: text('created_by_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── VERI Chat guest access (Wave 36, PLATFORM_STRATEGY.md §17.8-17.9) ───
// The original VERI Chat spec named "customers, vendors" as chat parties,
// but conversation_participants.user_id is NOT NULL against the internal
// users table -- there was no way for an external party without a
// VERIDIAN account to actually participate. Mattermost/Zulip/Rocket.Chat/
// Element/Chatwoot were all evaluated and rejected as software (every one
// needs its own standalone server); Zulip's guest role, Rocket.Chat's
// Omnichannel, and Chatwoot's entire reason for existing independently
// confirmed the underlying gap. Same shape as conversation_share_links,
// but write-capable (posts messages, not just a read-only snapshot).
export const conversationGuestAccess = complianceSchemaDB.table('conversation_guest_access', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  conversationId: text('conversation_id').notNull(),
  token: text('token').notNull().unique(),
  guestName: text('guest_name').notNull(),
  guestEmail: text('guest_email'),
  invitedById: text('invited_by_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── VERI To Do (Wave 33) ─────────────────────────────────────────────────
// Deliberately no new table -- this module formalizes a RULE (what counts
// as "pending work" for a user), fixing task-service.ts's listMyTodos(),
// which Wave 15 intended to be a universal union but which, confirmed by
// reading it, only ever queried the bare `tasks` table. See §16.3.

// ─── VERI Minutes of Meetings (Wave 34) ──────────────────────────────────
// Genuinely new and general-purpose, the same call already made for
// Knowledge Base in Wave 29 and for the same reason: board_meetings
// (Wave 8, governance-only) and pms_meetings (Wave 28, PMS-project-scoped)
// are both real but scope-locked. minutesHistory mirrors board_meetings'
// own amend-don't-overwrite precedent verbatim.
// Wave 44 additions (PLATFORM_STRATEGY.md §25): systemId/status/publishedAt/
// publishedById -- the publish/lock workflow adopted from meettrack-v2,
// enforced at the service layer (not just a disabled UI input like the
// source app). Field-level change history reuses the existing audit_logs
// table via logActivity(), not a new meeting_history table.
export const veriMeetings = complianceSchemaDB.table('veri_meetings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  contextEntityType: text('context_entity_type'), // nullable -- 'project' | 'client' | 'department' | null (general meeting)
  contextEntityId: text('context_entity_id'),
  title: text('title').notNull(),
  meetingType: text('meeting_type').notNull().default('team'), // 'team' | 'client' | 'vendor' | 'one_on_one' | 'other'
  scheduledAt: timestamp('scheduled_at').notNull(),
  attendees: jsonb('attendees').notNull().default([]), // string[] -- names, not FK'd (external attendees may not be app users)
  agenda: jsonb('agenda').notNull().default([]), // string[]
  minutes: text('minutes'),
  minutesHistory: jsonb('minutes_history').notNull().default([]), // { date, amendedBy, text }[]
  systemId: text('system_id').unique(), // e.g. MOM-2026-4821 -- nullable, pre-existing rows never get one retroactively
  status: text('status').notNull().default('draft'), // 'draft' | 'published' -- once published, meeting-level fields lock
  publishedAt: timestamp('published_at'),
  publishedById: text('published_by_id'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Wave 44: mirrors conversationShareLinks (Wave 36) exactly -- tokenized,
// time-limited, individually revocable. Deliberately NOT meettrack-v2's own
// simpler is_published=true=world-readable-forever RLS policy, which is a
// materially weaker security model for anything meant to stay revocable.
export const veriMeetingShareLinks = complianceSchemaDB.table('veri_meeting_share_links', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  meetingId: text('meeting_id').notNull(),
  token: text('token').notNull().unique(),
  createdById: text('created_by_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Action items become real `tasks` rows (which VERI To Do already
// surfaces) -- this is a pure join, not a parallel tracking mechanism.
export const veriMeetingActionItems = complianceSchemaDB.table('veri_meeting_action_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  meetingId: text('meeting_id').notNull(),
  taskId: text('task_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const messageAttachmentsRelations = relations(messageAttachments, ({ one }) => ({
  message: one(messages, { fields: [messageAttachments.messageId], references: [messages.id] }),
  document: one(documents, { fields: [messageAttachments.documentId], references: [documents.id] }),
}))

export const conversationShareLinksRelations = relations(conversationShareLinks, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationShareLinks.conversationId], references: [conversations.id] }),
}))

export const conversationGuestAccessRelations = relations(conversationGuestAccess, ({ one }) => ({
  conversation: one(conversations, { fields: [conversationGuestAccess.conversationId], references: [conversations.id] }),
}))

export const veriMeetingsRelations = relations(veriMeetings, ({ many }) => ({
  actionItems: many(veriMeetingActionItems),
  shareLinks: many(veriMeetingShareLinks),
}))

export const veriMeetingShareLinksRelations = relations(veriMeetingShareLinks, ({ one }) => ({
  meeting: one(veriMeetings, { fields: [veriMeetingShareLinks.meetingId], references: [veriMeetings.id] }),
}))

export const veriMeetingActionItemsRelations = relations(veriMeetingActionItems, ({ one }) => ({
  meeting: one(veriMeetings, { fields: [veriMeetingActionItems.meetingId], references: [veriMeetings.id] }),
  task: one(tasks, { fields: [veriMeetingActionItems.taskId], references: [tasks.id] }),
}))
