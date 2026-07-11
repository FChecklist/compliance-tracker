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
  pageAgentEnabled: boolean('page_agent_enabled').notNull().default(false),
  // Wave 172 (area 16, Account/Organization lifecycle -- U-D27.B1.S1):
  // licensedSeats null = unlimited/unenforced (every pre-existing org's
  // real state -- opt-in, not retroactively imposed). seatEnforcementEnabled
  // defaults false for the same reason: this is a new control an admin turns
  // on deliberately, not a silent cap that could lock existing orgs out of
  // their own accounts the moment this migration lands.
  licensedSeats: integer('licensed_seats'),
  seatEnforcementEnabled: boolean('seat_enforcement_enabled').notNull().default(false),
  // Wave 172 (area 11, Cost management -- embedded in U-D14.B1.S1): scope
  // decision made by Super Boss per the Owner's 2026-07-11 "don't wait"
  // directive (previously Owner-flagged as needing a definition-of-done).
  // Per-org monthly cap chosen over per-user/per-task-type/daily because
  // token_usage_ledger (the existing spend-tracking table this reads from)
  // is already org-scoped and monthly is the natural unit for a spend cap a
  // human would actually set. null = unenforced, same opt-in default pattern
  // as licensedSeats above -- see cost-guard.ts for the enforcement logic.
  monthlyCostCapUsd: numeric('monthly_cost_cap_usd', { precision: 10, scale: 2 }),
  costCapEnforcementEnabled: boolean('cost_cap_enforcement_enabled').notNull().default(false),
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
  onboardingStage: text('onboarding_stage').notNull().default('profile'), // OnboardingChecklist.tsx step ids: profile|compliance|upload|invite|ai-config
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
  // Wave 61 (Unified Document Management, ERP benchmark Tier 3 #15): additive
  // columns so this same table becomes a real central repository instead of
  // adding a parallel one. category/expiryDate/linkedEntityType+linkedEntityId
  // are generic and deliberately NOT another FK per module (there's no single
  // table every future linkable entity could point at) -- linkedEntityType is
  // a free-text discriminator (e.g. 'erp_sales_invoice', 'pms_issue',
  // 'employee_profile') resolved by the consuming UI, exactly like
  // referenceType/referenceId already works on erp_journal_entries.
  category: text('category'), // nullable: 'contract'|'certificate'|'license'|'policy'|'id_proof'|'other' -- advisory, not enum-enforced, since new categories will keep appearing across modules
  expiryDate: timestamp('expiry_date'), // nullable: drives the expiring-documents dashboard widget
  linkedEntityType: text('linked_entity_type'),
  linkedEntityId: text('linked_entity_id'),
  parentDocumentId: text('parent_document_id'), // self-FK: previous version of this same logical document
  versionNumber: integer('version_number').notNull().default(1),
  isLatestVersion: boolean('is_latest_version').notNull().default(true), // maintained by document-service.ts on every new-version insert, not a DB trigger -- matches this codebase's assigneeId-cache convention elsewhere
  // Wave 91 (Comparison CSV 2 gap analysis: DMS008 Retention & Disposal).
  // disposalDate is computed at set-retention time (createdAt + retentionPeriodDays),
  // not recomputed live -- a records-retention schedule is a point-in-time
  // decision, not a moving target. legalHold blocks disposal even past
  // disposalDate (standard records-management concept: litigation/audit hold).
  retentionPeriodDays: integer('retention_period_days'),
  disposalDate: date('disposal_date', { mode: 'string' }),
  legalHold: boolean('legal_hold').notNull().default(false),
  isDisposed: boolean('is_disposed').notNull().default(false),
  disposedAt: timestamp('disposed_at'),
  disposedById: text('disposed_by_id'),
  // Wave 117 (PROJEXA Permits/Drawings/Site Photos): category-specific fields
  // (permitAuthority/permitNumber for 'permit'; a floor/area/activity
  // location path for 'site_photo') aren't generic enough across 30+
  // existing document categories to justify dedicated typed columns --
  // same reasoning already applied to `category` itself being free text
  // instead of an enum. Follows the extractedData precedent directly above.
  metadata: jsonb('metadata'),
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
  // Wave 96 (Comparison CSV 3 gap analysis: API002/API009 "Rate Limiting +
  // Usage Analytics"): null = unlimited (every pre-existing key's exact
  // current behavior, zero migration risk, same "null = unconstrained"
  // convention as domainScope above). When set, validateApiKey() rejects a
  // request with 429 once api_key_request_log shows this many requests for
  // the key in the trailing 60 seconds.
  rateLimitPerMinute: integer('rate_limit_per_minute'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Wave 96: real per-request log backing both rate-limit enforcement (count
// of rows in the trailing 60s) and the usage-analytics dashboard (requests
// over time, top endpoints, rate-limited fraction). Deliberately does NOT
// capture the eventual response status code -- that's decided deep inside
// each route handler, and threading it back through every /api/v1 and
// /api/mcp call site would be a scope expansion this wave doesn't need;
// wasRateLimited is known at log time (validateApiKey itself makes that
// call) and is the one status signal the usage dashboard actually needs.
export const apiKeyRequestLog = complianceSchemaDB.table('api_key_request_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  apiKeyId: text('api_key_id').notNull(),
  orgId: text('org_id').notNull(),
  route: text('route').notNull(),
  method: text('method').notNull(),
  wasRateLimited: boolean('was_rate_limited').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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

// ─── Entity Relationships (Phase 3 graph store, Phase3_Design_by_Claude.md) ──
// Generic typed-edge table -- the substrate every "Enterprise * Graph"
// proposal in both VERIDIAN.docx studies needs and none of them has today.
// sourceType/targetType/relationshipType are free text, not enums, same
// choice `embeddings.entityType` makes above: the set of entity kinds that
// might need linking already spans dozens of tables and keeps growing, and
// an enum would need a migration every time a new module wants to
// participate. orgId is NOT nullable (unlike embeddings.orgId) -- every
// relationship this table is meant to express links two entities that
// belong to a specific tenant; there is no platform-level use case for this
// table the way there is for global-tier embeddings.
export const entityRelationships = complianceSchemaDB.table('entity_relationships', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  relationshipType: text('relationship_type').notNull(),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Wave 99 (alibaba/zvec evaluation -- rejected as incompatible with
// Vercel Edge/Supabase Edge Functions, see PLATFORM_STRATEGY.md): a real
// exact-match cache so generateEmbedding() can skip the OpenRouter network
// round-trip for repeated identical query text -- the actual latency
// bottleneck, not pgvector search itself. Looked up by content_hash only
// (sha256 of the literal text), never by vector similarity, so no ANN
// index exists on this table. `embedding vector(1536)` intentionally
// omitted here -- same raw-SQL-managed pattern as `embeddings` above.
export const embeddingCache = complianceSchemaDB.table('embedding_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contentHash: text('content_hash').notNull().unique(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
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
  // STATUS (confirmed 2026-07-09, VERIDIAN.docx joint implementation plan,
  // z.ai's independent gap analysis finding): this column exists and is
  // wired into a Drizzle relation (see `supervisor`/`subordinates` below)
  // but is genuinely never populated -- live query confirms 0 of 27 real
  // worker_agents rows have it set. No code path writes to it. Treat as
  // reserved/not-yet-implemented, not evidence that agent supervision is a
  // working feature -- building that (assignment UI, dispatch-time
  // supervisor routing, etc.) is a real, separate feature, not something to
  // infer is "almost done" from this column's presence.
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
  // When set, this task was created from a completed VERI Chat chain
  // selection -- the worker agent is already known, so executeTask() skips
  // LLM planning entirely and dispatches directly (zero-LLM-cost path).
  resolvedWorkerAgentId: text('resolved_worker_agent_id'),
  // Wave 148 (Phase4_Implementation_Plan.md, "task queue + priority"):
  // higher = more urgent. Default 0 so every existing row sorts exactly
  // where createdAt already put it -- purely additive, no reordering of
  // existing data. Queue order is priority DESC, createdAt ASC (oldest
  // first within the same priority) -- no separate queue table, this
  // column plus an orderBy is the whole "queue."
  priority: integer('priority').notNull().default(0),
  // Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md, "Dynamic Chain as the
  // Primary System Object -- Phase 1"): points at dynamic_chains, the
  // resolved Chain Selector path this task was created from. Nullable,
  // additive -- only wired at new-task creation via VeriComposer, no
  // backfill of pre-existing rows.
  dynamicChainId: text('dynamic_chain_id'),
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
  // Wave 167 (tree4-unified/10-merged-governance-layer U-D17.B1.S1,
  // "Mandatory structured handover -- no AI Agent may simply say 'Done'").
  // All 11 columns nullable/additive -- existing rows are unaffected; a row
  // with handoverTaskStatus === null simply has no handover recorded yet
  // (see handover-protocol.ts's acceptHandover(), which reads that as
  // "not_submitted"). The 9 handoverXxx fields map 1:1 to the governance
  // spec's required Output fields (Task Status / Output Produced /
  // Validation Passed / Known Risks / Pending Items / Confidence / Next
  // Responsible AI / Required Action / Escalation Required); handoverAcceptedBy/
  // handoverAcceptedAt are the separate acceptance pair -- both start null,
  // and per the spec's Guardrail, only an explicit acceptHandover() call
  // (not the mere presence of a submitted handover) sets them, so "sent"
  // and "acknowledged" stay distinguishable on this same row.
  handoverTaskStatus: text('handover_task_status'),
  handoverOutputProduced: text('handover_output_produced'),
  handoverValidationPassed: text('handover_validation_passed'), // 'yes' | 'no' | 'partial'
  handoverKnownRisks: text('handover_known_risks'),
  handoverPendingItems: text('handover_pending_items'),
  handoverConfidence: text('handover_confidence'), // 'high' | 'medium' | 'low'
  handoverNextResponsibleAi: text('handover_next_responsible_ai'),
  handoverRequiredAction: text('handover_required_action'),
  handoverEscalationRequired: text('handover_escalation_required'), // 'yes' | 'no'
  handoverAcceptedBy: text('handover_accepted_by'), // null until acceptHandover() succeeds -- the receiving agent/role identifier
  handoverAcceptedAt: timestamp('handover_accepted_at'), // null until acceptHandover() succeeds
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

// Wave 166 (tree4-unified/10-merged-governance-layer.yaml U-D14.B1.S1 "Tool
// Health" gap): a NEW table rather than columns on orchestraExecutions,
// deliberately -- a single execution (one row there) can invoke several
// tools, a many-to-one relationship a single boolean column can't
// represent, and orchestra-execution-logger.ts itself is out of scope for
// this wave (see tool-health-tracker.ts's header for the full rationale).
// executionId is a soft reference (by convention, like activityLog's
// detailId above) to orchestraExecutions.id -- not a DB-level FK, since a
// tool call can also happen outside an orchestra-logged LLM call (e.g. a
// deterministic engine invocation) and still be worth recording.
export const toolHealthEvents = complianceSchemaDB.table('tool_health_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  executionId: text('execution_id'),
  toolName: text('tool_name').notNull(),
  succeeded: boolean('succeeded').notNull(),
  errorMessage: text('error_message'),
  durationMs: integer('duration_ms'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Wave 160 (UNIVERSAL_TASK_WRAPPER_DESIGN.md, Phase 1): additive envelope,
// NOT a replacement for tasks/orchestraExecutions -- see the design doc's
// "Option A vs Option B" section for why forcing one of those existing
// tables to mean "the universal Task" would be riskier than wrapping them.
// detailTable/detailId point at the richer row (by convention, not a real
// FK -- detailTable varies); ai_team_dispatch/loop_run activity types have
// no detail row at all yet (that's the actual, concrete gap this phase
// closes -- both were completely unpersisted before this).
export const activityLog = complianceSchemaDB.table('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  userId: text('user_id'),
  activityType: text('activity_type').notNull(), // 'customer_task' | 'orchestra_call' | 'ai_team_dispatch' | 'loop_run'
  detailTable: text('detail_table'),
  detailId: text('detail_id'),
  lifecycleStage: text('lifecycle_stage').notNull().default('requested'), // requested | classified | validated | executing | reviewing | completed | failed | closed
  objective: text('objective'),
  // Wave 165 (tree4-unified/50-completion-plan U-D12.B4.S3 finding: the
  // "reviewing" stage above was already being set on low-confidence AI Team
  // dispatches, but nothing ever read it back -- the dispatch response said
  // status:"completed" regardless, no independent reviewer was ever
  // required, no comments became a permanent record). All 4 nullable and
  // additive -- existing rows are unaffected, this only gates NEW
  // dispatches that land in "reviewing".
  selfAssessment: jsonb('self_assessment'), // the executing role's own structured self-report: {taskStatus, outputProduced, validationPassed, knownRisks, confidence}
  reviewedBy: text('reviewed_by'), // the independent reviewer's user id -- must differ from the dispatching user (no self-certification, mirrors AGENTS.md Rule 7c)
  reviewNotes: text('review_notes'), // permanent record of the reviewer's comments -- required, not optional, when a decision is recorded
  reviewDecision: text('review_decision'), // 'approved' | 'rejected', null until reviewed
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Wave 161 (VERIDIAN_DMP_DCF_CONSTITUTION.md, "Dynamic Chain as the Primary
// System Object -- Phase 1"): the persisted backing store for a resolved
// Chain Selector path -- the CapabilityNode tree itself stays computed
// on-the-fly (capability-tree-service.ts, unchanged), this is what a task/
// conversation actually references once a selection is made. Core queryable
// structure only, not the source document's full 10-sub-object schema
// (business/AI/workflow/governance/knowledge definitions per chain) -- that
// richer schema is deliberately deferred, see the constitution doc's
// "Rollout scope" section for why.
export const dynamicChains = complianceSchemaDB.table('dynamic_chains', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  modePill: text('mode_pill').notNull(),
  pathKeys: jsonb('path_keys').notNull().default([]),
  pathLabels: jsonb('path_labels').notNull().default([]),
  moduleRef: text('module_ref'),
  description: text('description'),
  createdById: text('created_by_id'),
  status: text('status').notNull().default('approved'), // 'draft' | 'proposed' | 'approved' | 'retired'
  // Wave 166 (tree4-unified U-D14.B2.S1: "Every Dynamic Chain contains
  // predefined monitoring rules"): first-pass, additive-only field. Nullable
  // JSON, not a new normalized table -- there is no confirmed monitoring
  // agent yet that reads/enforces a chain-scoped rule set (Tree 3's
  // evidence is task-level/org-level, not chain-scoped, per this
  // sub-branch's own gap note), so this deliberately stops at "a place to
  // put a rule set" rather than inventing the enforcement layer around it.
  // Suggested (not yet enforced) shape: { rules: { metric: string; maxValue?: number; minValue?: number; action: "warn" | "escalate" }[] }.
  monitoringRules: jsonb('monitoring_rules'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Wave 171 (tree4-unified/50-completion-plan area 1, U-D6.B1.S1): DCMD
  // rich-metadata fields. U-D6.B2.S2 recommended modeling this as a graph
  // structure rather than an enumerated permutation table -- that
  // recommendation is itself tagged not_applicable_to_code (a modeling
  // suggestion, not a literal requirement), so this stays relational/JSON
  // rather than a real graph DB, which would be new infrastructure for no
  // functional gain over jsonb arrays a handful of real queries need. All
  // nullable/defaulted -- existing rows are unaffected.
  linkedModuleRefs: jsonb('linked_module_refs').notNull().default([]), // generalizes moduleRef (kept for backward compat) to the many-module case
  businessRules: jsonb('business_rules'), // free-form rule refs -- narrow schema deferred until a real consumer needs a specific shape
  permissions: jsonb('permissions'), // required role/scope refs to traverse this chain
  workflowRef: text('workflow_ref'),
  aiBehaviorRef: text('ai_behavior_ref'),
  reportsKpisSlas: jsonb('reports_kpis_slas'),
  version: integer('version').notNull().default(1),
  previousVersionId: text('previous_version_id'), // self-referencing, null for the first version of a chain lineage
})

// Wave 161 (VERI_CHAT_GOVERNANCE.md, "VERI-Assisted Communication
// Protocol"): persisted, user-controlled, revocable approval preferences --
// confirmed absent everywhere before this (zero hits grepping for
// "approval_preference"/"always approve" prior to this wave). scopeId is
// nullable (a type-level preference has no specific scope); dedup/upsert is
// handled at the application layer (approval-preference-service.ts) via
// find-then-insert-or-update rather than a DB-level ON CONFLICT, since a
// unique index over a nullable column doesn't match NULL-to-NULL the way a
// naive upsert would assume.
export const approvalPreferences = complianceSchemaDB.table('approval_preferences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  scopeType: text('scope_type').notNull(), // 'communication_type' | 'conversation' | 'task' | 'workflow'
  scopeId: text('scope_id'),
  actionCategory: text('action_category').notNull(), // one of high-impact-action-detector.ts's HighImpactCategory values
  decision: text('decision').notNull(), // 'always_approve' | 'always_reject'
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
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
// Wave 106 (Master AI OS): promoted from a bare catalog to a real product
// catalog -- the platform now has ~20 branchKey rows (3 live + office +
// ~16 future verticals), most of which don't exist yet, so the catalog
// itself needs to carry "is this live, and how big a build is it" rather
// than that living only in a separate doc that will drift. See
// MASTER_AI_OS_ARCHITECTURE.md for the full rules this table's columns
// encode.
export const productBranches = complianceSchemaDB.table('product_branches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  branchKey: text('branch_key').notNull().unique(), // 'grc' today; 'sales' | 'hr' | 'scm' | ... in future Phase D branches
  displayName: text('display_name').notNull(),
  domain: text('domain').notNull(),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  tagline: text('tagline'), // marketing one-liner, e.g. "Run every marketplace from one place"
  icon: text('icon'), // lucide-react icon name string -- matches how AppSidebar.tsx already imports icons by name; no new asset-management surface
  // 'live' | 'building' | 'planned' -- deliberately text, not a Postgres
  // enum: webhookEventEnum needing expansion for new event types was real
  // friction elsewhere in this codebase, and this column WILL grow new
  // values (e.g. 'deprecated') as the catalog matures. Validated at the
  // service layer, same posture as moduleRegistry.category.
  status: text('status').notNull().default('planned'),
  launchOrder: integer('launch_order').notNull().default(999), // display ordering only
  parentDomain: text('parent_domain'), // nullable, pure UI grouping (e.g. group procurement/distribution/export_import under an "ERP Family" heading) -- free text by convention like moduleRegistry.domain, not a real FK hierarchy
  // 'repackage' | 'moderate_build' | 'ground_up' -- encodes the build-tier
  // classification from MASTER_AI_OS_ARCHITECTURE.md directly in the
  // catalog so it's queryable and can't drift out of sync with the doc.
  buildTier: text('build_tier'),
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

// ─── Wave 94 (Comparison CSV 3 gap analysis: AI011 "Prompt/Model Evaluation
// Framework") ───────────────────────────────────────────────────────────────
// Global/platform-governed, same posture as prompt_templates/prompt_versions
// above -- eval cases are authored content, not tenant data, so there is no
// org_id anywhere here. Writes are veridian_admin-gated at the service layer
// (mirrors prompt-os-service.ts's createPromptVersion), not RLS-gated by org.
// Scoring is deterministic keyword containment, never an LLM-judging-an-LLM
// call -- a real, verifiable pass/fail, not a fabricated confidence score.
export const promptEvalCases = complianceSchemaDB.table('prompt_eval_cases', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  promptTemplateId: text('prompt_template_id').notNull(),
  name: text('name').notNull(),
  inputVariables: jsonb('input_variables').notNull().default({}), // substituted into the prompt version's {{token}} placeholders (Wave 88's template-generation convention)
  userMessage: text('user_message').notNull(),
  expectedKeywords: jsonb('expected_keywords').notNull().default([]), // string[] -- all must appear (case-insensitive) in a passing output
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const promptEvalRuns = complianceSchemaDB.table('prompt_eval_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  evalCaseId: text('eval_case_id').notNull(),
  promptVersionId: text('prompt_version_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  renderedPrompt: text('rendered_prompt').notNull(), // system prompt after {{token}} substitution -- audit trail of exactly what was sent
  output: text('output'),
  status: text('status').notNull().default('completed'), // 'completed'|'error' -- error means the LLM call itself failed, not a failed eval score
  errorMessage: text('error_message'),
  passed: boolean('passed'),
  missingKeywords: jsonb('missing_keywords').notNull().default([]),
  latencyMs: integer('latency_ms'),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  estimatedCostUsd: numeric('estimated_cost_usd'),
  runById: text('run_by_id').notNull(),
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
  parentDocument: one(documents, { fields: [documents.parentDocumentId], references: [documents.id], relationName: 'documentVersions' }),
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

export const apiKeysRelations = relations(apiKeys, ({ one, many }) => ({
  org: one(organisations, { fields: [apiKeys.orgId], references: [organisations.id] }),
  requestLog: many(apiKeyRequestLog),
}))

export const apiKeyRequestLogRelations = relations(apiKeyRequestLog, ({ one }) => ({
  apiKey: one(apiKeys, { fields: [apiKeyRequestLog.apiKeyId], references: [apiKeys.id] }),
}))

// ─── Wave 97 (Comparison CSV 3 gap analysis: IAM010 "Access Review") ──────
// A real periodic access-certification cycle over the existing RBAC
// assignments (users.role) -- not a report, an actual workflow: opening a
// cycle snapshots every active user's current role into a pending
// certification row; an admin then confirms or revokes each one.
// "Revoked" has real teeth -- access-review-service.ts flips users.isActive
// to false, and requireAuth() (Wave 97, same pass) now actually enforces
// isActive, closing a pre-existing gap where deactivation had zero effect.
export const accessReviewCycles = complianceSchemaDB.table('access_review_cycles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  status: text('status').notNull().default('open'), // 'open'|'completed'
  createdById: text('created_by_id').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const accessReviewCertifications = complianceSchemaDB.table('access_review_certifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  cycleId: text('cycle_id').notNull(),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  reviewedRole: text('reviewed_role').notNull(), // snapshot of the role AT REVIEW TIME -- never a live join, so a later role change doesn't rewrite history
  decision: text('decision').notNull().default('pending'), // 'pending'|'confirmed'|'revoked'
  reviewedById: text('reviewed_by_id'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const accessReviewCyclesRelations = relations(accessReviewCycles, ({ many }) => ({
  certifications: many(accessReviewCertifications),
}))
export const accessReviewCertificationsRelations = relations(accessReviewCertifications, ({ one }) => ({
  cycle: one(accessReviewCycles, { fields: [accessReviewCertifications.cycleId], references: [accessReviewCycles.id] }),
  user: one(users, { fields: [accessReviewCertifications.userId], references: [users.id] }),
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

export const promptEvalCasesRelations = relations(promptEvalCases, ({ one, many }) => ({
  template: one(promptTemplates, { fields: [promptEvalCases.promptTemplateId], references: [promptTemplates.id] }),
  runs: many(promptEvalRuns),
}))

export const promptEvalRunsRelations = relations(promptEvalRuns, ({ one }) => ({
  evalCase: one(promptEvalCases, { fields: [promptEvalRuns.evalCaseId], references: [promptEvalCases.id] }),
  promptVersion: one(promptVersions, { fields: [promptEvalRuns.promptVersionId], references: [promptVersions.id] }),
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
  // Wave 171 (tree4-unified/50-completion-plan area 1, U-D6.B3.S1): same
  // Dynamic Chain Phase 1 linkage as tasks.dynamicChainId/conversations'
  // equivalent field -- extends single-Chain-ID traceability to approvals,
  // the 3rd referencing object type wired so far.
  dynamicChainId: text('dynamic_chain_id'),
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
// formData/generatedAt (added alongside mca-form-generator.ts): a real,
// structured, filing-ready data compilation for AOC-4/MGT-7/DIR-12/CHG-1 --
// sourced from directors_kmp/cap_table_entries/company_charges/board_meetings/
// the ERP balance-sheet-P&L engine, in the actual field shape those MCA
// e-forms require (public government form spec, not any third party's
// code). Still stops at data compilation, same submission boundary as above.
export const mcaFilings = complianceSchemaDB.table('mca_filings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  formType: text('form_type').notNull(),
  description: text('description'),
  dueDate: timestamp('due_date'),
  status: text('status').notNull().default('preparing'), // 'preparing' | 'ready_to_file' | 'filed'
  srn: text('srn'),
  filedDate: timestamp('filed_date'),
  formData: jsonb('form_data'),
  generatedAt: timestamp('generated_at'),
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
  matterId: text('matter_id'), // Wave 90: nullable link into legal_matters, the unifying register
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
  matterId: text('matter_id'), // Wave 90
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// bodyText/templateId/generatedAt (added alongside legal-opinion-service.ts):
// real document drafting, reusing the exact same clm_contract_templates/
// clm_template_clauses/clm_clauses infrastructure CLM contracts already use
// for token-substitution generation -- a template isn't inherently
// contract-specific, so no new clause/template schema was needed.
export const legalOpinions = complianceSchemaDB.table('legal_opinions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  topic: text('topic').notNull(),
  opinionDate: timestamp('opinion_date'),
  advisor: text('advisor'),
  linkedRiskId: text('linked_risk_id'),
  matterId: text('matter_id'), // Wave 90
  templateId: text('template_id'),
  bodyText: text('body_text'),
  generatedAt: timestamp('generated_at'),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Wave 90 (Comparison CSV 2 gap analysis: LEGAL001/002 "unified Matter
// register" + LEGAL004 "Arbitration & Mediation" + LEGAL009 "Legal Spend") ──
// litigation_matters/ip_portfolio/legal_opinions each lived in their own
// table with no cross-cutting concept -- legal_matters is that register,
// linked via the nullable matter_id columns just added above (additive
// columns, not a new join table, matching this schema's own convention for
// linking pre-existing rows into a new unifying concept). Arbitration is a
// genuinely new tracking table (no dedicated arbitration/mediation tracking
// existed at all, only court litigation). Legal spend is matter-scoped cost
// tracking, distinct from the early-wave compliance-obligation-scoped cost
// tracking. LEGAL012 (Evidence Repository) needs no new schema -- it reuses
// the existing polymorphic `documents` table with
// linkedEntityType='legal_matter' (Wave 61 convention).
export const legalMatters = complianceSchemaDB.table('legal_matters', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  matterNumber: integer('matter_number').notNull(), // per-org sequence, matching erp_contracts.contract_number convention
  title: text('title').notNull(),
  matterType: text('matter_type').notNull().default('general'), // 'litigation'|'ip'|'opinion'|'arbitration'|'general'
  status: text('status').notNull().default('open'), // 'open'|'closed'
  description: text('description'),
  responsibleUserId: text('responsible_user_id'),
  openedDate: date('opened_date', { mode: 'string' }).notNull(),
  closedDate: date('closed_date', { mode: 'string' }),
  clientId: text('client_id'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const legalArbitrationCases = complianceSchemaDB.table('legal_arbitration_cases', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  matterId: text('matter_id').notNull(),
  caseTitle: text('case_title').notNull(),
  arbitrationInstitution: text('arbitration_institution'),
  arbitrator: text('arbitrator'),
  status: text('status').notNull().default('filed'), // 'filed'|'ongoing'|'award_passed'|'closed'
  filingDate: date('filing_date', { mode: 'string' }),
  awardDate: date('award_date', { mode: 'string' }),
  claimAmount: numeric('claim_amount'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const legalSpendEntries = complianceSchemaDB.table('legal_spend_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  matterId: text('matter_id').notNull(),
  description: text('description').notNull(),
  category: text('category').notNull().default('legal_fees'), // 'legal_fees'|'court_fees'|'expert_fees'|'other'
  amount: numeric('amount').notNull(),
  spendDate: date('spend_date', { mode: 'string' }).notNull(),
  vendorId: text('vendor_id'), // nullable link to legal_vendors
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const legalMattersRelations = relations(legalMatters, ({ many }) => ({
  arbitrationCases: many(legalArbitrationCases),
  spendEntries: many(legalSpendEntries),
}))
export const legalArbitrationCasesRelations = relations(legalArbitrationCases, ({ one }) => ({
  matter: one(legalMatters, { fields: [legalArbitrationCases.matterId], references: [legalMatters.id] }),
}))
export const legalSpendEntriesRelations = relations(legalSpendEntries, ({ one }) => ({
  matter: one(legalMatters, { fields: [legalSpendEntries.matterId], references: [legalMatters.id] }),
  vendor: one(legalVendors, { fields: [legalSpendEntries.vendorId], references: [legalVendors.id] }),
}))

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
// riskScore/riskFactors (added alongside grc-workflow-engine.ts's
// computeVendorRiskScore): riskTier above was a manually-picked free-text
// field with nothing computing it -- these two columns hold the real
// deterministic 0-100 score and its factor breakdown from the last
// assessment, so riskTier becomes a value an assessment can set (and a
// human can still override), not a blank guess.
export const vendorRiskProfiles = complianceSchemaDB.table('vendor_risk_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  riskTier: text('risk_tier').notNull().default('medium'),
  riskScore: integer('risk_score'),
  riskFactors: jsonb('risk_factors'),
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

// ─── Wave 89 (Comparison CSV 2 gap analysis: BCM Business Impact Analysis +
// Recovery Plan detail + Exercise log) ─────────────────────────────────────
// bcm_plans (above) was a bare name/last-tested-date/status flag with zero
// BIA/recovery/exercise detail. None of these three child tables carry
// their own org_id -- RLS scopes via their parent plan's org_id, the same
// convention established in Wave 87 (erp_cycle_count_lines) and Wave 88
// (clm_template_clauses).
export const bcmBusinessImpactAnalyses = complianceSchemaDB.table('bcm_business_impact_analyses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull(),
  businessProcessName: text('business_process_name').notNull(),
  impactDescription: text('impact_description'),
  rtoHours: numeric('rto_hours'), // Recovery Time Objective
  rpoHours: numeric('rpo_hours'), // Recovery Point Objective
  criticalityLevel: text('criticality_level').notNull().default('medium'), // 'low'|'medium'|'high'|'critical'
  dependencies: text('dependencies'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const bcmRecoveryProcedures = complianceSchemaDB.table('bcm_recovery_procedures', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull(),
  stepNumber: integer('step_number').notNull(),
  description: text('description').notNull(),
  responsibleUserId: text('responsible_user_id'),
  estimatedDurationMinutes: numeric('estimated_duration_minutes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const bcmExercises = complianceSchemaDB.table('bcm_exercises', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull(),
  exerciseDate: date('exercise_date', { mode: 'string' }).notNull(),
  exerciseType: text('exercise_type').notNull(), // 'tabletop'|'walkthrough'|'full_simulation'
  outcome: text('outcome').notNull(), // 'passed'|'failed'|'partial'
  findings: text('findings'),
  conductedById: text('conducted_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const bcmPlansRelations = relations(bcmPlans, ({ many }) => ({
  businessImpactAnalyses: many(bcmBusinessImpactAnalyses),
  recoveryProcedures: many(bcmRecoveryProcedures),
  exercises: many(bcmExercises),
}))
export const bcmBusinessImpactAnalysesRelations = relations(bcmBusinessImpactAnalyses, ({ one }) => ({
  plan: one(bcmPlans, { fields: [bcmBusinessImpactAnalyses.planId], references: [bcmPlans.id] }),
}))
export const bcmRecoveryProceduresRelations = relations(bcmRecoveryProcedures, ({ one }) => ({
  plan: one(bcmPlans, { fields: [bcmRecoveryProcedures.planId], references: [bcmPlans.id] }),
}))
export const bcmExercisesRelations = relations(bcmExercises, ({ one }) => ({
  plan: one(bcmPlans, { fields: [bcmExercises.planId], references: [bcmPlans.id] }),
}))

// ─── Wave 92 (Comparison CSV 3 gap analysis: GRC012 "Fraud Management" +
// GRC009 "Disaster Recovery") ───────────────────────────────────────────────
// Fraud case register -- zero fraud-detection/case-tracking capability
// existed anywhere in the codebase before this wave. IT Disaster Recovery
// is deliberately distinct from Wave 89's bcm_plans: BCM models generic
// business-PROCESS recovery narrative (BIA/procedures/exercises), whereas
// DR here is IT-SYSTEM-specific (RTO/RPO per system, backup verification,
// failover test history) -- the same "different aggregate, not a bigger
// bcm_plans row" judgment as Wave 90's legal_matters vs litigation_matters.
export const fraudCases = complianceSchemaDB.table('fraud_cases', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  caseNumber: integer('case_number').notNull(), // per-org sequence, matching erp_contracts.contract_number convention
  title: text('title').notNull(),
  fraudType: text('fraud_type').notNull().default('other'), // 'financial'|'procurement'|'payroll'|'expense'|'inventory'|'cyber'|'other'
  detectionSource: text('detection_source').notNull().default('other'), // 'internal_audit'|'whistleblower'|'system_alert'|'external_report'|'management_review'|'other'
  description: text('description'),
  financialExposure: numeric('financial_exposure'),
  status: text('status').notNull().default('reported'), // 'reported'|'investigating'|'confirmed'|'unsubstantiated'|'resolved'
  reportedDate: date('reported_date', { mode: 'string' }).notNull(),
  investigatorId: text('investigator_id'),
  resolutionSummary: text('resolution_summary'),
  resolvedDate: date('resolved_date', { mode: 'string' }),
  linkedRiskId: text('linked_risk_id'), // nullable link into the existing risks register, same convention as legal_opinions.linked_risk_id
  clientId: text('client_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const itDrPlans = complianceSchemaDB.table('it_dr_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  systemName: text('system_name').notNull(),
  systemDescription: text('system_description'),
  criticalityLevel: text('criticality_level').notNull().default('medium'), // 'low'|'medium'|'high'|'critical'
  rtoHours: numeric('rto_hours').notNull(), // Recovery Time Objective
  rpoHours: numeric('rpo_hours').notNull(), // Recovery Point Objective
  backupFrequency: text('backup_frequency').notNull().default('daily'), // 'hourly'|'daily'|'weekly'|'monthly'
  status: text('status').notNull().default('active'), // 'active'|'draft'|'retired'
  ownerId: text('owner_id'),
  clientId: text('client_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// No org_id of their own; RLS scopes via their parent DR plan (Wave 87/88/89/90 convention).
export const itDrBackupVerifications = complianceSchemaDB.table('it_dr_backup_verifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  drPlanId: text('dr_plan_id').notNull(),
  verificationDate: date('verification_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('success'), // 'success'|'failed'|'partial'
  notes: text('notes'),
  verifiedById: text('verified_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const itDrFailoverTests = complianceSchemaDB.table('it_dr_failover_tests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  drPlanId: text('dr_plan_id').notNull(),
  testDate: date('test_date', { mode: 'string' }).notNull(),
  testType: text('test_type').notNull().default('tabletop'), // 'tabletop'|'partial_failover'|'full_failover'
  outcome: text('outcome').notNull().default('passed'), // 'passed'|'failed'|'partial'
  findings: text('findings'),
  conductedById: text('conducted_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const itDrPlansRelations = relations(itDrPlans, ({ many }) => ({
  backupVerifications: many(itDrBackupVerifications),
  failoverTests: many(itDrFailoverTests),
}))
export const itDrBackupVerificationsRelations = relations(itDrBackupVerifications, ({ one }) => ({
  plan: one(itDrPlans, { fields: [itDrBackupVerifications.drPlanId], references: [itDrPlans.id] }),
}))
export const itDrFailoverTestsRelations = relations(itDrFailoverTests, ({ one }) => ({
  plan: one(itDrPlans, { fields: [itDrFailoverTests.drPlanId], references: [itDrPlans.id] }),
}))

// ─── Wave 93 (Comparison CSV 3 gap analysis: MDM007 "Duplicate Detection" +
// MDM008 "Data Quality Scoring") ────────────────────────────────────────────
// Duplicate candidates are detected via pg_trgm similarity() on
// erp_customers.customer_name / erp_suppliers.supplier_name combined with
// exact gstin/pan_number matches -- a real similarity computation, not a
// fabricated score. The merge workflow is deliberately scoped down: it
// deactivates the loser record and reassigns its own erp_contacts /
// erp_addresses (polymorphic linkedEntityId) and erp_supplier_bank_accounts
// (direct supplierId FK) to the survivor. It does NOT rewrite historical
// invoices/POs/subscriptions still pointing at the merged-away id -- a
// full transactional FK rewrite across every ERP table was judged too risky
// for this pass; this is documented, not a silent gap.
export const mdmDuplicateCandidates = complianceSchemaDB.table('mdm_duplicate_candidates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  entityType: text('entity_type').notNull(), // 'erp_customer'|'erp_supplier'
  entityIdA: text('entity_id_a').notNull(),
  entityIdB: text('entity_id_b').notNull(),
  matchScore: numeric('match_score').notNull(), // 0..1
  matchReason: text('match_reason').notNull(), // 'name_similarity'|'gstin_match'|'pan_match'|'combined'
  status: text('status').notNull().default('pending'), // 'pending'|'confirmed_duplicate'|'not_duplicate'|'merged'
  reviewedById: text('reviewed_by_id'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const mdmMergeLog = complianceSchemaDB.table('mdm_merge_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  entityType: text('entity_type').notNull(),
  survivingEntityId: text('surviving_entity_id').notNull(),
  mergedEntityId: text('merged_entity_id').notNull(),
  mergedById: text('merged_by_id').notNull(),
  mergedAt: timestamp('merged_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  // Wave 161: same Dynamic Chain Phase 1 linkage as tasks.dynamicChainId
  // above. Additive, nullable -- not yet wired by any writer (no
  // conversation-creation flow currently offers a Chain Selector step; see
  // VERI_CHAT_GOVERNANCE.md's §5 for why that's deferred, not built here).
  dynamicChainId: text('dynamic_chain_id'),
  // Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1 item 2): both
  // independent studies (Study_by_Claude.md CSV 206, Study_by_zaizlm5.2.md
  // §3.1) flagged conversations as having no state-machine columns at all --
  // additive only, nothing writes to these yet. `currentState`/`previousState`
  // are free-text on purpose (not an enum) since no state taxonomy has been
  // designed/agreed yet -- adding a real state machine is Phase 2+ work, this
  // just gives it somewhere to land without a second migration later.
  currentState: text('current_state'),
  previousState: text('previous_state'),
  workflowId: text('workflow_id'),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'completed' | 'archived'
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
  // Wave 116 (PROJEXA Schedule/Gantt): additive, defaults to 0/unused for
  // every non-construction org -- the frappe-gantt (MIT) UI and delay
  // computation (dueDate vs the moment status enters a "completed" group)
  // both read this; it's set by the service layer on update, not derived.
  completionPercentage: integer('completion_percentage').notNull().default(0),
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
  // Wave 116 (PROJEXA Schedule/Gantt): nullable finish-to-start-plus-lag
  // days for 'blocks'/'blocked_by' relations, which is what frappe-gantt's
  // dependency lines natively support. Meaningless for
  // 'duplicates'/'relates_to' -- left null there, never enforced by a CHECK.
  lagDays: integer('lag_days'),
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

// ─── PMS Scheduling (Wave 140, PROJEXA gap analysis: Gantt/critical-path/
// baseline/resource-leveling parity with Asana/Monday/MS Project). Pure
// additive layer over the existing pms_issues + pms_issue_relations graph
// (start/due dates, completion%, typed blocks/blocked_by relations with
// lagDays already existed from Wave 25/116) -- critical-path is a stateless
// computation in schedule-service.ts, not stored here. Only baselines
// (a frozen snapshot, since "vs actual" needs something fixed to compare
// against) and resource allocations (planned capacity, distinct from
// pms_time_entries' already-spent hours) need real tables. ─────────────────
export const pmsScheduleBaselines = complianceSchemaDB.table('pms_schedule_baselines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  capturedById: text('captured_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsBaselineIssueSnapshots = complianceSchemaDB.table('pms_baseline_issue_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  baselineId: text('baseline_id').notNull(),
  issueId: text('issue_id').notNull(),
  baselineStartDate: date('baseline_start_date', { mode: 'string' }),
  baselineDueDate: date('baseline_due_date', { mode: 'string' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Planned allocation, not actual hours (pms_time_entries already owns
// actuals) -- lets a workload view sum allocatedHoursPerDay across every
// person's active date ranges and flag over-allocation against a capacity
// ceiling, independent of whether time has actually been logged yet.
export const pmsResourceAllocations = complianceSchemaDB.table('pms_resource_allocations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  userId: text('user_id').notNull(),
  issueId: text('issue_id'), // nullable -- a blanket project-level allocation when not tied to one issue
  allocatedHoursPerDay: numeric('allocated_hours_per_day').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const pmsScheduleBaselinesRelations = relations(pmsScheduleBaselines, ({ many }) => ({
  snapshots: many(pmsBaselineIssueSnapshots),
}))

export const pmsBaselineIssueSnapshotsRelations = relations(pmsBaselineIssueSnapshots, ({ one }) => ({
  baseline: one(pmsScheduleBaselines, { fields: [pmsBaselineIssueSnapshots.baselineId], references: [pmsScheduleBaselines.id] }),
  issue: one(pmsIssues, { fields: [pmsBaselineIssueSnapshots.issueId], references: [pmsIssues.id] }),
}))

export const pmsResourceAllocationsRelations = relations(pmsResourceAllocations, ({ one }) => ({
  project: one(projects, { fields: [pmsResourceAllocations.projectId], references: [projects.id] }),
  issue: one(pmsIssues, { fields: [pmsResourceAllocations.issueId], references: [pmsIssues.id] }),
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
  // Wave 144 (VERIDIAN.docx joint implementation plan, Phase 1 items 5-6):
  // both independent studies flagged that FDE discarded every candidate but
  // the #1 match. topCandidates stores the full ranked list (entityType/
  // entityId/score/label) findSimilarCapabilities() already computed, so a
  // future UI can show "here's what else looked close" instead of a single
  // verdict. reuseLevel makes the actual reuse tier explicit/auditable:
  // 'exact_match' (embedding score cleared HIGH_CONFIDENCE_THRESHOLD, zero
  // LLM calls), 'llm_assisted_match' (LLM picked an existing capability from
  // the candidate list), or 'new_proposal' (no existing capability covered
  // it). Both additive/nullable -- existing rows are simply unset.
  topCandidates: jsonb('top_candidates'),
  reuseLevel: text('reuse_level'), // 'exact_match' | 'llm_assisted_match' | 'new_proposal'
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
  // Wave 75 (CRM Intelligence, AI_OS_CERTIFICATION.md §3.3 NOT_BUILT):
  // additive AI enrichment over this lead's own structured fields (source/
  // status/contact completeness/age) -- all nullable, a lead never scored
  // just shows nothing, same pattern as Wave 74's meeting AI columns.
  aiScore: integer('ai_score'), // 0-100
  aiScoreReasoning: text('ai_score_reasoning'),
  aiRecommendedAction: text('ai_recommended_action'),
  aiScoredAt: timestamp('ai_scored_at'),
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
  // Wave 75 (CRM Intelligence): same pattern as crmLeads above.
  aiWinProbability: integer('ai_win_probability'), // 0-100
  aiRiskFactors: jsonb('ai_risk_factors').notNull().default([]), // string[]
  aiRecommendedAction: text('ai_recommended_action'),
  aiAnalyzedAt: timestamp('ai_analyzed_at'),
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
  // Wave 68: nullable -- which erp_income_tax_slabs record (regime) this
  // employee has opted into for annual TDS projection. No slab assigned
  // means payroll keeps Wave 56's original manual-TDS-entry-only behavior.
  incomeTaxSlabId: text('income_tax_slab_id'),
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
  // Wave 81 (Customer Service enhancements, COMPARISON_CSV_GAP_ANALYSIS.md
  // backlog #2): nullable link to the installed product this ticket concerns.
  installedProductId: text('installed_product_id'),
})

// ─── Wave 81 (Customer Service enhancements) ──────────────────────────────
// Installed-product/warranty tracking -- a customer's purchased/deployed
// product instance, so tickets can reference "which unit" rather than only
// "which client."
export const installedProducts = complianceSchemaDB.table('installed_products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  productName: text('product_name').notNull(),
  serialNumber: text('serial_number'),
  installedAt: date('installed_at', { mode: 'string' }),
  warrantyExpiresAt: date('warranty_expires_at', { mode: 'string' }),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Post-resolution CSAT (1-5) / NPS (0-10) survey -- submitted by the
// customer via the same guest-chat token their ticket already uses (Wave
// 36/39), not a new token mechanism. One row per submission; a ticket
// could in principle be re-surveyed, so this is append-only, not unique-
// per-ticket.
export const ticketSatisfactionSurveys = complianceSchemaDB.table('ticket_satisfaction_surveys', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  ticketId: text('ticket_id').notNull(),
  csatScore: integer('csat_score'), // 1-5, nullable -- a submission can be NPS-only or CSAT-only
  npsScore: integer('nps_score'), // 0-10
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Field-service dispatch -- an on-site visit scheduled against a ticket.
export const fieldServiceDispatches = complianceSchemaDB.table('field_service_dispatches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  ticketId: text('ticket_id').notNull(),
  technicianUserId: text('technician_user_id'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  status: text('status').notNull().default('scheduled'), // 'scheduled'|'en_route'|'completed'|'cancelled'
  addressText: text('address_text'),
  completedAt: timestamp('completed_at'),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Problem management / RCA grouping (ITIL-style) -- a single underlying
// root cause that may manifest as several separate tickets, tracked as its
// own record rather than duplicating root-cause notes on every ticket.
export const problemRecords = complianceSchemaDB.table('problem_records', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  rootCause: text('root_cause'),
  status: text('status').notNull().default('open'), // 'open'|'investigating'|'resolved'
  createdById: text('created_by_id'),
  resolvedAt: timestamp('resolved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const problemTickets = complianceSchemaDB.table('problem_tickets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  problemId: text('problem_id').notNull(),
  ticketId: text('ticket_id').notNull(),
  linkedAt: timestamp('linked_at').notNull().defaultNow(),
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
  // Wave 74 (Meeting Intelligence, AI_OS_CERTIFICATION.md §3.2 NOT_BUILT):
  // a real LLM extraction over `minutes`, run automatically (non-blocking,
  // best-effort) when a meeting with real minutes is published, and
  // re-runnable manually via a dedicated route. All 4 columns nullable/
  // empty-default -- a meeting published before this wave, or one whose
  // generation failed/was never triggered, just shows nothing, exactly like
  // every other "AI enrichment of existing human-entered data" column this
  // codebase already has (e.g. documents.extractedData).
  aiSummary: text('ai_summary'),
  aiKeyDecisions: jsonb('ai_key_decisions').notNull().default([]), // string[]
  aiSuggestedActionItems: jsonb('ai_suggested_action_items').notNull().default([]), // { title, assignee: string | null, dueDateHint: string | null }[] -- suggestions only, never auto-created as real tasks
  aiGeneratedAt: timestamp('ai_generated_at'),
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

// ─── VERI ERP (Wave 49) ────────────────────────────────────────────────────
// New 'erp' product branch (see product_branches seed row) -- VERIDIAN's
// third opt-in branch after 'grc' and 'pms', reusing the existing
// org_product_branch_enablements table (Wave 25) as-is, since it's already
// branch-agnostic (keyed by product_branch_id, not hardcoded to one
// branch). Adapted from studying frappe/erpnext's real doctype shapes
// (Account, Journal Entry, Sales/Purchase Invoice, Asset) -- never their
// code, never their AI -- scoped per the user's explicit decision: a
// "Broader ERP core" (Accounting + Assets + basic Buying/Selling/Stock),
// deliberately excluding Manufacturing, Quality Management, and the
// vertical-specific modules (Healthcare/Education/Agriculture/Non-profit),
// none of which fit a CA firm/legal firm/consultant's own business. This
// wave is schema-only, per the user's explicit "scaffold every chosen
// module's schema now, build logic incrementally afterward" build-order
// decision -- no service layer or UI ships in this pass.

// --- Enums ---
// root_type is the one field real financial-statement logic must switch on
// (Balance Sheet vs P&L classification) -- kept as an enum. account_type
// (bank/receivable/payable/stock/etc) is deliberately free text, matching
// this codebase's own precedent (pmsTimeEntries.activityType) for
// admin-extensible classification that doesn't need a schema migration to
// add a new value.
export const erpAccountRootTypeEnum = complianceSchemaDB.enum('erp_account_root_type', ['asset', 'liability', 'equity', 'income', 'expense'])
export const erpJournalEntryStatusEnum = complianceSchemaDB.enum('erp_journal_entry_status', ['draft', 'submitted', 'cancelled'])
export const erpInvoiceStatusEnum = complianceSchemaDB.enum('erp_invoice_status', ['draft', 'submitted', 'partially_paid', 'paid', 'overdue', 'cancelled'])
export const erpPaymentTypeEnum = complianceSchemaDB.enum('erp_payment_type', ['receive', 'pay'])
export const erpPartyTypeEnum = complianceSchemaDB.enum('erp_party_type', ['customer', 'supplier'])
export const erpAssetStatusEnum = complianceSchemaDB.enum('erp_asset_status', ['draft', 'submitted', 'in_use', 'disposed', 'scrapped'])
export const erpDepreciationMethodEnum = complianceSchemaDB.enum('erp_depreciation_method', ['straight_line', 'written_down_value'])

// --- Accounting (foundation -- everything else eventually posts a
// journal entry into this chart of accounts) ---

// Chart of accounts, tree-shaped via parentAccountId self-FK -- matches
// this codebase's existing pmsIssues.parentIssueId / projects.parentProjectId
// self-FK convention rather than Frappe's nested-set lft/rgt columns.
export const erpAccounts = complianceSchemaDB.table('erp_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  accountName: text('account_name').notNull(),
  accountNumber: text('account_number'),
  parentAccountId: text('parent_account_id'),
  rootType: erpAccountRootTypeEnum('root_type').notNull(),
  accountType: text('account_type'), // free text: 'bank'|'cash'|'receivable'|'payable'|'stock'|'fixed_asset'|'tax'|... -- admin-extensible
  isGroup: boolean('is_group').notNull().default(false),
  currencyId: text('currency_id'),
  isFrozen: boolean('is_frozen').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpFiscalYears = complianceSchemaDB.table('erp_fiscal_years', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  yearName: text('year_name').notNull(),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  isClosed: boolean('is_closed').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpCurrencies = complianceSchemaDB.table('erp_currencies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  code: text('code').notNull(), // ISO 4217, e.g. 'INR' | 'USD'
  name: text('name').notNull(),
  symbol: text('symbol'),
  isBaseCurrency: boolean('is_base_currency').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpExchangeRates = complianceSchemaDB.table('erp_exchange_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  fromCurrencyId: text('from_currency_id').notNull(),
  toCurrencyId: text('to_currency_id').notNull(),
  rate: numeric('rate').notNull(),
  rateDate: date('rate_date', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpBankAccounts = complianceSchemaDB.table('erp_bank_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  accountName: text('account_name').notNull(),
  bankName: text('bank_name'),
  accountNumber: text('account_number'),
  ifscOrSwift: text('ifsc_or_swift'),
  currencyId: text('currency_id'),
  glAccountId: text('gl_account_id'), // links to erp_accounts -- this bank account's balance-sheet account
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpTaxTemplates = complianceSchemaDB.table('erp_tax_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  isSalesTax: boolean('is_sales_tax').notNull().default(false),
  isPurchaseTax: boolean('is_purchase_tax').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpTaxTemplateItems = complianceSchemaDB.table('erp_tax_template_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  taxTemplateId: text('tax_template_id').notNull(),
  taxAccountId: text('tax_account_id').notNull(), // links to erp_accounts (a liability/tax-payable account)
  rate: numeric('rate').notNull(), // percentage, e.g. 18 for 18% GST
  description: text('description'),
})

export const erpJournalEntries = complianceSchemaDB.table('erp_journal_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  entryNumber: integer('entry_number').notNull(), // per-org sequence
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  // Polymorphic source-document link -- 'sales_invoice'|'purchase_invoice'|
  // 'payment_entry'|'asset_depreciation'|'manual' -- mirrors this codebase's
  // existing polymorphic contextEntityType/contextEntityId convention
  // (conversations, veriMeetings) rather than a new junction table per source type.
  referenceType: text('reference_type'),
  referenceId: text('reference_id'),
  userRemark: text('user_remark'),
  isOpeningEntry: boolean('is_opening_entry').notNull().default(false),
  status: erpJournalEntryStatusEnum('status').notNull().default('draft'),
  totalDebit: numeric('total_debit').notNull().default('0'),
  totalCredit: numeric('total_credit').notNull().default('0'),
  // Wave 67: nullable link to erp_companies -- null means "no company
  // subdivision" (a single-entity org, unchanged behavior for every entry
  // created before this wave). Financial reports filter/consolidate by
  // walking the company tree from this stamp, never by re-deriving it
  // from the accounts touched (accounts are shared across companies).
  companyId: text('company_id'),
  createdById: text('created_by_id'),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpJournalEntryLines = complianceSchemaDB.table('erp_journal_entry_lines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  journalEntryId: text('journal_entry_id').notNull(),
  accountId: text('account_id').notNull(),
  partyType: erpPartyTypeEnum('party_type'),
  partyId: text('party_id'), // polymorphic -- erp_customers.id or erp_suppliers.id depending on partyType
  debit: numeric('debit').notNull().default('0'),
  credit: numeric('credit').notNull().default('0'),
  costCenter: text('cost_center'), // legacy free-text tag, kept for existing rows
  costCenterId: text('cost_center_id'), // Wave 52: real dimension FK -> erp_cost_centers, additive alongside the legacy text field
  clientId: text('client_id'), // nullable -- client-billable entries link back to VERIDIAN's own clients table
  remark: text('remark'),
  // Wave 66: debit/credit above remain the ALWAYS-populated base-currency
  // amounts -- the single source of truth every financial report already
  // sums, never redefined. These 4 columns are an optional transaction-
  // currency audit trail, populated only when this line originates from a
  // non-base-currency document (e.g. a foreign-currency sales/purchase
  // invoice): currencyId (-> erp_currencies), the exchangeRate applied at
  // posting time, and the as-entered debit/credit in that currency before
  // conversion to base.
  currencyId: text('currency_id'),
  exchangeRate: numeric('exchange_rate'),
  debitInCurrency: numeric('debit_in_currency'),
  creditInCurrency: numeric('credit_in_currency'),
})

export const erpPaymentEntries = complianceSchemaDB.table('erp_payment_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  paymentType: erpPaymentTypeEnum('payment_type').notNull(),
  partyType: erpPartyTypeEnum('party_type').notNull(),
  partyId: text('party_id').notNull(),
  paidAmount: numeric('paid_amount').notNull().default('0'),
  receivedAmount: numeric('received_amount').notNull().default('0'),
  bankAccountId: text('bank_account_id'),
  referenceNo: text('reference_no'),
  referenceDate: date('reference_date', { mode: 'string' }),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: erpJournalEntryStatusEnum('status').notNull().default('draft'),
  journalEntryId: text('journal_entry_id'), // set once posted to the GL
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSalesInvoices = complianceSchemaDB.table('erp_sales_invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // nullable link to VERIDIAN's own clients, when this customer is also a compliance client
  customerId: text('customer_id').notNull(),
  invoiceNumber: integer('invoice_number').notNull(), // per-org sequence
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  currencyId: text('currency_id'),
  // currencyId (above) was Wave 49 schema-only scaffolding with zero
  // consumer until now. Wave 66 wires it: when set, subtotal/taxAmount/
  // grandTotal/outstandingAmount below are in THIS transaction currency
  // (unchanged meaning for the common case where currencyId is null --
  // those amounts are simply the org's base currency, exchangeRate 1, same
  // as every invoice created before this wave). exchangeRate is the
  // currencyId -> org-base-currency rate, snapshotted at invoice-creation
  // time (never re-fetched later, so a later rate change never rewrites a
  // submitted invoice's GL posting) -- submitSalesInvoice multiplies by it
  // to post the correct base-currency journal entry.
  exchangeRate: numeric('exchange_rate').notNull().default('1'),
  subtotal: numeric('subtotal').notNull().default('0'),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  grandTotal: numeric('grand_total').notNull().default('0'),
  outstandingAmount: numeric('outstanding_amount').notNull().default('0'),
  status: erpInvoiceStatusEnum('status').notNull().default('draft'),
  journalEntryId: text('journal_entry_id'), // set once posted to the GL
  salesOrderId: text('sales_order_id'),
  companyId: text('company_id'), // Wave 67: which erp_companies entity this invoice belongs to; nullable, propagated onto the posted journal entry at submit time
  // Wave 69: small pointer fields only -- the full e-invoicing detail
  // (payload/ack/signed response) lives in erp_e_invoice_logs below,
  // matching india-compliance's own separate-log-doctype pattern.
  irn: text('irn'),
  eInvoiceStatus: text('e_invoice_status'), // null (never attempted) | 'generated' | 'cancelled'
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  // Wave 120 (PROJEXA Revenue Report): nullable/additive -- lets a sales
  // invoice be attributed to one construction project. clientId alone
  // isn't precise enough (one client can have many projects).
  projectId: text('project_id'),
})

// Wave 69 (e-invoicing/IRN, per resilient-tech/india-compliance's
// e_invoice_log doctype as reference -- GPL-3.0, no code copied): lives
// in a SEPARATE log table, not fields bolted onto erp_sales_invoices
// directly, matching ERPNext/india-compliance's own separate-log-doctype
// pattern -- only a small pointer (irn/eInvoiceStatus, added to
// erpSalesInvoices below) links an invoice to its log rows. invoiceData
// stores the exact outbound IRP JSON payload for audit, regenerated by
// generateEInvoicePayload() and never mutated after creation. Real IRP
// submission requires GSP (GST Suvidha Provider) credentials this
// environment doesn't have -- markEInvoiceGenerated exists for an admin
// to record the IRP's response after submitting the payload through
// their own GSP integration, the same verification-boundary honesty as
// Wave 59's SSO (the mechanism and payload generation are built and
// proven; real government submission is untestable without real
// credentials).
export const erpEInvoiceLogs = complianceSchemaDB.table('erp_e_invoice_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  referenceType: text('reference_type').notNull().default('sales_invoice'),
  referenceId: text('reference_id').notNull(),
  status: text('status').notNull().default('draft'), // 'draft' (payload built, not yet submitted) | 'generated' | 'cancelled'
  invoiceData: jsonb('invoice_data'), // the exact outbound IRP JSON payload
  irn: text('irn'),
  ackNumber: text('ack_number'),
  ackDate: timestamp('ack_date'),
  signedInvoice: text('signed_invoice'), // the IRP's signed JSON response, once a real submission is recorded
  signedQrCode: text('signed_qr_code'),
  isGeneratedInSandbox: boolean('is_generated_in_sandbox').notNull().default(true),
  isCancelled: boolean('is_cancelled').notNull().default(false),
  cancelledAt: timestamp('cancelled_at'),
  cancelReasonCode: text('cancel_reason_code'),
  cancelRemark: text('cancel_remark'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSalesInvoiceItems = complianceSchemaDB.table('erp_sales_invoice_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  invoiceId: text('invoice_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
  taxTemplateId: text('tax_template_id'),
  // Wave 65: snapshotted from erp_items.hsn_sac_code at invoice-line-add
  // time, not looked up live at report time -- matching ERPNext's own
  // approach of copying the code onto the invoice line, since a later
  // change to an item's HSN/SAC must never silently rewrite a past
  // invoice's GST classification.
  hsnSacCode: text('hsn_sac_code'),
})

export const erpPurchaseInvoices = complianceSchemaDB.table('erp_purchase_invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  invoiceNumber: integer('invoice_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  currencyId: text('currency_id'),
  // See erpSalesInvoices' identical currencyId/exchangeRate comment (Wave 66).
  exchangeRate: numeric('exchange_rate').notNull().default('1'),
  subtotal: numeric('subtotal').notNull().default('0'),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  grandTotal: numeric('grand_total').notNull().default('0'),
  outstandingAmount: numeric('outstanding_amount').notNull().default('0'),
  status: erpInvoiceStatusEnum('status').notNull().default('draft'),
  journalEntryId: text('journal_entry_id'),
  // Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6): pre-existed since
  // an earlier wave but had zero writer (createPurchaseInvoice never set
  // it) until now -- when set, enables the three-way-match report against
  // the same PO's own items and receipts.
  purchaseOrderId: text('purchase_order_id'),
  companyId: text('company_id'), // see erpSalesInvoices' identical Wave 67 comment
  // Wave 68: computed and snapshotted at submit time (never re-derived
  // later), matching this codebase's snapshot-at-transaction-time
  // discipline -- a later change to the supplier's withholding category
  // or rate must never silently rewrite a past invoice's TDS.
  tdsAmount: numeric('tds_amount').notNull().default('0'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpPurchaseInvoiceItems = complianceSchemaDB.table('erp_purchase_invoice_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  invoiceId: text('invoice_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
  taxTemplateId: text('tax_template_id'),
  hsnSacCode: text('hsn_sac_code'), // Wave 65 -- see erp_sales_invoice_items' identical field for the snapshotting rationale
  purchaseOrderItemId: text('purchase_order_item_id'), // Wave 85 -- nullable, see erp_purchase_invoices.purchaseOrderId
})

// --- Assets ---

export const erpAssetCategories = complianceSchemaDB.table('erp_asset_categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  categoryName: text('category_name').notNull(),
  defaultDepreciationMethod: erpDepreciationMethodEnum('default_depreciation_method').notNull().default('straight_line'),
  defaultUsefulLifeMonths: integer('default_useful_life_months'),
  assetAccountId: text('asset_account_id'),
  depreciationExpenseAccountId: text('depreciation_expense_account_id'),
  accumulatedDepreciationAccountId: text('accumulated_depreciation_account_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpFixedAssets = complianceSchemaDB.table('erp_fixed_assets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  assetName: text('asset_name').notNull(),
  assetCategoryId: text('asset_category_id').notNull(),
  departmentId: text('department_id'), // nullable link to VERIDIAN's existing departments table
  custodianUserId: text('custodian_user_id'),
  location: text('location'),
  purchaseDate: date('purchase_date', { mode: 'string' }).notNull(),
  purchaseCost: numeric('purchase_cost').notNull(),
  depreciationMethod: erpDepreciationMethodEnum('depreciation_method').notNull().default('straight_line'),
  usefulLifeMonths: integer('useful_life_months'),
  salvageValue: numeric('salvage_value').notNull().default('0'),
  status: erpAssetStatusEnum('status').notNull().default('draft'),
  currentValue: numeric('current_value'),
  accumulatedDepreciation: numeric('accumulated_depreciation').notNull().default('0'),
  journalEntryId: text('journal_entry_id'), // the acquisition posting, once submitted
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpDepreciationSchedules = complianceSchemaDB.table('erp_depreciation_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assetId: text('asset_id').notNull(),
  scheduleDate: date('schedule_date', { mode: 'string' }).notNull(),
  depreciationAmount: numeric('depreciation_amount').notNull(),
  accumulatedDepreciationAfter: numeric('accumulated_depreciation_after').notNull(),
  isPosted: boolean('is_posted').notNull().default(false),
  journalEntryId: text('journal_entry_id'),
})

export const erpAssetMovements = complianceSchemaDB.table('erp_asset_movements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assetId: text('asset_id').notNull(),
  movementDate: date('movement_date', { mode: 'string' }).notNull(),
  fromLocation: text('from_location'),
  toLocation: text('to_location'),
  fromCustodianId: text('from_custodian_id'),
  toCustodianId: text('to_custodian_id'),
  purpose: text('purpose'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpAssetDisposals = complianceSchemaDB.table('erp_asset_disposals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  assetId: text('asset_id').notNull(),
  disposalDate: date('disposal_date', { mode: 'string' }).notNull(),
  disposalType: text('disposal_type').notNull(), // 'sale' | 'scrap'
  saleValue: numeric('sale_value'),
  journalEntryId: text('journal_entry_id'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// --- Buying ---

export const erpSuppliers = complianceSchemaDB.table('erp_suppliers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierName: text('supplier_name').notNull(),
  supplierType: text('supplier_type'),
  gstin: text('gstin'),
  panNumber: text('pan_number'),
  defaultPaymentTermsDays: integer('default_payment_terms_days'),
  vendorRiskProfileId: text('vendor_risk_profile_id'), // nullable link to VERIDIAN's existing vendor_risk_profiles (Third-Party & ESG module)
  taxWithholdingCategoryId: text('tax_withholding_category_id'), // Wave 68: nullable -- assigns this supplier a default TDS category; no category means no withholding is ever computed for their invoices
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Wave 80 (Vendor Master enhancements): denormalized caches of the latest
  // erp_supplier_qualifications / erp_supplier_sanction_checks row, maintained
  // by the service layer -- matches this codebase's assignee-cache convention.
  qualificationStatus: text('qualification_status').notNull().default('not_started'), // 'not_started'|'in_review'|'qualified'|'rejected'
  sanctionScreeningStatus: text('sanction_screening_status').notNull().default('not_checked'), // 'not_checked'|'clear'|'flagged'
  sanctionScreenedAt: timestamp('sanction_screened_at'),
  // Wave 84: the credit line this supplier extends to us -- nullable, no
  // limit enforced when unset. Checked against total outstanding AP at
  // purchase-invoice-submit time, see erp-invoicing-service.ts's
  // submitPurchaseInvoice.
  creditLimit: numeric('credit_limit'),
  // Wave 120 (PROJEXA Vendor Master enhancement): both nullable/additive --
  // every non-construction org leaves them unused. trade is free text
  // (civil/electrical/painter/carpenter/plumber/POP/tiles etc.), matching
  // constructionLabourRoster.trade's precedent, not an enum (new trades
  // keep appearing). projectId is a single primary-project convenience
  // link for subcontractor-type suppliers tied to one job; a supplier
  // working multiple projects is still discoverable via
  // constructionLabourRoster.vendorId or erpPurchaseInvoices, this is not
  // the only path.
  trade: text('trade'),
  projectId: text('project_id'),
})

// Wave 80 (Vendor Master enhancements, COMPARISON_CSV_GAP_ANALYSIS.md backlog
// #1). KYC document tracking deliberately has no table here -- it reuses the
// existing polymorphic `documents` table (linkedEntityType='erp_supplier'),
// per that table's own established cross-module linking convention.
export const erpSupplierBankAccounts = complianceSchemaDB.table('erp_supplier_bank_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  accountHolderName: text('account_holder_name').notNull(),
  bankName: text('bank_name').notNull(),
  // pgcrypto-encrypted at rest via src/lib/ai-config-crypto.ts's existing
  // encrypt/decrypt helpers (same AI_CONFIG_ENCRYPTION_KEY mechanism) --
  // Drizzle can't type a pgp_sym_encrypt round-trip, see that file's own
  // comment on why this goes through raw SQL, same as embeddings/ai_configurations.
  accountNumberEncrypted: text('account_number_encrypted').notNull(),
  accountNumberLast4: text('account_number_last4').notNull(),
  ifscCode: text('ifsc_code'),
  accountType: text('account_type').notNull().default('savings'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Append-only qualification review audit trail -- erpSuppliers.qualificationStatus
// caches the latest row's status.
export const erpSupplierQualifications = complianceSchemaDB.table('erp_supplier_qualifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  status: text('status').notNull(), // 'in_review'|'qualified'|'rejected'
  criteria: jsonb('criteria').notNull().default({}),
  score: numeric('score'),
  notes: text('notes'),
  reviewedById: text('reviewed_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Append-only sanction/blacklist screening log -- a human records the
// outcome of a check performed against an external list (UN/OFAC/RBI
// caution list/etc). This environment has no live sanctions-API
// integration, so this is a real screening-log data model and workflow,
// not an automated live check (same verification-boundary honesty as
// SSO/e-invoicing/embeddings elsewhere in this codebase).
export const erpSupplierSanctionChecks = complianceSchemaDB.table('erp_supplier_sanction_checks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  checkedById: text('checked_by_id'),
  listsChecked: jsonb('lists_checked').notNull().default([]), // e.g. ["UN Consolidated List", "OFAC SDN", "RBI Caution List"]
  matchFound: boolean('match_found').notNull().default(false),
  matchDetails: text('match_details'),
  resultStatus: text('result_status').notNull(), // 'clear'|'flagged'|'blocked'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Vendor self-service portal: tokenized, time-limited, individually
// revocable -- identical shape to conversationShareLinks (Wave 36).
export const erpSupplierPortalLinks = complianceSchemaDB.table('erp_supplier_portal_links', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  token: text('token').notNull().unique(),
  createdById: text('created_by_id'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPurchaseOrders = complianceSchemaDB.table('erp_purchase_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  poNumber: integer('po_number').notNull(), // per-org sequence
  orderDate: date('order_date', { mode: 'string' }).notNull(),
  expectedDeliveryDate: date('expected_delivery_date', { mode: 'string' }),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'|'partially_received'|'completed'|'cancelled'
  grandTotal: numeric('grand_total').notNull().default('0'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpPurchaseOrderItems = complianceSchemaDB.table('erp_purchase_order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  purchaseOrderId: text('purchase_order_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
  receivedQuantity: numeric('received_quantity').notNull().default('0'),
})

export const erpPurchaseReceipts = complianceSchemaDB.table('erp_purchase_receipts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  purchaseOrderId: text('purchase_order_id'),
  receiptNumber: integer('receipt_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'|'cancelled'
  // Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6): putaway is a
  // separate confirmation step after physical receipt -- goods land at a
  // receiving dock (the warehouse set on each item at receipt time), then
  // get moved to their final bin. Bins are leaf nodes in the existing
  // erp_warehouses tree (parentWarehouseId), matching ERPNext's own
  // warehouse-as-location convention -- no separate Bin table.
  putawayStatus: text('putaway_status').notNull().default('pending'), // 'pending'|'completed'
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPurchaseReceiptItems = complianceSchemaDB.table('erp_purchase_receipt_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  receiptId: text('receipt_id').notNull(),
  purchaseOrderItemId: text('purchase_order_item_id'),
  itemId: text('item_id'),
  quantity: numeric('quantity').notNull().default('1'),
  warehouseId: text('warehouse_id'),
  // Wave 85: nullable -- falls back to the linked PO item's rate when
  // submitted (see submitPurchaseReceipt), only needed here for a receipt
  // line with no PO reference at all.
  rate: numeric('rate'),
})

// ─── Wave 85 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #6): landed cost ──────
// allocation. Additional charges (freight/customs/insurance/handling) on a
// submitted purchase receipt are allocated across its line items by
// received value (ERPNext's own default allocation method) and bumped into
// each item's FIFO valuation layer rate -- future stock issues draw the
// true landed cost. Does NOT retroactively rewrite erp_stock_ledger_entries'
// running balanceValue history (a full revaluation cascade, out of scope
// for this pass) -- an explicit, disclosed boundary, not a silent gap.
export const erpLandedCostVouchers = complianceSchemaDB.table('erp_landed_cost_vouchers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  purchaseReceiptId: text('purchase_receipt_id').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpLandedCostCharges = complianceSchemaDB.table('erp_landed_cost_charges', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  voucherId: text('voucher_id').notNull(),
  expenseType: text('expense_type').notNull(), // 'freight'|'customs'|'insurance'|'handling'|'other'
  amount: numeric('amount').notNull(),
  description: text('description'),
})

export const erpLandedCostAllocations = complianceSchemaDB.table('erp_landed_cost_allocations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  voucherId: text('voucher_id').notNull(),
  receiptItemId: text('receipt_item_id').notNull(),
  allocatedAmount: numeric('allocated_amount').notNull(),
})

// --- Selling ---

export const erpCustomers = complianceSchemaDB.table('erp_customers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerName: text('customer_name').notNull(),
  clientId: text('client_id'), // nullable -- usually the same entity as a compliance client, but not required
  gstin: text('gstin'),
  panNumber: text('pan_number'),
  defaultPaymentTermsDays: integer('default_payment_terms_days'),
  // Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): nullable -- no limit
  // enforced when unset (every customer seeded before this wave). Checked
  // against total outstanding AR at sales-invoice-submit time, see
  // erp-invoicing-service.ts's submitSalesInvoice.
  creditLimit: numeric('credit_limit'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Wave 84: polymorphic multiple-addresses/contacts, matching the `documents`
// table's own linkedEntityType/linkedEntityId convention (Wave 61) rather
// than adding a parallel customer-only and supplier-only pair of tables.
export const erpAddresses = complianceSchemaDB.table('erp_addresses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  linkedEntityType: text('linked_entity_type').notNull(), // 'erp_customer'|'erp_supplier'
  linkedEntityId: text('linked_entity_id').notNull(),
  addressType: text('address_type').notNull().default('billing'), // 'billing'|'shipping'|'other'
  line1: text('line1').notNull(),
  line2: text('line2'),
  city: text('city'),
  state: text('state'),
  postalCode: text('postal_code'),
  country: text('country'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpContacts = complianceSchemaDB.table('erp_contacts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  linkedEntityType: text('linked_entity_type').notNull(), // 'erp_customer'|'erp_supplier'
  linkedEntityId: text('linked_entity_id').notNull(),
  contactName: text('contact_name').notNull(),
  designation: text('designation'),
  email: text('email'),
  phone: text('phone'),
  isPrimary: boolean('is_primary').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpQuotations = complianceSchemaDB.table('erp_quotations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id'),
  leadId: text('lead_id'), // nullable link to VERIDIAN's existing crm_leads -- a quotation can precede a formal customer
  quotationNumber: integer('quotation_number').notNull(),
  quotationDate: date('quotation_date', { mode: 'string' }).notNull(),
  validTill: date('valid_till', { mode: 'string' }),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'|'ordered'|'lost'|'expired'
  grandTotal: numeric('grand_total').notNull().default('0'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpQuotationItems = complianceSchemaDB.table('erp_quotation_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quotationId: text('quotation_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
})

export const erpSalesOrders = complianceSchemaDB.table('erp_sales_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id').notNull(),
  opportunityId: text('opportunity_id'), // nullable link to VERIDIAN's existing crm_opportunities -- a "won" opportunity flows into a sales order
  quotationId: text('quotation_id'),
  soNumber: integer('so_number').notNull(),
  orderDate: date('order_date', { mode: 'string' }).notNull(),
  deliveryDate: date('delivery_date', { mode: 'string' }),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'|'partially_delivered'|'completed'|'cancelled'
  grandTotal: numeric('grand_total').notNull().default('0'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpSalesOrderItems = complianceSchemaDB.table('erp_sales_order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  salesOrderId: text('sales_order_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
  deliveredQuantity: numeric('delivered_quantity').notNull().default('0'),
})

export const erpDeliveryNotes = complianceSchemaDB.table('erp_delivery_notes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id').notNull(),
  salesOrderId: text('sales_order_id'),
  deliveryNumber: integer('delivery_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'|'cancelled'
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpDeliveryNoteItems = complianceSchemaDB.table('erp_delivery_note_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  deliveryNoteId: text('delivery_note_id').notNull(),
  salesOrderItemId: text('sales_order_item_id'),
  itemId: text('item_id'),
  quantity: numeric('quantity').notNull().default('1'),
  warehouseId: text('warehouse_id'),
})

// --- Basic Stock/Inventory ---

export const erpWarehouses = complianceSchemaDB.table('erp_warehouses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  warehouseName: text('warehouse_name').notNull(),
  parentWarehouseId: text('parent_warehouse_id'), // self-FK -- tree, same convention as erp_accounts
  isGroup: boolean('is_group').notNull().default(false),
  address: text('address'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpItemGroups = complianceSchemaDB.table('erp_item_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  groupName: text('group_name').notNull(),
  parentGroupId: text('parent_group_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpItems = complianceSchemaDB.table('erp_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemCode: text('item_code').notNull(),
  itemName: text('item_name').notNull(),
  itemGroupId: text('item_group_id'),
  uom: text('uom'), // unit of measure, free text e.g. 'Nos' | 'Kg' | 'Hour'
  isStockItem: boolean('is_stock_item').notNull().default(true), // false for pure services -- no stock ledger entries
  isSalesItem: boolean('is_sales_item').notNull().default(true),
  isPurchaseItem: boolean('is_purchase_item').notNull().default(true),
  standardSellingRate: numeric('standard_selling_rate'),
  standardBuyingRate: numeric('standard_buying_rate'),
  isActive: boolean('is_active').notNull().default(true),
  // Wave 57 (VERI ERP gap-fill, Tier 3 #12): opt-in flags -- most items
  // track neither; batch/serial rows are only created when these are set.
  hasBatchNo: boolean('has_batch_no').notNull().default(false),
  hasSerialNo: boolean('has_serial_no').notNull().default(false),
  // Wave 65 (India GST compliance gap-fill): HSN (goods) or SAC (services)
  // classification code -- required on GST invoices/returns above the
  // notified turnover threshold, which a Rs 1000cr company is well past.
  // Nullable since it's genuinely optional for non-stock/non-taxable items
  // and for orgs outside India, matching ERPNext's own Item.gst_hsn_code
  // field shape (a free-text code, not a foreign key -- the HSN/SAC master
  // list is a government-published code list, not org-editable data).
  hsnSacCode: text('hsn_sac_code'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Append-only, immutable ledger -- matches this codebase's audit-log
// philosophy (never UPDATE a posted stock movement, only append
// corrections as new entries).
export const erpStockLedgerEntries = complianceSchemaDB.table('erp_stock_ledger_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  voucherType: text('voucher_type').notNull(), // 'purchase_receipt'|'delivery_note'|'stock_reconciliation'
  voucherId: text('voucher_id').notNull(),
  quantityChange: numeric('quantity_change').notNull(), // always in the item's stock UOM -- the single source of truth for valuation
  valuationRate: numeric('valuation_rate').notNull().default('0'),
  balanceQty: numeric('balance_qty').notNull(),
  balanceValue: numeric('balance_value').notNull(),
  // Wave 57: as-entered UOM/qty when a receipt/issue was recorded in an
  // alternate UOM (e.g. "2 Box"), for display/traceability only --
  // quantityChange above is always already converted to stock UOM.
  transactionUom: text('transaction_uom'),
  transactionQty: numeric('transaction_qty'),
  // Batch/serial are traceability metadata on the movement, not a
  // per-batch FIFO redesign -- valuation continues at the item-warehouse
  // level (see erp-inventory-service.ts for the reasoning).
  batchId: text('batch_id'),
  serialId: text('serial_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Wave 120 (PROJEXA Material Consumption Report): nullable/additive --
  // attributes a stock movement to a construction project so material
  // issues/receipts can be summed per project, matching the
  // pmsIssues.completionPercentage precedent (Wave 116) for additive
  // construction-only columns on shared tables.
  projectId: text('project_id'),
})

export const erpStockReconciliations = complianceSchemaDB.table('erp_stock_reconciliations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: text('status').notNull().default('draft'), // 'draft'|'submitted'
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpStockReconciliationItems = complianceSchemaDB.table('erp_stock_reconciliation_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  reconciliationId: text('reconciliation_id').notNull(),
  itemId: text('item_id').notNull(),
  countedQty: numeric('counted_qty').notNull(),
  valuationRate: numeric('valuation_rate').notNull().default('0'),
  systemQty: numeric('system_qty'), // snapshot of the stock ledger balance at the time of reconciliation, for variance reporting
})

// --- Relations (query ergonomics for the most-traversed tables only,
// matching this codebase's own precedent of not adding a relations block
// for every single table) ---
export const erpAccountsRelations = relations(erpAccounts, ({ one, many }) => ({
  parentAccount: one(erpAccounts, { fields: [erpAccounts.parentAccountId], references: [erpAccounts.id], relationName: 'erpAccountTree' }),
  childAccounts: many(erpAccounts, { relationName: 'erpAccountTree' }),
}))

export const erpJournalEntriesRelations = relations(erpJournalEntries, ({ many }) => ({
  lines: many(erpJournalEntryLines),
}))

export const erpJournalEntryLinesRelations = relations(erpJournalEntryLines, ({ one }) => ({
  journalEntry: one(erpJournalEntries, { fields: [erpJournalEntryLines.journalEntryId], references: [erpJournalEntries.id] }),
  account: one(erpAccounts, { fields: [erpJournalEntryLines.accountId], references: [erpAccounts.id] }),
}))

export const erpFixedAssetsRelations = relations(erpFixedAssets, ({ one, many }) => ({
  category: one(erpAssetCategories, { fields: [erpFixedAssets.assetCategoryId], references: [erpAssetCategories.id] }),
  depreciationSchedules: many(erpDepreciationSchedules),
}))

export const erpDepreciationSchedulesRelations = relations(erpDepreciationSchedules, ({ one }) => ({
  asset: one(erpFixedAssets, { fields: [erpDepreciationSchedules.assetId], references: [erpFixedAssets.id] }),
}))

export const erpSalesInvoicesRelations = relations(erpSalesInvoices, ({ one, many }) => ({
  customer: one(erpCustomers, { fields: [erpSalesInvoices.customerId], references: [erpCustomers.id] }),
  items: many(erpSalesInvoiceItems),
}))

export const erpSalesInvoiceItemsRelations = relations(erpSalesInvoiceItems, ({ one }) => ({
  invoice: one(erpSalesInvoices, { fields: [erpSalesInvoiceItems.invoiceId], references: [erpSalesInvoices.id] }),
}))

export const erpPurchaseInvoicesRelations = relations(erpPurchaseInvoices, ({ one, many }) => ({
  supplier: one(erpSuppliers, { fields: [erpPurchaseInvoices.supplierId], references: [erpSuppliers.id] }),
  items: many(erpPurchaseInvoiceItems),
}))

export const erpPurchaseInvoiceItemsRelations = relations(erpPurchaseInvoiceItems, ({ one }) => ({
  invoice: one(erpPurchaseInvoices, { fields: [erpPurchaseInvoiceItems.invoiceId], references: [erpPurchaseInvoices.id] }),
}))

export const erpPurchaseOrdersRelations = relations(erpPurchaseOrders, ({ one, many }) => ({
  supplier: one(erpSuppliers, { fields: [erpPurchaseOrders.supplierId], references: [erpSuppliers.id] }),
  items: many(erpPurchaseOrderItems),
}))

export const erpPurchaseOrderItemsRelations = relations(erpPurchaseOrderItems, ({ one }) => ({
  purchaseOrder: one(erpPurchaseOrders, { fields: [erpPurchaseOrderItems.purchaseOrderId], references: [erpPurchaseOrders.id] }),
}))

// Wave 85: erp_purchase_receipts has existed since Wave 49 with no relations
// block at all (no prior service ever used Drizzle's relational `with:` on it).
export const erpPurchaseReceiptsRelations = relations(erpPurchaseReceipts, ({ one, many }) => ({
  supplier: one(erpSuppliers, { fields: [erpPurchaseReceipts.supplierId], references: [erpSuppliers.id] }),
  purchaseOrder: one(erpPurchaseOrders, { fields: [erpPurchaseReceipts.purchaseOrderId], references: [erpPurchaseOrders.id] }),
  items: many(erpPurchaseReceiptItems),
}))

export const erpPurchaseReceiptItemsRelations = relations(erpPurchaseReceiptItems, ({ one }) => ({
  receipt: one(erpPurchaseReceipts, { fields: [erpPurchaseReceiptItems.receiptId], references: [erpPurchaseReceipts.id] }),
  purchaseOrderItem: one(erpPurchaseOrderItems, { fields: [erpPurchaseReceiptItems.purchaseOrderItemId], references: [erpPurchaseOrderItems.id] }),
}))

export const erpLandedCostVouchersRelations = relations(erpLandedCostVouchers, ({ one, many }) => ({
  purchaseReceipt: one(erpPurchaseReceipts, { fields: [erpLandedCostVouchers.purchaseReceiptId], references: [erpPurchaseReceipts.id] }),
  charges: many(erpLandedCostCharges),
  allocations: many(erpLandedCostAllocations),
}))

export const erpLandedCostChargesRelations = relations(erpLandedCostCharges, ({ one }) => ({
  voucher: one(erpLandedCostVouchers, { fields: [erpLandedCostCharges.voucherId], references: [erpLandedCostVouchers.id] }),
}))

export const erpLandedCostAllocationsRelations = relations(erpLandedCostAllocations, ({ one }) => ({
  voucher: one(erpLandedCostVouchers, { fields: [erpLandedCostAllocations.voucherId], references: [erpLandedCostVouchers.id] }),
  receiptItem: one(erpPurchaseReceiptItems, { fields: [erpLandedCostAllocations.receiptItemId], references: [erpPurchaseReceiptItems.id] }),
}))

export const erpSalesOrdersRelations = relations(erpSalesOrders, ({ one, many }) => ({
  customer: one(erpCustomers, { fields: [erpSalesOrders.customerId], references: [erpCustomers.id] }),
  opportunity: one(crmOpportunities, { fields: [erpSalesOrders.opportunityId], references: [crmOpportunities.id] }),
  items: many(erpSalesOrderItems),
}))

export const erpSalesOrderItemsRelations = relations(erpSalesOrderItems, ({ one }) => ({
  salesOrder: one(erpSalesOrders, { fields: [erpSalesOrderItems.salesOrderId], references: [erpSalesOrders.id] }),
}))

export const erpQuotationsRelations = relations(erpQuotations, ({ one, many }) => ({
  customer: one(erpCustomers, { fields: [erpQuotations.customerId], references: [erpCustomers.id] }),
  lead: one(crmLeads, { fields: [erpQuotations.leadId], references: [crmLeads.id] }),
  items: many(erpQuotationItems),
}))

export const erpQuotationItemsRelations = relations(erpQuotationItems, ({ one }) => ({
  quotation: one(erpQuotations, { fields: [erpQuotationItems.quotationId], references: [erpQuotations.id] }),
}))

export const erpSuppliersRelations = relations(erpSuppliers, ({ one }) => ({
  vendorRiskProfile: one(vendorRiskProfiles, { fields: [erpSuppliers.vendorRiskProfileId], references: [vendorRiskProfiles.id] }),
}))

export const erpWarehousesRelations = relations(erpWarehouses, ({ one, many }) => ({
  parentWarehouse: one(erpWarehouses, { fields: [erpWarehouses.parentWarehouseId], references: [erpWarehouses.id], relationName: 'erpWarehouseTree' }),
  childWarehouses: many(erpWarehouses, { relationName: 'erpWarehouseTree' }),
}))

export const erpItemsRelations = relations(erpItems, ({ one }) => ({
  itemGroup: one(erpItemGroups, { fields: [erpItems.itemGroupId], references: [erpItemGroups.id] }),
}))

// ─── VERI ERP Wave 50: Accounting Periods ─────────────────────────────────
// Per ERP_BENCHMARK_COMPARISON.md Tier 1 #3 -- erpFiscalYears had no
// month-grain sub-entity at all, so nothing stopped posting into a
// "closed" year. This is the schema-level lock the financial-report
// service layer (below) needs to be trustworthy: a period must be 'open'
// for its date range before a journal entry can be submitted into it.
export const erpPeriodStatusEnum = complianceSchemaDB.enum('erp_period_status', ['open', 'closed'])

export const erpAccountingPeriods = complianceSchemaDB.table('erp_accounting_periods', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  fiscalYearId: text('fiscal_year_id').notNull(),
  periodName: text('period_name').notNull(), // e.g. "Apr 2026"
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }).notNull(),
  status: erpPeriodStatusEnum('status').notNull().default('open'),
  closedById: text('closed_by_id'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  // Wave 82 (Period Closing checklist workflow, COMPARISON_CSV_GAP_ANALYSIS.md
  // backlog #3): the formal sign-off step, distinct from closedAt/closedById --
  // a controller/CFO signs off once every checklist item is done, and
  // closePeriod() (erp-financial-report-service.ts) now REQUIRES both the
  // checklist to be fully completed and sign-off to have happened, turning
  // "closed" from a bare flag into the end of a real gated workflow.
  signedOffById: text('signed_off_by_id'),
  signedOffAt: timestamp('signed_off_at'),
})

export const erpAccountingPeriodsRelations = relations(erpAccountingPeriods, ({ one }) => ({
  fiscalYear: one(erpFiscalYears, { fields: [erpAccountingPeriods.fiscalYearId], references: [erpFiscalYears.id] }),
}))

// Per-period closing checklist -- accrual/provision/reconciliation/review
// tasks a real month-end close requires. A default set is seeded when a
// period is first accessed via the checklist API (seedDefaultChecklist()),
// and an org can add/remove items freely on top of that.
export const erpPeriodClosingChecklistItems = complianceSchemaDB.table('erp_period_closing_checklist_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  periodId: text('period_id').notNull(),
  title: text('title').notNull(),
  taskType: text('task_type').notNull().default('other'), // 'accrual'|'provision'|'reconciliation'|'review'|'other'
  status: text('status').notNull().default('pending'), // 'pending'|'completed'
  assignedToId: text('assigned_to_id'),
  completedById: text('completed_by_id'),
  completedAt: timestamp('completed_at'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPeriodClosingChecklistItemsRelations = relations(erpPeriodClosingChecklistItems, ({ one }) => ({
  period: one(erpAccountingPeriods, { fields: [erpPeriodClosingChecklistItems.periodId], references: [erpAccountingPeriods.id] }),
}))

// ─── VERI ERP Wave 51: Shared Approval Workflow Engine ────────────────────
// Per ERP_BENCHMARK_COMPARISON.md Section 7/10 -- the single
// highest-leverage cross-cutting gap: VERIDIAN already has two
// non-reusable single-purpose implementations of "needs approval"
// (approvalRequests -- single-step maker-checker; pmsWorkflowTransitions
// -- configurable but PMS-issue-only), plus every other module (GRC items,
// and now ERP journal entries/invoices/POs) hand-rolling its own
// draft/submitted/cancelled enum. Modeled on frappe/frappe's own
// Workflow/Workflow Transition/Workflow Action doctypes (read via GitHub
// for the *shape* only, never code or AI reused): an org can define one
// workflow per entityType, an ordered list of steps each gated by an
// approver role and an optional numeric condition (e.g. "grand_total >
// 100000"), and each step can require more than one approval (a quorum)
// rather than needing true parallel states -- simpler to reason about
// than a full state-machine library for what is fundamentally per-org
// *data*, not code, and this codebase's own hasRole()/logActivity()
// primitives already cover the role-gating and audit-trail pieces a
// heavier engine would otherwise have to reinvent.
export const erpWorkflowInstanceStatusEnum = complianceSchemaDB.enum('approval_workflow_instance_status', ['pending', 'approved', 'rejected', 'cancelled'])
export const erpWorkflowStepStatusEnum = complianceSchemaDB.enum('approval_workflow_step_status', ['pending', 'approved', 'rejected', 'skipped'])
export const erpWorkflowConditionOperatorEnum = complianceSchemaDB.enum('approval_workflow_condition_operator', ['gt', 'gte', 'lt', 'lte', 'eq'])

export const approvalWorkflowDefinitions = complianceSchemaDB.table('approval_workflow_definitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  entityType: text('entity_type').notNull(), // e.g. 'erp_journal_entry' | 'erp_purchase_order' | 'erp_sales_invoice'
  name: text('name').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const approvalWorkflowStepDefinitions = complianceSchemaDB.table('approval_workflow_step_definitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workflowDefinitionId: text('workflow_definition_id').notNull(),
  stepOrder: integer('step_order').notNull(),
  name: text('name').notNull(),
  approverRole: text('approver_role').notNull(), // matches this codebase's user_role enum values, stored as text (mirrors pmsWorkflowTransitions.role precedent)
  requiredApprovals: integer('required_approvals').notNull().default(1),
  conditionField: text('condition_field'), // nullable -- numeric field name on the entity payload, e.g. 'grandTotal'
  conditionOperator: erpWorkflowConditionOperatorEnum('condition_operator'),
  conditionValue: numeric('condition_value'),
})

export const approvalWorkflowInstances = complianceSchemaDB.table('approval_workflow_instances', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  workflowDefinitionId: text('workflow_definition_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  status: erpWorkflowInstanceStatusEnum('status').notNull().default('pending'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const approvalWorkflowStepInstances = complianceSchemaDB.table('approval_workflow_step_instances', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  workflowInstanceId: text('workflow_instance_id').notNull(),
  stepDefinitionId: text('step_definition_id').notNull(),
  stepOrder: integer('step_order').notNull(),
  approverRole: text('approver_role').notNull(),
  requiredApprovals: integer('required_approvals').notNull().default(1),
  approvalsReceived: integer('approvals_received').notNull().default(0),
  status: erpWorkflowStepStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const approvalWorkflowStepApprovals = complianceSchemaDB.table('approval_workflow_step_approvals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  stepInstanceId: text('step_instance_id').notNull(),
  approvedById: text('approved_by_id').notNull(),
  decision: text('decision').notNull(), // 'approved' | 'rejected'
  comment: text('comment'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const approvalWorkflowDefinitionsRelations = relations(approvalWorkflowDefinitions, ({ many }) => ({
  steps: many(approvalWorkflowStepDefinitions),
}))

export const approvalWorkflowStepDefinitionsRelations = relations(approvalWorkflowStepDefinitions, ({ one }) => ({
  workflow: one(approvalWorkflowDefinitions, { fields: [approvalWorkflowStepDefinitions.workflowDefinitionId], references: [approvalWorkflowDefinitions.id] }),
}))

export const approvalWorkflowInstancesRelations = relations(approvalWorkflowInstances, ({ one, many }) => ({
  workflow: one(approvalWorkflowDefinitions, { fields: [approvalWorkflowInstances.workflowDefinitionId], references: [approvalWorkflowDefinitions.id] }),
  steps: many(approvalWorkflowStepInstances),
}))

export const approvalWorkflowStepInstancesRelations = relations(approvalWorkflowStepInstances, ({ one, many }) => ({
  instance: one(approvalWorkflowInstances, { fields: [approvalWorkflowStepInstances.workflowInstanceId], references: [approvalWorkflowInstances.id] }),
  approvals: many(approvalWorkflowStepApprovals),
}))

export const approvalWorkflowStepApprovalsRelations = relations(approvalWorkflowStepApprovals, ({ one }) => ({
  step: one(approvalWorkflowStepInstances, { fields: [approvalWorkflowStepApprovals.stepInstanceId], references: [approvalWorkflowStepInstances.id] }),
}))

// ─── VERI ERP Wave 52: Cost Centers, Cash Management, Credit Notes ────────
// Per ERP_BENCHMARK_COMPARISON.md Tier 2 -- three of the ranked gaps,
// batched into one migration since each is additive and independent.

// Cost Centers: upgrades erpJournalEntryLines.costCenter from a free-text
// tag into a real dimension table (Tier 2 #4). Kept as a NEW nullable FK
// column alongside the existing text field rather than replacing it --
// additive, no breaking change to Wave 49 data.
// Wave 67 (multi-entity/consolidation): a Company is a legal entity WITHIN
// an org's ERP -- distinct from `organisations` above, which is the
// VERIDIAN tenant itself. Modeled on ERPNext's Company doctype (isGroup +
// parentCompanyId nested tree, abbr, defaultCurrencyId) but deliberately
// simpler: the chart of accounts (erp_accounts) is SHARED across an org's
// companies rather than cloned per-company, and consolidation is computed
// at report-runtime by walking this tree and aggregating erp_journal_
// entries of every company in the group -- there is no stored "group GL",
// matching ERPNext's own approach.
export const erpCompanies = complianceSchemaDB.table('erp_companies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  companyName: text('company_name').notNull(),
  abbr: text('abbr'), // short code, e.g. "HO" or "SUB1" -- optional display/reference tag
  parentCompanyId: text('parent_company_id'), // self-FK -- nested tree for group structures
  isGroup: boolean('is_group').notNull().default(false), // a group node exists to hold subsidiaries, not to post transactions itself
  defaultCurrencyId: text('default_currency_id'), // nullable link to erp_currencies
  country: text('country'),
  dateOfIncorporation: date('date_of_incorporation', { mode: 'string' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpCostCenters = complianceSchemaDB.table('erp_cost_centers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  parentCostCenterId: text('parent_cost_center_id'),
  isGroup: boolean('is_group').notNull().default(false),
  departmentId: text('department_id'), // nullable link to VERIDIAN's existing departments table
  projectId: text('project_id'), // nullable link to VERIDIAN's existing projects table
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Cash Management (Tier 2 #3): entirely unbuilt before this wave.
export const erpCashVoucherTypeEnum = complianceSchemaDB.enum('erp_cash_voucher_type', ['receipt', 'payment'])
export const erpCashVoucherStatusEnum = complianceSchemaDB.enum('erp_cash_voucher_status', ['draft', 'submitted', 'cancelled'])

export const erpCashAccounts = complianceSchemaDB.table('erp_cash_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  accountName: text('account_name').notNull(),
  glAccountId: text('gl_account_id'), // links to erp_accounts -- this cash account's balance-sheet account
  isPettyCash: boolean('is_petty_cash').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpCashVouchers = complianceSchemaDB.table('erp_cash_vouchers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  cashAccountId: text('cash_account_id').notNull(),
  voucherNumber: integer('voucher_number').notNull(),
  voucherType: erpCashVoucherTypeEnum('voucher_type').notNull(),
  amount: numeric('amount').notNull(),
  partyType: erpPartyTypeEnum('party_type'),
  partyId: text('party_id'),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: erpCashVoucherStatusEnum('status').notNull().default('draft'),
  journalEntryId: text('journal_entry_id'), // set once posted to the GL
  remark: text('remark'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Sales/Purchase Credit Notes (Tier 3 #11): zero schema before this wave
// on either side.
export const erpCreditNoteStatusEnum = complianceSchemaDB.enum('erp_credit_note_status', ['draft', 'submitted', 'cancelled'])

export const erpSalesCreditNotes = complianceSchemaDB.table('erp_sales_credit_notes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id').notNull(),
  salesInvoiceId: text('sales_invoice_id'), // nullable -- a credit note can be raised independent of a specific invoice
  creditNoteNumber: integer('credit_note_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  reason: text('reason'),
  status: erpCreditNoteStatusEnum('status').notNull().default('draft'),
  totalAmount: numeric('total_amount').notNull().default('0'),
  journalEntryId: text('journal_entry_id'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSalesCreditNoteItems = complianceSchemaDB.table('erp_sales_credit_note_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  creditNoteId: text('credit_note_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
})

export const erpPurchaseCreditNotes = complianceSchemaDB.table('erp_purchase_credit_notes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  purchaseInvoiceId: text('purchase_invoice_id'),
  creditNoteNumber: integer('credit_note_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  reason: text('reason'),
  status: erpCreditNoteStatusEnum('status').notNull().default('draft'),
  totalAmount: numeric('total_amount').notNull().default('0'),
  journalEntryId: text('journal_entry_id'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPurchaseCreditNoteItems = complianceSchemaDB.table('erp_purchase_credit_note_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  creditNoteId: text('credit_note_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'),
})

export const erpCostCentersRelations = relations(erpCostCenters, ({ one, many }) => ({
  parentCostCenter: one(erpCostCenters, { fields: [erpCostCenters.parentCostCenterId], references: [erpCostCenters.id], relationName: 'erpCostCenterTree' }),
  childCostCenters: many(erpCostCenters, { relationName: 'erpCostCenterTree' }),
}))

export const erpCashVouchersRelations = relations(erpCashVouchers, ({ one }) => ({
  cashAccount: one(erpCashAccounts, { fields: [erpCashVouchers.cashAccountId], references: [erpCashAccounts.id] }),
}))

export const erpSalesCreditNotesRelations = relations(erpSalesCreditNotes, ({ one, many }) => ({
  customer: one(erpCustomers, { fields: [erpSalesCreditNotes.customerId], references: [erpCustomers.id] }),
  items: many(erpSalesCreditNoteItems),
}))

export const erpSalesCreditNoteItemsRelations = relations(erpSalesCreditNoteItems, ({ one }) => ({
  creditNote: one(erpSalesCreditNotes, { fields: [erpSalesCreditNoteItems.creditNoteId], references: [erpSalesCreditNotes.id] }),
}))

export const erpPurchaseCreditNotesRelations = relations(erpPurchaseCreditNotes, ({ one, many }) => ({
  supplier: one(erpSuppliers, { fields: [erpPurchaseCreditNotes.supplierId], references: [erpSuppliers.id] }),
  items: many(erpPurchaseCreditNoteItems),
}))

export const erpPurchaseCreditNoteItemsRelations = relations(erpPurchaseCreditNoteItems, ({ one }) => ({
  creditNote: one(erpPurchaseCreditNotes, { fields: [erpPurchaseCreditNoteItems.creditNoteId], references: [erpPurchaseCreditNotes.id] }),
}))

// ─── VERI ERP Wave 53: Inventory FIFO Valuation Engine ────────────────────
// Per ERP_BENCHMARK_COMPARISON.md Tier 1 #4 -- the highest-severity
// remaining gap: erpStockLedgerEntries.valuationRate (Wave 49) was a raw
// stored number with no FIFO layer/queue logic behind it, so COGS and
// inventory value on the balance sheet weren't trustworthy. Modeled on
// ERPNext's own approach (a FIFO queue of [qty, rate] tuples consumed
// oldest-first) but as a real per-receipt layer table rather than a JSON
// blob column, matching this codebase's relational-table convention.
export const erpStockValuationLayers = complianceSchemaDB.table('erp_stock_valuation_layers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  stockLedgerEntryId: text('stock_ledger_entry_id').notNull(), // the receipt that created this layer
  receiptDate: date('receipt_date', { mode: 'string' }).notNull(),
  originalQty: numeric('original_qty').notNull(),
  remainingQty: numeric('remaining_qty').notNull(),
  rate: numeric('rate').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpStockValuationLayersRelations = relations(erpStockValuationLayers, ({ one }) => ({
  item: one(erpItems, { fields: [erpStockValuationLayers.itemId], references: [erpItems.id] }),
  warehouse: one(erpWarehouses, { fields: [erpStockValuationLayers.warehouseId], references: [erpWarehouses.id] }),
}))

// ─── Wave 87 (Comparison CSV 2 gap analysis: REP001-004 "Replenishment" +
// CC001-006 "Inventory Control/Cycle Count/ABC") ───────────────────────────
// Reorder policy per item+warehouse (warehouseId nullable = an org-wide
// default). Reorder suggestions are a read-time computation against the
// existing FIFO stock ledger (erp-inventory-service.ts's getItemValuation),
// never a duplicated balance.
export const erpReorderLevels = complianceSchemaDB.table('erp_reorder_levels', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull(),
  warehouseId: text('warehouse_id'), // nullable -- an org-wide default policy when unset
  reorderPoint: numeric('reorder_point').notNull(),
  reorderQty: numeric('reorder_qty').notNull(),
  safetyStock: numeric('safety_stock'),
  minLevel: numeric('min_level'),
  maxLevel: numeric('max_level'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ABC classification is a cached/recomputed snapshot (Pareto analysis over
// real stock-ledger consumption value), not a live-computed value on every
// read -- matching Wave 64's vendor-scorecard precedent of caching an
// analytics result rather than recalculating a heavy aggregate per request.
export const erpAbcClassifications = complianceSchemaDB.table('erp_abc_classifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull(),
  classification: text('classification').notNull(), // 'A'|'B'|'C'
  consumptionValue: numeric('consumption_value').notNull(),
  computedAt: timestamp('computed_at').notNull().defaultNow(),
})

export const erpCycleCountPlans = complianceSchemaDB.table('erp_cycle_count_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  warehouseId: text('warehouse_id').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('draft'), // 'draft'|'active'|'completed'
  scheduledDate: date('scheduled_date', { mode: 'string' }),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpCycleCountLines = complianceSchemaDB.table('erp_cycle_count_lines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull(),
  itemId: text('item_id').notNull(),
  // Snapshotted from the FIFO stock ledger at plan-creation time -- the
  // count sheet compares a physical count against this frozen baseline,
  // never a live-refetched balance (the point of a cycle count is to
  // catch drift since that snapshot).
  systemQty: numeric('system_qty').notNull(),
  countedQty: numeric('counted_qty'),
  status: text('status').notNull().default('pending'), // 'pending'|'counted'|'adjusted'
  countedById: text('counted_by_id'),
  countedAt: timestamp('counted_at'),
})

export const erpReorderLevelsRelations = relations(erpReorderLevels, ({ one }) => ({
  item: one(erpItems, { fields: [erpReorderLevels.itemId], references: [erpItems.id] }),
  warehouse: one(erpWarehouses, { fields: [erpReorderLevels.warehouseId], references: [erpWarehouses.id] }),
}))
export const erpCycleCountPlansRelations = relations(erpCycleCountPlans, ({ one, many }) => ({
  warehouse: one(erpWarehouses, { fields: [erpCycleCountPlans.warehouseId], references: [erpWarehouses.id] }),
  lines: many(erpCycleCountLines),
}))
export const erpCycleCountLinesRelations = relations(erpCycleCountLines, ({ one }) => ({
  plan: one(erpCycleCountPlans, { fields: [erpCycleCountLines.planId], references: [erpCycleCountPlans.id] }),
  item: one(erpItems, { fields: [erpCycleCountLines.itemId], references: [erpItems.id] }),
}))

// ─── Wave 88 (Comparison CSV 2 gap analysis: CLM002 "Template Management" +
// CLM003 "Clause Library" + CLM005 "Negotiation Tracking") ─────────────────
// Clause library is reusable clause text, categorized/risk-rated. Contract
// templates reference clauses via an ordered join table rather than
// duplicating clause text into the template. "Generate from template"
// (clm-service.ts) does plain token substitution ({{customerName}} etc.)
// into erpContracts.bodyText -- deliberately NOT generative/AI authoring
// (that's CLM004, explicitly out of scope this wave). Negotiation rounds
// mirror Wave 83's erp_rfq_negotiation_rounds pattern exactly, scoped to
// contracts instead of quotations.
export const clmClauses = complianceSchemaDB.table('clm_clauses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  category: text('category'), // free text: 'liability'|'termination'|'confidentiality'|... -- admin-extensible
  bodyText: text('body_text').notNull(),
  riskLevel: text('risk_level'), // 'low'|'medium'|'high'
  isStandard: boolean('is_standard').notNull().default(true), // false = requires legal review before use
  version: integer('version').notNull().default(1),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const clmContractTemplates = complianceSchemaDB.table('clm_contract_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  contractType: text('contract_type'), // matches erp_contracts.contract_type free-text convention
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const clmTemplateClauses = complianceSchemaDB.table('clm_template_clauses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  templateId: text('template_id').notNull(),
  clauseId: text('clause_id').notNull(),
  position: integer('position').notNull(),
  isOptional: boolean('is_optional').notNull().default(false),
})

export const erpContractNegotiationRounds = complianceSchemaDB.table('erp_contract_negotiation_rounds', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  contractId: text('contract_id').notNull(),
  roundNumber: integer('round_number').notNull(),
  proposedValue: numeric('proposed_value'),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const clmClausesRelations = relations(clmClauses, ({ many }) => ({
  templateClauses: many(clmTemplateClauses),
}))
export const clmContractTemplatesRelations = relations(clmContractTemplates, ({ many }) => ({
  templateClauses: many(clmTemplateClauses),
}))
export const clmTemplateClausesRelations = relations(clmTemplateClauses, ({ one }) => ({
  template: one(clmContractTemplates, { fields: [clmTemplateClauses.templateId], references: [clmContractTemplates.id] }),
  clause: one(clmClauses, { fields: [clmTemplateClauses.clauseId], references: [clmClauses.id] }),
}))
export const erpContractNegotiationRoundsRelations = relations(erpContractNegotiationRounds, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpContractNegotiationRounds.contractId], references: [erpContracts.id] }),
}))

// ─── VERI ERP Wave 54: Bank Statement Import & Reconciliation ─────────────
// Per ERP_BENCHMARK_COMPARISON.md Tier 3 #9 -- entirely unbuilt before
// this wave. Reuses this codebase's own existing generic file parser
// (src/lib/ingest/parser.ts, already handling CSV/Excel/PDF for the
// compliance-item ingestion pipeline) rather than adding a new MT940/
// CAMT.053 parsing dependency -- per VAIOS_ARCHITECTURE_STRATEGY.md's own
// finding that Indian banks overwhelmingly export CSV/Excel, not raw
// SWIFT MT940, so the already-built parser is the correct "don't
// reinvent" move here, not a new npm dependency.
export const erpBankReconciliationStatusEnum = complianceSchemaDB.enum('erp_bank_reconciliation_status', ['unmatched', 'matched', 'ignored'])

export const erpBankStatementImports = complianceSchemaDB.table('erp_bank_statement_imports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  bankAccountId: text('bank_account_id').notNull(), // links to erp_bank_accounts (Wave 49)
  fileName: text('file_name').notNull(),
  totalLines: integer('total_lines').notNull().default(0),
  importedById: text('imported_by_id'),
  importedAt: timestamp('imported_at').notNull().defaultNow(),
})

export const erpBankStatementLines = complianceSchemaDB.table('erp_bank_statement_lines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  importId: text('import_id').notNull(),
  transactionDate: date('transaction_date', { mode: 'string' }).notNull(),
  description: text('description'),
  referenceNo: text('reference_no'),
  debitAmount: numeric('debit_amount').notNull().default('0'), // withdrawal
  creditAmount: numeric('credit_amount').notNull().default('0'), // deposit
  status: erpBankReconciliationStatusEnum('status').notNull().default('unmatched'),
  matchedJournalEntryId: text('matched_journal_entry_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpBankStatementImportsRelations = relations(erpBankStatementImports, ({ many }) => ({
  lines: many(erpBankStatementLines),
}))

export const erpBankStatementLinesRelations = relations(erpBankStatementLines, ({ one }) => ({
  import: one(erpBankStatementImports, { fields: [erpBankStatementLines.importId], references: [erpBankStatementImports.id] }),
}))

// ─── VERI ERP Wave 55: Procurement Workflow (Requisition + RFQ) ───────────
// Per ERP_BENCHMARK_COMPARISON.md Tier 3 #10 -- no requisition/RFQ layer
// existed above the PO before this wave (every PO was a standalone
// document with no upstream authorization trail). Purchase Requisition
// submission is also the second real consumer of the Wave 51 shared
// Approval Workflow Engine (after erp_journal_entry), proving that
// engine's "entity-agnostic" design claim rather than leaving it a
// single-consumer abstraction.
export const erpRequisitionStatusEnum = complianceSchemaDB.enum('erp_requisition_status', ['draft', 'submitted', 'approved', 'rejected', 'converted'])
export const erpRfqStatusEnum = complianceSchemaDB.enum('erp_rfq_status', ['draft', 'sent', 'closed'])
export const erpSupplierQuotationStatusEnum = complianceSchemaDB.enum('erp_supplier_quotation_status', ['draft', 'submitted'])

export const erpPurchaseRequisitions = complianceSchemaDB.table('erp_purchase_requisitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  requisitionNumber: integer('requisition_number').notNull(),
  requestedById: text('requested_by_id'),
  departmentId: text('department_id'), // nullable link to VERIDIAN's existing departments table
  purpose: text('purpose'),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: erpRequisitionStatusEnum('status').notNull().default('draft'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPurchaseRequisitionItems = complianceSchemaDB.table('erp_purchase_requisition_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  requisitionId: text('requisition_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  estimatedRate: numeric('estimated_rate'),
})

export const erpRfqs = complianceSchemaDB.table('erp_rfqs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  rfqNumber: integer('rfq_number').notNull(),
  requisitionId: text('requisition_id'), // nullable -- an RFQ can be raised directly, not only from a requisition
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  status: erpRfqStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpRfqItems = complianceSchemaDB.table('erp_rfq_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  rfqId: text('rfq_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
})

export const erpRfqSuppliers = complianceSchemaDB.table('erp_rfq_suppliers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  rfqId: text('rfq_id').notNull(),
  supplierId: text('supplier_id').notNull(),
})

export const erpSupplierQuotations = complianceSchemaDB.table('erp_supplier_quotations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  rfqId: text('rfq_id'), // nullable -- a quotation can be logged even without a formal RFQ
  supplierId: text('supplier_id').notNull(),
  quotationNumber: integer('quotation_number').notNull(),
  postingDate: date('posting_date', { mode: 'string' }).notNull(),
  validTill: date('valid_till', { mode: 'string' }),
  status: erpSupplierQuotationStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSupplierQuotationItems = complianceSchemaDB.table('erp_supplier_quotation_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quotationId: text('quotation_id').notNull(),
  itemId: text('item_id'),
  description: text('description').notNull(),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
})

// ─── Wave 83 (RFQ enhancements, COMPARISON_CSV_GAP_ANALYSIS.md backlog #4) ─
// Formal weighted scoring -- criteria are per-RFQ (a "Delivery Time"
// criterion means something different for a stationery RFQ vs a capital
// equipment RFQ), scores are per-quotation-per-criterion so every reviewer
// vote is individually auditable rather than collapsed into one number
// immediately.
export const erpRfqScoringCriteria = complianceSchemaDB.table('erp_rfq_scoring_criteria', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  rfqId: text('rfq_id').notNull(),
  name: text('name').notNull(),
  weight: numeric('weight').notNull().default('1'), // relative weight, e.g. Price=40, Quality=30, Delivery=30
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpRfqQuotationScores = complianceSchemaDB.table('erp_rfq_quotation_scores', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  quotationId: text('quotation_id').notNull(),
  criterionId: text('criterion_id').notNull(),
  score: numeric('score').notNull(), // 0-10
  scoredById: text('scored_by_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Structured negotiation-round log -- a real back-and-forth history against
// a specific quotation, instead of only the final accepted rate.
export const erpRfqNegotiationRounds = complianceSchemaDB.table('erp_rfq_negotiation_rounds', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  quotationId: text('quotation_id').notNull(),
  roundNumber: integer('round_number').notNull(),
  proposedRate: numeric('proposed_rate').notNull(),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Reverse auction -- suppliers see the current lowest bid and can undercut
// it; each new bid is server-enforced to actually be lower than the
// current lowest (never just recorded blindly). Closing the auction picks
// the lowest bid as the winner. Polling-based, matching this codebase's
// existing guest-facing pattern (guest-chat) rather than a new websocket
// mechanism.
export const erpRfqReverseAuctions = complianceSchemaDB.table('erp_rfq_reverse_auctions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  rfqId: text('rfq_id').notNull(),
  startAt: timestamp('start_at').notNull(),
  endAt: timestamp('end_at').notNull(),
  status: text('status').notNull().default('scheduled'), // 'scheduled'|'active'|'closed'
  currentLowestBid: numeric('current_lowest_bid'),
  currentLeaderSupplierId: text('current_leader_supplier_id'),
  winningSupplierId: text('winning_supplier_id'),
  closedAt: timestamp('closed_at'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpRfqAuctionBids = complianceSchemaDB.table('erp_rfq_auction_bids', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  auctionId: text('auction_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  bidAmount: numeric('bid_amount').notNull(),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
})

export const erpPurchaseRequisitionsRelations = relations(erpPurchaseRequisitions, ({ many }) => ({
  items: many(erpPurchaseRequisitionItems),
}))

export const erpPurchaseRequisitionItemsRelations = relations(erpPurchaseRequisitionItems, ({ one }) => ({
  requisition: one(erpPurchaseRequisitions, { fields: [erpPurchaseRequisitionItems.requisitionId], references: [erpPurchaseRequisitions.id] }),
}))

export const erpRfqsRelations = relations(erpRfqs, ({ one, many }) => ({
  requisition: one(erpPurchaseRequisitions, { fields: [erpRfqs.requisitionId], references: [erpPurchaseRequisitions.id] }),
  items: many(erpRfqItems),
  suppliers: many(erpRfqSuppliers),
}))

export const erpRfqItemsRelations = relations(erpRfqItems, ({ one }) => ({
  rfq: one(erpRfqs, { fields: [erpRfqItems.rfqId], references: [erpRfqs.id] }),
}))

export const erpRfqSuppliersRelations = relations(erpRfqSuppliers, ({ one }) => ({
  rfq: one(erpRfqs, { fields: [erpRfqSuppliers.rfqId], references: [erpRfqs.id] }),
  supplier: one(erpSuppliers, { fields: [erpRfqSuppliers.supplierId], references: [erpSuppliers.id] }),
}))

export const erpSupplierQuotationsRelations = relations(erpSupplierQuotations, ({ one, many }) => ({
  rfq: one(erpRfqs, { fields: [erpSupplierQuotations.rfqId], references: [erpRfqs.id] }),
  supplier: one(erpSuppliers, { fields: [erpSupplierQuotations.supplierId], references: [erpSuppliers.id] }),
  items: many(erpSupplierQuotationItems),
}))

export const erpSupplierQuotationItemsRelations = relations(erpSupplierQuotationItems, ({ one }) => ({
  quotation: one(erpSupplierQuotations, { fields: [erpSupplierQuotationItems.quotationId], references: [erpSupplierQuotations.id] }),
}))

// ─── Wave 56: Indian Statutory Payroll (PF/ESI/Professional Tax) ─────────
// Tier 2 #5/#6 on ERP_BENCHMARK_COMPARISON.md's ranking, deliberately
// scoped narrower than the ranking's own full ask: PF, ESI, and
// Professional Tax are built as a real, configurable rule engine (rates/
// ceilings/slabs live in erpStatutoryRules as admin-editable master data,
// never hardcoded in code -- these change via periodic government
// notification). TDS (income tax) is explicitly NOT auto-computed here --
// correct TDS depends on regime choice (old/new), Section 80C/HRA
// exemptions, and annual slab projection, none of which can be safely
// approximated without real risk of an incorrect statutory deduction.
// Every payslip carries a TDS line the payroll preparer enters manually
// (defaulting to 0), clearly surfaced in the UI as "not auto-calculated."
export const erpSalaryComponentTypeEnum = complianceSchemaDB.enum('erp_salary_component_type', ['earning', 'deduction'])
export const erpComponentCalcTypeEnum = complianceSchemaDB.enum('erp_component_calc_type', ['flat', 'percentage_of_basic', 'percentage_of_gross'])
export const erpStatutoryRuleTypeEnum = complianceSchemaDB.enum('erp_statutory_rule_type', ['pf', 'esi', 'professional_tax'])
export const erpPayrollRunStatusEnum = complianceSchemaDB.enum('erp_payroll_run_status', ['draft', 'processed', 'paid', 'cancelled'])
export const erpPayslipLineTypeEnum = complianceSchemaDB.enum('erp_payslip_line_type', ['earning', 'deduction'])

export const erpSalaryComponents = complianceSchemaDB.table('erp_salary_components', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  componentType: erpSalaryComponentTypeEnum('component_type').notNull(),
  calculationType: erpComponentCalcTypeEnum('calculation_type').notNull().default('flat'),
  defaultPercentage: numeric('default_percentage'),
  defaultAmount: numeric('default_amount'),
  isStatutory: boolean('is_statutory').notNull().default(false),
  // Marks earning components counted toward PF wage (typically Basic + DA
  // only, per EPFO rules -- not the full gross).
  includeInPfWage: boolean('include_in_pf_wage').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSalaryStructures = complianceSchemaDB.table('erp_salary_structures', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  employeeId: text('employee_id').notNull().references(() => employeeProfiles.id),
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  ctcAnnual: numeric('ctc_annual').notNull(),
  // State of employment for Professional Tax slab lookup -- a payroll
  // attribute, not a general HR field, since PT depends on work location.
  state: text('state'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSalaryStructureComponents = complianceSchemaDB.table('erp_salary_structure_components', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  structureId: text('structure_id').notNull().references(() => erpSalaryStructures.id, { onDelete: 'cascade' }),
  componentId: text('component_id').notNull().references(() => erpSalaryComponents.id),
  amount: numeric('amount'),
  percentage: numeric('percentage'),
})

// Admin-editable master data -- the entire point of this table is that PF/
// ESI/PT rates, wage ceilings, and PT slabs are NEVER hardcoded in code.
// `slabs` (PT only) is an array of { uptoAmount, taxAmount } monthly-gross
// bands, since Indian states each set their own PT slab structure.
export const erpStatutoryRules = complianceSchemaDB.table('erp_statutory_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  ruleType: erpStatutoryRuleTypeEnum('rule_type').notNull(),
  state: text('state'), // nullable -- PF/ESI are national; Professional Tax is state-specific
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  effectiveTo: date('effective_to', { mode: 'string' }),
  employeeRate: numeric('employee_rate'), // percentage, e.g. 12.00 for PF
  employerRate: numeric('employer_rate'),
  wageCeiling: numeric('wage_ceiling'), // e.g. 15000 for PF, 21000 for ESI
  slabs: jsonb('slabs').$type<{ uptoAmount: number; taxAmount: number }[]>(),
  notes: text('notes'), // e.g. citation of the government notification this rate comes from
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpPayrollRuns = complianceSchemaDB.table('erp_payroll_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  month: integer('month').notNull(),
  year: integer('year').notNull(),
  status: erpPayrollRunStatusEnum('status').notNull().default('draft'),
  processedAt: timestamp('processed_at'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPayslips = complianceSchemaDB.table('erp_payslips', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  payrollRunId: text('payroll_run_id').notNull().references(() => erpPayrollRuns.id, { onDelete: 'cascade' }),
  employeeId: text('employee_id').notNull().references(() => employeeProfiles.id),
  grossEarnings: numeric('gross_earnings').notNull().default('0'),
  totalDeductions: numeric('total_deductions').notNull().default('0'),
  netPay: numeric('net_pay').notNull().default('0'),
  status: text('status').notNull().default('draft'), // 'draft' | 'finalized'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpPayslipLines = complianceSchemaDB.table('erp_payslip_lines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  payslipId: text('payslip_id').notNull().references(() => erpPayslips.id, { onDelete: 'cascade' }),
  componentId: text('component_id').references(() => erpSalaryComponents.id), // nullable -- statutory/manual lines (e.g. TDS) have no structure component
  label: text('label').notNull(),
  lineType: erpPayslipLineTypeEnum('line_type').notNull(),
  amount: numeric('amount').notNull().default('0'),
})

// Wave 68 (payroll TDS auto-computation, per ERPNext's Income Tax Slab
// doctype as reference, read-only/GPL-3.0/no code copied): old-regime vs
// new-regime is modeled as TWO SEPARATE slab records (an employee is
// assigned one), not a regime flag on one record -- matching ERPNext's
// own approach, since the slab bands/rates genuinely differ, not just a
// toggle. An org must set these up (admin-editable, never hardcoded --
// same "rates come from a periodic government notification" discipline
// as Wave 56's erp_statutory_rules) before payroll can auto-compute TDS
// for an employee; an employee with no slab assigned keeps Wave 56's
// original manual-entry-only behavior, unchanged.
export const erpIncomeTaxSlabs = complianceSchemaDB.table('erp_income_tax_slabs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(), // e.g. "New Regime FY 2026-27"
  effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
  standardDeduction: numeric('standard_deduction').notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpIncomeTaxSlabRates = complianceSchemaDB.table('erp_income_tax_slab_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  slabId: text('slab_id').notNull(),
  fromAmount: numeric('from_amount').notNull(),
  toAmount: numeric('to_amount'), // nullable -- the top band has no upper bound
  percentDeduction: numeric('percent_deduction').notNull(),
})

// A flat declaration list (name, category, amount) rather than ERPNext's
// full Category/SubCategory/ProofSubmission hierarchy -- a deliberate
// simplification that still captures the total exemption amount a
// computeAnnualTds() run needs, without building document-proof workflow
// this pass doesn't need.
export const erpEmployeeTaxExemptions = complianceSchemaDB.table('erp_employee_tax_exemptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  employeeId: text('employee_id').notNull(),
  financialYear: text('financial_year').notNull(), // e.g. "2026-27"
  category: text('category').notNull(), // free text, e.g. "80C", "HRA", "80D"
  amount: numeric('amount').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Wave 68 (vendor-payment TDS, per ERPNext's Tax Withholding Category
// doctype as reference): applied at purchase-invoice-submit time by
// comparing this invoice's (and this supplier's already-submitted prior
// invoices' cumulative) taxable basis against the category's thresholds.
// No structured "section code" (194C/194J etc.) field -- handled via
// free-text categoryName, matching ERPNext's own shape.
export const erpTaxWithholdingCategories = complianceSchemaDB.table('erp_tax_withholding_categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  categoryName: text('category_name').notNull(),
  taxDeductionBasis: text('tax_deduction_basis').notNull().default('net_total'), // 'gross_total' | 'net_total'
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpTaxWithholdingRates = complianceSchemaDB.table('erp_tax_withholding_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  categoryId: text('category_id').notNull(),
  fromDate: date('from_date', { mode: 'string' }).notNull(),
  toDate: date('to_date', { mode: 'string' }),
  rate: numeric('rate').notNull(),
  singleThreshold: numeric('single_threshold'), // nullable -- withhold if a single invoice's basis exceeds this
  cumulativeThreshold: numeric('cumulative_threshold'), // nullable -- withhold if this supplier's running total (incl. this invoice) exceeds this
})

export const erpSalaryStructuresRelations = relations(erpSalaryStructures, ({ one, many }) => ({
  employee: one(employeeProfiles, { fields: [erpSalaryStructures.employeeId], references: [employeeProfiles.id] }),
  components: many(erpSalaryStructureComponents),
}))

export const erpSalaryStructureComponentsRelations = relations(erpSalaryStructureComponents, ({ one }) => ({
  structure: one(erpSalaryStructures, { fields: [erpSalaryStructureComponents.structureId], references: [erpSalaryStructures.id] }),
  component: one(erpSalaryComponents, { fields: [erpSalaryStructureComponents.componentId], references: [erpSalaryComponents.id] }),
}))

export const erpPayrollRunsRelations = relations(erpPayrollRuns, ({ many }) => ({
  payslips: many(erpPayslips),
}))

export const erpPayslipsRelations = relations(erpPayslips, ({ one, many }) => ({
  payrollRun: one(erpPayrollRuns, { fields: [erpPayslips.payrollRunId], references: [erpPayrollRuns.id] }),
  employee: one(employeeProfiles, { fields: [erpPayslips.employeeId], references: [employeeProfiles.id] }),
  lines: many(erpPayslipLines),
}))

export const erpPayslipLinesRelations = relations(erpPayslipLines, ({ one }) => ({
  payslip: one(erpPayslips, { fields: [erpPayslipLines.payslipId], references: [erpPayslips.id] }),
  component: one(erpSalaryComponents, { fields: [erpPayslipLines.componentId], references: [erpSalaryComponents.id] }),
}))

// ─── Wave 57: Multi-UOM Conversion + Batch/Serial Tracking ───────────────
// Tier 3 #12 on ERP_BENCHMARK_COMPARISON.md's ranking. Items previously
// had a single free-text UOM with no conversion path (can't buy in
// "Box" and issue in "Nos"), and no batch/expiry or serial tracking at
// all -- a real blocker for any distribution/trading or regulated-goods
// client. Batch/serial are traceability metadata on stock movements, not
// a per-batch FIFO redesign -- valuation continues at the item-warehouse
// level (see erp-inventory-service.ts for the reasoning).
export const erpItemSerialStatusEnum = complianceSchemaDB.enum('erp_item_serial_status', ['in_stock', 'delivered', 'returned'])

export const erpItemUomConversions = complianceSchemaDB.table('erp_item_uom_conversions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull().references(() => erpItems.id),
  uom: text('uom').notNull(), // the alternate UOM name, e.g. 'Box'
  conversionFactor: numeric('conversion_factor').notNull(), // how many stock-UOM units equal 1 of this alternate UOM
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpItemBatches = complianceSchemaDB.table('erp_item_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull().references(() => erpItems.id),
  batchNumber: text('batch_number').notNull(),
  manufacturingDate: date('manufacturing_date', { mode: 'string' }),
  expiryDate: date('expiry_date', { mode: 'string' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpItemSerials = complianceSchemaDB.table('erp_item_serials', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  itemId: text('item_id').notNull().references(() => erpItems.id),
  serialNumber: text('serial_number').notNull(),
  status: erpItemSerialStatusEnum('status').notNull().default('in_stock'),
  warehouseId: text('warehouse_id').references(() => erpWarehouses.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpItemUomConversionsRelations = relations(erpItemUomConversions, ({ one }) => ({
  item: one(erpItems, { fields: [erpItemUomConversions.itemId], references: [erpItems.id] }),
}))

export const erpItemBatchesRelations = relations(erpItemBatches, ({ one }) => ({
  item: one(erpItems, { fields: [erpItemBatches.itemId], references: [erpItems.id] }),
}))

export const erpItemSerialsRelations = relations(erpItemSerials, ({ one }) => ({
  item: one(erpItems, { fields: [erpItemSerials.itemId], references: [erpItems.id] }),
  warehouse: one(erpWarehouses, { fields: [erpItemSerials.warehouseId], references: [erpWarehouses.id] }),
}))

// ─── Wave 59: SAML SSO (M-17) ─────────────────────────────────────────────
// The other half of Tier 3 #13. Service-Provider-side SAML 2.0 via
// @node-saml/node-saml (MIT, signature/replay validation handled by the
// library, not hand-rolled). One config per org for this pass -- multiple
// IdPs per org is a real future extension, not needed for a first SSO
// integration. Session establishment reuses the EXISTING Supabase magic-link
// + /auth/callback code-exchange flow (Wave-independent, already in
// production) rather than inventing a second session mechanism: the ACS
// handler validates the assertion, then mints a Supabase admin magic link
// for the matched user's email and redirects the browser through it.
// SAML login only authenticates a user who already exists in this org --
// it deliberately does NOT auto-provision new users from IdP assertions,
// since that's a distinct, higher-risk decision an admin should opt into
// separately, not something to default to silently.
export const ssoConfigurations = complianceSchemaDB.table('sso_configurations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull().unique(),
  idpEntryPoint: text('idp_entry_point').notNull(), // the IdP's SSO redirect URL
  idpIssuer: text('idp_issuer').notNull(), // the IdP's entity ID
  idpCert: text('idp_cert').notNull(), // the IdP's X.509 signing certificate (PEM) -- used to validate assertion signatures
  spEntityId: text('sp_entity_id').notNull(), // our own SP entity ID, given to the IdP when configuring the integration
  isEnabled: boolean('is_enabled').notNull().default(false),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Wave 60: Sales/Purchase Invoicing + Pricing Rules ───────────────────
// Tier 3 #11 remainder (pricing rules -- credit notes were closed in Wave
// 52) and the real Buying/Selling document flow itself: erp_sales_invoices/
// erp_purchase_invoices have existed since Wave 49 with zero service-layer
// consumer until now -- a bigger, more fundamental gap than pricing rules
// alone. Pricing rules are deliberately narrow (all/customer/item, not
// customer_group/item_group -- those aren't wired to anything meaningful
// yet) rather than reaching for json-rules-engine for three comparisons.
export const erpPricingAppliesToEnum = complianceSchemaDB.enum('erp_pricing_applies_to', ['all', 'customer', 'item'])
export const erpPricingDiscountTypeEnum = complianceSchemaDB.enum('erp_pricing_discount_type', ['percentage', 'flat'])

export const erpPricingRules = complianceSchemaDB.table('erp_pricing_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  appliesTo: erpPricingAppliesToEnum('applies_to').notNull().default('all'),
  targetId: text('target_id'), // erpCustomers.id or erpItems.id depending on appliesTo; null when appliesTo='all'
  discountType: erpPricingDiscountTypeEnum('discount_type').notNull().default('percentage'),
  discountValue: numeric('discount_value').notNull(),
  minQty: numeric('min_qty').notNull().default('0'),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  priority: integer('priority').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Wave 62: Recruitment/ATS + Performance Appraisal (Tier 3 #14) ───────
// Complete gaps before this wave -- HR (Wave 40) has employee master data
// and leave, but no hiring pipeline and no review cycle. Candidate resumes
// deliberately do NOT get a new file column -- a candidate is just another
// `linkedEntityType='candidate'` row in the Wave 61 central documents
// repository, proving that mechanism actually generalizes across modules
// rather than being ERP-only. Hiring an application does NOT
// auto-provision a `users`/`employeeProfiles` row -- same "no silent
// auto-provisioning" discipline as Wave 59's SSO -- an admin explicitly
// creates the employee profile and links it via `hiredEmployeeProfileId`.
export const jobOpeningStatusEnum = complianceSchemaDB.enum('job_opening_status', ['open', 'on_hold', 'closed', 'filled'])
export const applicationStageEnum = complianceSchemaDB.enum('application_stage', ['applied', 'screening', 'interview', 'offer', 'hired', 'rejected'])
export const interviewRecommendationEnum = complianceSchemaDB.enum('interview_recommendation', ['strong_yes', 'yes', 'no', 'strong_no'])
export const performanceReviewCycleStatusEnum = complianceSchemaDB.enum('performance_review_cycle_status', ['draft', 'active', 'closed'])
export const performanceReviewStatusEnum = complianceSchemaDB.enum('performance_review_status', ['pending', 'submitted', 'acknowledged'])

export const jobOpenings = complianceSchemaDB.table('job_openings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  departmentId: text('department_id'),
  jobDescription: text('job_description'),
  employmentType: text('employment_type').notNull().default('full_time'), // matches employeeProfiles.employmentType's free-text convention
  numPositions: integer('num_positions').notNull().default(1),
  status: jobOpeningStatusEnum('status').notNull().default('open'),
  postedById: text('posted_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  closedAt: timestamp('closed_at'),
})

export const candidates = complianceSchemaDB.table('candidates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  source: text('source'), // free text: 'referral' | 'job_board' | 'agency' | etc.
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const jobApplications = complianceSchemaDB.table('job_applications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  jobOpeningId: text('job_opening_id').notNull(),
  candidateId: text('candidate_id').notNull(),
  stage: applicationStageEnum('stage').notNull().default('applied'),
  rejectedReason: text('rejected_reason'),
  offerAmount: numeric('offer_amount'),
  offerAcceptedAt: timestamp('offer_accepted_at'),
  hiredEmployeeProfileId: text('hired_employee_profile_id'), // set only when an admin explicitly links a created employeeProfiles row -- never auto-provisioned
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const interviewFeedback = complianceSchemaDB.table('interview_feedback', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  applicationId: text('application_id').notNull(),
  interviewerId: text('interviewer_id').notNull(),
  roundName: text('round_name').notNull(), // free text: 'Screening' | 'Technical' | 'HR' | etc.
  scheduledAt: timestamp('scheduled_at').notNull(),
  rating: integer('rating'), // 1-5, null until the interview is actually completed
  recommendation: interviewRecommendationEnum('recommendation'),
  feedback: text('feedback'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const performanceReviewCycles = complianceSchemaDB.table('performance_review_cycles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(), // e.g. "H1 2026"
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  status: performanceReviewCycleStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const performanceReviews = complianceSchemaDB.table('performance_reviews', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  cycleId: text('cycle_id').notNull(),
  employeeProfileId: text('employee_profile_id').notNull(),
  reviewerId: text('reviewer_id').notNull(),
  selfRating: integer('self_rating'), // 1-5, filled in by the employee
  managerRating: integer('manager_rating'), // 1-5, filled in by the reviewer
  strengths: text('strengths'),
  improvements: text('improvements'),
  goalsForNextPeriod: text('goals_for_next_period'),
  status: performanceReviewStatusEnum('status').notNull().default('pending'),
  submittedAt: timestamp('submitted_at'),
  acknowledgedAt: timestamp('acknowledged_at'), // set when the reviewed employee acknowledges having read it
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Wave 63: RMA/Returns Workflow (Tier 3 #11 remainder) ────────────────
// ERPNext itself only flags returns with no real workflow -- this is a
// genuine in-house design. Deliberately reuses existing infrastructure
// rather than reinventing it: physical stock movement goes through the
// same recordStockReceipt/recordStockIssue FIFO engine every other stock
// movement uses (Wave 53/57) -- a return is not a parallel valuation path.
// The financial side (crediting the customer / getting credited by the
// supplier) reuses the existing erp_sales_credit_notes/
// erp_purchase_credit_notes documents (Wave 52) via an explicit,
// admin-linked creditNoteId -- never auto-created, since picking the
// correct revenue/expense account requires the same human judgment call
// Wave 60 already decided invoicing itself needs.
export const erpSalesReturnStatusEnum = complianceSchemaDB.enum('erp_sales_return_status', ['requested', 'approved', 'received', 'rejected'])
export const erpPurchaseReturnStatusEnum = complianceSchemaDB.enum('erp_purchase_return_status', ['requested', 'approved', 'dispatched', 'rejected'])

export const erpSalesReturns = complianceSchemaDB.table('erp_sales_returns', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id').notNull(),
  salesInvoiceId: text('sales_invoice_id'), // nullable -- a return can be raised without a specific originating invoice
  warehouseId: text('warehouse_id').notNull(), // where the returned stock is received back into
  reason: text('reason'),
  status: erpSalesReturnStatusEnum('status').notNull().default('requested'),
  creditNoteId: text('credit_note_id'), // set only once an admin explicitly links an already-created erp_sales_credit_notes row
  requestedById: text('requested_by_id').notNull(),
  approvedById: text('approved_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpSalesReturnItems = complianceSchemaDB.table('erp_sales_return_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  returnId: text('return_id').notNull(),
  itemId: text('item_id').notNull(),
  quantity: numeric('quantity').notNull(),
  rate: numeric('rate').notNull().default('0'), // informational -- the actual FIFO cost is computed by recordStockReceipt itself
  reason: text('reason'),
})

export const erpPurchaseReturns = complianceSchemaDB.table('erp_purchase_returns', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  supplierId: text('supplier_id').notNull(),
  purchaseInvoiceId: text('purchase_invoice_id'),
  warehouseId: text('warehouse_id').notNull(), // where the stock being returned to the supplier is issued from
  reason: text('reason'),
  status: erpPurchaseReturnStatusEnum('status').notNull().default('requested'),
  creditNoteId: text('credit_note_id'), // set only once an admin explicitly links an already-created erp_purchase_credit_notes row
  requestedById: text('requested_by_id').notNull(),
  approvedById: text('approved_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpPurchaseReturnItems = complianceSchemaDB.table('erp_purchase_return_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  returnId: text('return_id').notNull(),
  itemId: text('item_id').notNull(),
  quantity: numeric('quantity').notNull(),
  rate: numeric('rate').notNull().default('0'),
  reason: text('reason'),
})

// ─── Wave 70 (Budgeting) ──────────────────────────────────────────────────
// Per COMPARISON_CSV_GAP_ANALYSIS.md (benchmarking VERIDIAN against a CSV
// comparing Odoo/ERPNext/Zoho/SAP/Oracle/Dynamics feature-by-feature):
// Finance>Budgeting was a complete, zero-schema gap -- every other Finance
// submodule in that CSV (Fixed Assets, Taxation, Financial Reporting,
// Period Closing) already existed. Deliberately reuses existing
// dimensions rather than inventing new ones: a budget is scoped to an
// existing erp_cost_centers row (or org-wide if null) and its line items
// are annual totals against existing erp_accounts rows -- variance is
// computed live against erp_journal_entry_lines (which already carries
// cost_center_id since Wave 52), never a duplicated actuals ledger, matching
// this codebase's established "read-time aggregation" precedent (PMS
// budgets, Wave 28).
export const erpBudgetActionEnum = complianceSchemaDB.enum('erp_budget_action', ['ignore', 'warn', 'stop'])
export const erpBudgetStatusEnum = complianceSchemaDB.enum('erp_budget_status', ['draft', 'submitted', 'cancelled'])

export const erpBudgets = complianceSchemaDB.table('erp_budgets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  fiscalYearId: text('fiscal_year_id').notNull(),
  companyId: text('company_id'), // nullable -- Wave 67 precedent, null = whole org
  costCenterId: text('cost_center_id'), // nullable -- budget can be scoped to one cost center or org-wide
  name: text('name').notNull(),
  actionIfExceeded: erpBudgetActionEnum('action_if_exceeded').notNull().default('warn'),
  status: erpBudgetStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id'),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpBudgetLineItems = complianceSchemaDB.table('erp_budget_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  budgetId: text('budget_id').notNull(),
  accountId: text('account_id').notNull(),
  annualAmount: numeric('annual_amount').notNull().default('0'),
})

export const erpBudgetsRelations = relations(erpBudgets, ({ one, many }) => ({
  fiscalYear: one(erpFiscalYears, { fields: [erpBudgets.fiscalYearId], references: [erpFiscalYears.id] }),
  costCenter: one(erpCostCenters, { fields: [erpBudgets.costCenterId], references: [erpCostCenters.id] }),
  lineItems: many(erpBudgetLineItems),
}))
export const erpBudgetLineItemsRelations = relations(erpBudgetLineItems, ({ one }) => ({
  budget: one(erpBudgets, { fields: [erpBudgetLineItems.budgetId], references: [erpBudgets.id] }),
  account: one(erpAccounts, { fields: [erpBudgetLineItems.accountId], references: [erpAccounts.id] }),
}))

// ─── Wave 71 (Contract & Commercial Lifecycle Management) ────────────────
// Per COMPARISON_CSV_GAP_ANALYSIS.md: Sales>Contract Management was a
// complete gap -- the existing `contractComplianceItems` table (Integrity
// module, Wave 8) is a GRC "contract compliance obligations register",
// unrelated to commercial contract lifecycle (SLA, renewals, amendments,
// recurring billing, revenue recognition, subscriptions). Deliberately
// reuses existing infrastructure rather than duplicating it: contract
// documents use the existing polymorphic `documents` table
// (linkedEntityType='erp_contract', Wave 61) instead of a new attachment
// table; the audit trail uses the existing logActivity() mechanism instead
// of a bespoke log table. Usage-based billing (CSV feature SC015) and the
// AI Contract Copilot (SC018, Pilot/Strategic tier in the source CSV) are
// deliberately deferred -- no AI feature is ported from any studied
// source, matching this codebase's standing discipline that new AI
// touches must go through the Prompt OS/Worker Agent stack, not be
// invented ad hoc.
export const erpContractStatusEnum = complianceSchemaDB.enum('erp_contract_status', ['draft', 'active', 'expired', 'terminated', 'renewed'])
export const erpContractBillingFrequencyEnum = complianceSchemaDB.enum('erp_contract_billing_frequency', ['monthly', 'quarterly', 'half_yearly', 'annually', 'milestone'])
export const erpContractAmendmentStatusEnum = complianceSchemaDB.enum('erp_contract_amendment_status', ['draft', 'approved'])
export const erpContractObligationStatusEnum = complianceSchemaDB.enum('erp_contract_obligation_status', ['pending', 'completed', 'overdue'])
export const erpSubscriptionStatusEnum = complianceSchemaDB.enum('erp_subscription_status', ['active', 'paused', 'cancelled', 'expired'])

export const erpContracts = complianceSchemaDB.table('erp_contracts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  customerId: text('customer_id').notNull(),
  contractNumber: integer('contract_number').notNull(), // per-org sequence, matching erp_purchase_orders.po_number convention
  title: text('title').notNull(),
  contractType: text('contract_type'), // free text: 'service'|'supply'|'nda'|'msa'|... -- admin-extensible, matches erp_accounts.account_type precedent
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  autoRenew: boolean('auto_renew').notNull().default(false),
  renewalNoticeDays: integer('renewal_notice_days'),
  contractValue: numeric('contract_value').notNull().default('0'),
  currencyId: text('currency_id'),
  slaResponseHours: numeric('sla_response_hours'), // simple inline SLA terms -- no separate SLA table, matching the "additive columns, not a new table" precedent used throughout this schema for single-valued attributes
  slaResolutionHours: numeric('sla_resolution_hours'),
  ownerId: text('owner_id'), // account manager, users.id
  status: erpContractStatusEnum('status').notNull().default('draft'),
  templateId: text('template_id'), // nullable -- which clm_contract_template (if any) generated bodyText
  bodyText: text('body_text'), // generated contract document text (token-substituted from a template's clauses); null until "Generate from Template" is run
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpContractAmendments = complianceSchemaDB.table('erp_contract_amendments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contractId: text('contract_id').notNull(),
  amendmentNumber: integer('amendment_number').notNull(),
  description: text('description').notNull(),
  previousValue: numeric('previous_value'),
  newValue: numeric('new_value'),
  effectiveDate: date('effective_date', { mode: 'string' }).notNull(),
  status: erpContractAmendmentStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id'),
  approvedById: text('approved_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpContractBillingSchedules = complianceSchemaDB.table('erp_contract_billing_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contractId: text('contract_id').notNull(),
  billingFrequency: erpContractBillingFrequencyEnum('billing_frequency').notNull(),
  nextBillingDate: date('next_billing_date', { mode: 'string' }).notNull(),
  amount: numeric('amount').notNull(),
  lastInvoiceId: text('last_invoice_id'), // nullable -- points at the most recent erp_sales_invoices row this schedule generated
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Revenue recognition schedule (IFRS15/ASC606-style deferred revenue) --
// one row per recognition period, generated up front when a contract's
// value spans multiple periods. Deliberately a plain schedule table, not
// wired to auto-post journal entries -- picking the correct revenue
// account is the same human judgment call Wave 60 (invoicing) already
// decided requires an explicit admin action, not silent automation.
export const erpContractRevenueSchedules = complianceSchemaDB.table('erp_contract_revenue_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contractId: text('contract_id').notNull(),
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  periodEnd: date('period_end', { mode: 'string' }).notNull(),
  recognizedAmount: numeric('recognized_amount').notNull().default('0'),
  deferredAmount: numeric('deferred_amount').notNull().default('0'),
  isRecognized: boolean('is_recognized').notNull().default(false),
  journalEntryId: text('journal_entry_id'), // nullable -- set only once an admin explicitly posts recognition for this period
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpContractObligations = complianceSchemaDB.table('erp_contract_obligations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contractId: text('contract_id').notNull(),
  description: text('description').notNull(),
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  status: erpContractObligationStatusEnum('status').notNull().default('pending'),
  responsibleUserId: text('responsible_user_id'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSubscriptionPlans = complianceSchemaDB.table('erp_subscription_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  billingFrequency: erpContractBillingFrequencyEnum('billing_frequency').notNull(),
  price: numeric('price').notNull(),
  currencyId: text('currency_id'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const erpSubscriptions = complianceSchemaDB.table('erp_subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  contractId: text('contract_id'), // nullable -- a subscription can exist without a formal contract document
  customerId: text('customer_id').notNull(),
  planId: text('plan_id').notNull(),
  status: erpSubscriptionStatusEnum('status').notNull().default('active'),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  nextRenewalDate: date('next_renewal_date', { mode: 'string' }),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const erpContractsRelations = relations(erpContracts, ({ one, many }) => ({
  customer: one(erpCustomers, { fields: [erpContracts.customerId], references: [erpCustomers.id] }),
  template: one(clmContractTemplates, { fields: [erpContracts.templateId], references: [clmContractTemplates.id] }),
  amendments: many(erpContractAmendments),
  billingSchedules: many(erpContractBillingSchedules),
  revenueSchedules: many(erpContractRevenueSchedules),
  obligations: many(erpContractObligations),
  negotiationRounds: many(erpContractNegotiationRounds),
}))
export const erpContractAmendmentsRelations = relations(erpContractAmendments, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpContractAmendments.contractId], references: [erpContracts.id] }),
}))
export const erpContractBillingSchedulesRelations = relations(erpContractBillingSchedules, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpContractBillingSchedules.contractId], references: [erpContracts.id] }),
}))
export const erpContractRevenueSchedulesRelations = relations(erpContractRevenueSchedules, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpContractRevenueSchedules.contractId], references: [erpContracts.id] }),
}))
export const erpContractObligationsRelations = relations(erpContractObligations, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpContractObligations.contractId], references: [erpContracts.id] }),
}))
export const erpSubscriptionsRelations = relations(erpSubscriptions, ({ one }) => ({
  contract: one(erpContracts, { fields: [erpSubscriptions.contractId], references: [erpContracts.id] }),
  customer: one(erpCustomers, { fields: [erpSubscriptions.customerId], references: [erpCustomers.id] }),
  plan: one(erpSubscriptionPlans, { fields: [erpSubscriptions.planId], references: [erpSubscriptionPlans.id] }),
}))

// ─── Wave 86 (Comparison CSV 2 gap analysis: CLM007 + DMS012) ──────────────
// eSignature: closes both "Electronic Contract Signing" (CLM) and "Digital
// Signature Management" (DMS) in one build -- neither `documents` nor
// `erp_contracts` had any signing capability before this wave. No paid
// e-signature provider integration (none available in this environment) --
// this is a real, first-party signing workflow with a tamper-evident audit
// trail, not a DocuSign/Documenso API wrapper. `linkedEntityType`/Id follow
// the same polymorphic convention as `documents.linkedEntityType` (Wave 61).
export const esignatureRequests = complianceSchemaDB.table('esignature_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  linkedEntityType: text('linked_entity_type').notNull(), // 'document'|'erp_contract'
  linkedEntityId: text('linked_entity_id').notNull(),
  title: text('title').notNull(),
  // For 'document': SHA-256 of the actual file bytes in storage at request
  // creation time. For 'erp_contract' (no file, a DB record): SHA-256 of a
  // canonical JSON snapshot of the contract's key terms -- see
  // esignature-service.ts's computeDocumentHash for exactly what's hashed.
  // Either way, comparing this baseline against each signer's own
  // documentHashAtSigning is what makes tampering detectable.
  documentHash: text('document_hash').notNull(),
  status: text('status').notNull().default('pending'), // 'pending'|'partially_signed'|'completed'|'declined'|'voided'
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const esignatureSigners = complianceSchemaDB.table('esignature_signers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  requestId: text('request_id').notNull(),
  name: text('name').notNull(),
  email: text('email').notNull(),
  signOrder: integer('sign_order'), // nullable -- null means parallel signing, no ordering enforced
  status: text('status').notNull().default('pending'), // 'pending'|'signed'|'declined'
  userId: text('user_id'), // nullable -- set if the signer is an internal VERIDIAN user, matching conversationGuestAccess's own internal-vs-external precedent
  // Tokenized external access, same shape as erpSupplierPortalLinks (Wave 80)
  // and conversationShareLinks (Wave 36) -- no separate invite mechanism.
  accessToken: text('access_token').notNull().unique(),
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  // Populated only once this signer actually signs -- one signer signs at
  // most once, so this is folded into the signer row rather than a separate
  // append-only signatures table (there's nothing else to append).
  signatureImageData: text('signature_image_data'), // base64 PNG (drawn) or plain text (typed name fallback)
  signatureMethod: text('signature_method'), // 'drawn'|'typed'
  signedAt: timestamp('signed_at'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  documentHashAtSigning: text('document_hash_at_signing'),
  declinedAt: timestamp('declined_at'),
  declineReason: text('decline_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const esignatureRequestsRelations = relations(esignatureRequests, ({ many }) => ({
  signers: many(esignatureSigners),
}))
export const esignatureSignersRelations = relations(esignatureSigners, ({ one }) => ({
  request: one(esignatureRequests, { fields: [esignatureSigners.requestId], references: [esignatureRequests.id] }),
}))

// ─── Wave 107 (VERI FM & CS AI OS -- Facilities Management & Corporate
// Services). See MASTER_AI_OS_ARCHITECTURE.md and the FM.md memory doc for
// the real source-document analysis this schema is built from. The stated
// success metric is ground-staff adoption, not feature completeness -- a
// prior in-house attempt at this exact product failed on that point. Two
// design decisions this wave hinges on, both explained where they occur
// below: (1) asset category is a small governed lookup table, not free
// text, because it's the join key checklist templates/PPM schedules
// depend on and free text would let it drift the same way raw asset names
// already have; (2) one asset can have MULTIPLE simultaneous active PPM
// frequencies (confirmed real data, e.g. a DG set with weekly AND monthly
// AND quarterly AND yearly checks all live at once) -- this is genuinely
// new versus compliance_items' single-frequency recurrenceType model.
export const fmPpmFrequencyEnum = complianceSchemaDB.enum('fm_ppm_frequency', ['daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'half_yearly', 'annually'])
export const fmPpmOccurrenceStatusEnum = complianceSchemaDB.enum('fm_ppm_occurrence_status', ['due', 'in_progress', 'completed', 'overdue', 'skipped'])
export const fmAmcPaymentFrequencyEnum = complianceSchemaDB.enum('fm_amc_payment_frequency', ['monthly', 'quarterly', 'half_yearly', 'annually', 'one_time'])
export const fmVisitorLogStatusEnum = complianceSchemaDB.enum('fm_visitor_log_status', ['checked_in', 'checked_out', 'denied'])

// Small, platform-governed lookup (~20 rows, seeded by migration, not
// user-creatable at runtime) -- same posture as moduleRegistry/
// orchestraLayers. This is where the #1 confirmed data-quality problem
// (equipment-class naming drift) is actually fixed, at the level where it
// matters: checklist templates and PPM schedules join on categoryId, not
// on the free-text assetName below.
export const fmAssetCategories = complianceSchemaDB.table('fm_asset_categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  categoryKey: text('category_key').notNull().unique(), // 'dg_set'|'hsd_tank'|'lt_panel'|'ht_panel'|'transformer'|'ups'|'vrv_ac'|'non_vrv_ac'|'ahu'|'chiller'|'cooling_tower'|'condenser_pump'|'borewell'|'water_tank'|'ro_system'|'uv_sterilizer'|'water_filter'|'softener'|'fire_fighting'|'passenger_lift'|'earthing_pit'|'lightning_arrestor'|'kitchen_exhaust'|'pneumatic_pump'|'sound_av_system'|'solar_system'|'carpentry_furniture'|'cctv'
  displayName: text('display_name').notNull(),
  typicalSpecUnit: text('typical_spec_unit'), // advisory only: 'KVA'|'HP'|'Ltr'|'NA' -- hints the digitization-AI prompt and manual-entry placeholder text, never validated/enforced (see fmAssets.capacitySpec below for why)
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const fmAssets = complianceSchemaDB.table('fm_assets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  locationLabel: text('location_label'), // free text this wave, e.g. "Block A - Terrace" -- no dedicated sites/locations table yet, promoted to a real FK once one exists
  categoryId: text('category_id').notNull(),
  assetName: text('asset_name').notNull(), // preserves the source spelling verbatim -- "Non VRV Ac-2", "Borewel-1" typos included, on purpose; normalizedName below is the dedup key, not this column
  normalizedName: text('normalized_name').notNull(), // service-computed on write: lowercase, trim, collapse whitespace -- what fm-asset-dedup-service.ts's trigram matching runs against. Deliberately NOT unique: dedup is human-confirmed via fmAssetDuplicateCandidates, never DB-enforced
  assetCode: text('asset_code'), // optional short human code e.g. "DG-01", independent of the QR value below
  // Deliberately free text, not a numeric value + unit enum pair. Real data
  // includes literal "NA", mixed unit families across categories (KVA vs
  // HP vs Ltr vs bare count), and formula-error artifacts -- forcing
  // structure at ingestion would either reject legitimate legacy rows or
  // silently mangle them, both wrong for a product whose stated goal is
  // REDUCING data discrepancies. fmAssetCategories.typicalSpecUnit is a
  // soft hint only.
  capacitySpec: text('capacity_spec'),
  make: text('make'),
  model: text('model'),
  serialNumber: text('serial_number'),
  installedDate: date('installed_date', { mode: 'string' }),
  status: text('status').notNull().default('active'), // 'active'|'inactive'|'decommissioned'|'under_repair'
  qrCodeValue: text('qr_code_value').unique(), // the literal string encoded in a printed QR label, scanned client-side (html5-qrcode, future UI wave); nullable until a label is generated
  amcContractId: text('amc_contract_id'), // denormalized "current AMC" pointer, maintained by fm-amc-service.ts on contract create/renewal -- same cached-pointer convention as erpSuppliers' qualification-status columns
  notes: text('notes'),
  isDuplicateOf: text('is_duplicate_of'), // self-FK, set only once a human confirms this row is a duplicate via fmAssetDuplicateCandidates review -- soft-merge marker, row is kept not deleted
  sourceType: text('source_type').notNull().default('manual'), // 'manual'|'register_digitization' -- traces provenance back to the AI-extraction pipeline
  sourceDocumentId: text('source_document_id'), // nullable -> documents.id, the uploaded register/photo this row was extracted from, if any
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Platform-owned catalog, resolved at runtime -- NOT copy-on-enable like
// PMS issue types. "UV -- Quarterly" is one real-world procedure that
// should be free for every org on enable, not something each org
// reinvents from scratch. orgId nullable: NULL = seeded platform library
// row available to every org; non-null = an org's own customized fork
// (fork-UI itself is a later wave, this column already supports it).
export const fmChecklistTemplates = complianceSchemaDB.table('fm_checklist_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id'),
  categoryId: text('category_id').notNull(),
  frequency: fmPpmFrequencyEnum('frequency').notNull(),
  name: text('name').notNull(), // "UV -- Quarterly"
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'), // nullable -- platform-seeded rows have no human author, mirrors promptVersions.createdById
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const fmChecklistTemplateItems = complianceSchemaDB.table('fm_checklist_template_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  templateId: text('template_id').notNull(),
  sequenceOrder: integer('sequence_order').notNull().default(0),
  itemText: text('item_text').notNull(), // "Check for leakage", "Clean lamp glass and check O-ring"
  itemType: text('item_type').notNull().default('checkbox'), // 'checkbox'|'photo_required'|'numeric_reading'|'text_note' -- encodes the "camera/tap over typing" adoption principle directly in the schema
  isMandatory: boolean('is_mandatory').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// THE genuinely novel piece versus compliance_items' single-frequency
// model: one asset can have N active rows here simultaneously (weekly AND
// monthly AND quarterly AND yearly, all live at once). No uniqueness on
// assetId alone -- only on (assetId, checklistTemplateId), so the SAME
// frequency can't be double-scheduled by accident.
export const fmPpmSchedules = complianceSchemaDB.table('fm_ppm_schedules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  assetId: text('asset_id').notNull(),
  checklistTemplateId: text('checklist_template_id').notNull(), // the template's own `frequency` column IS this schedule's frequency -- no separate frequency column here, avoids the two ever disagreeing
  isActive: boolean('is_active').notNull().default(true), // pausing a frequency (asset temporarily decommissioned) without losing schedule history
  nextDueDate: date('next_due_date', { mode: 'string' }).notNull(),
  lastGeneratedOccurrenceId: text('last_generated_occurrence_id'), // denormalized pointer to the most recently generated occurrence -- lets the generator cheaply check "did I already generate this one" without a reverse-scanning query
  defaultAssigneeId: text('default_assignee_id'), // nullable -- pre-fills a new occurrence's assignee (e.g. "the on-site electrician"); per-occurrence assignee can still be reassigned
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const fmPpmOccurrences = complianceSchemaDB.table('fm_ppm_occurrences', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  scheduleId: text('schedule_id').notNull(),
  assetId: text('asset_id').notNull(), // denormalized from the schedule for cheap "all occurrences for this asset" queries without a join
  dueDate: date('due_date', { mode: 'string' }).notNull(),
  status: fmPpmOccurrenceStatusEnum('status').notNull().default('due'),
  assigneeId: text('assignee_id'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  completedById: text('completed_by_id'),
  completionNotes: text('completion_notes'),
  overdueNotifiedAt: timestamp('overdue_notified_at'), // nullable -- when the overdue alert last fired, prevents re-notifying every cron tick
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Per-occurrence tick-marks/readings, deliberately separate from
// fmChecklistTemplateItems (the reusable definition) so editing a
// template's wording later never rewrites completed history. Photo
// evidence for itemType='photo_required' reuses `documents` directly
// (linkedEntityType: 'fm_ppm_occurrence_item_result') -- zero new table,
// multiple photos per result = multiple document rows sharing one
// linkedEntityId.
export const fmPpmOccurrenceItemResults = complianceSchemaDB.table('fm_ppm_occurrence_item_results', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  occurrenceId: text('occurrence_id').notNull(),
  templateItemId: text('template_item_id').notNull(), // item wording resolved at read time via join, not snapshotted -- acceptable since template edits are rare and this avoids a full snapshot-copy table for a first wave
  isChecked: boolean('is_checked').notNull().default(false),
  numericValue: numeric('numeric_value'), // used when itemType = 'numeric_reading'
  textNote: text('text_note'),
  orgId: text('org_id').notNull(),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const fmAmcContracts = complianceSchemaDB.table('fm_amc_contracts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  assetId: text('asset_id').notNull(),
  vendorId: text('vendor_id').notNull(), // -> erp_suppliers.id -- reuses the existing vendor master, no new FM-specific vendor table
  contractStartDate: date('contract_start_date', { mode: 'string' }).notNull(),
  contractEndDate: date('contract_end_date', { mode: 'string' }).notNull(),
  paymentFrequency: fmAmcPaymentFrequencyEnum('payment_frequency').notNull(),
  contractedYearlyServiceCount: integer('contracted_yearly_service_count').notNull(),
  firstServiceDate: date('first_service_date', { mode: 'string' }),
  contractValue: numeric('contract_value'),
  status: text('status').notNull().default('active'), // 'active'|'expired'|'terminated'|'renewal_pending'
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// FM-specific dedup -- deliberately NOT routed through Wave 93's MDM
// engine (mdm-quality-service.ts's assertEntityType is hardcoded to
// 'erp_customer'|'erp_supplier' and its scoring assumes gstin/pan_number
// columns that don't exist on physical assets). Matching combines pg_trgm
// similarity() on normalizedName (catches "Non VRV Ac-2" case drift,
// "Borewel-1" typos) with an optional embeddings.ts findSimilar() cross
// check for semantic near-duplicates. status='merged' on this table
// itself is the audit trail at this scale -- no separate merge-log table
// this wave.
export const fmAssetDuplicateCandidates = complianceSchemaDB.table('fm_asset_duplicate_candidates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  assetIdA: text('asset_id_a').notNull(),
  assetIdB: text('asset_id_b').notNull(),
  matchScore: numeric('match_score').notNull(), // 0..1
  matchReason: text('match_reason').notNull(), // 'trigram_name_similarity'|'embedding_similarity'|'combined'
  status: text('status').notNull().default('pending'), // 'pending'|'confirmed_duplicate'|'not_duplicate'|'merged'
  reviewedById: text('reviewed_by_id'),
  reviewedAt: timestamp('reviewed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// The flagship adoption feature's staging layer: "upload an Excel/photo of
// a physical register and AI creates the digital register." Nothing here
// ever auto-commits to fmAssets -- a row only becomes a real asset after
// an explicit human review + commit action, directly serving the stated
// "reduce data discrepancies" goal rather than just moving them digital.
export const fmRegisterDigitizationBatches = complianceSchemaDB.table('fm_register_digitization_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  sourceDocumentId: text('source_document_id').notNull(), // -> documents.id
  sourceType: text('source_type').notNull(), // 'excel'|'csv'|'photo'
  status: text('status').notNull().default('extracted'), // 'extracted'|'under_review'|'committed'|'discarded'
  totalRowsExtracted: integer('total_rows_extracted').notNull().default(0),
  totalRowsCommitted: integer('total_rows_committed').notNull().default(0),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at'),
})

export const fmRegisterDigitizationRows = complianceSchemaDB.table('fm_register_digitization_rows', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  batchId: text('batch_id').notNull(),
  orgId: text('org_id').notNull(),
  sourceRowNumber: integer('source_row_number'),
  extractedData: jsonb('extracted_data').notNull(), // raw LLM output: assetName/categoryHint/capacitySpec/make/model/locationLabel/confidence/warnings
  confidence: numeric('confidence'), // denormalized from extractedData for cheap sort/filter in the review UI
  reviewStatus: text('review_status').notNull().default('pending'), // 'pending'|'approved'|'edited'|'rejected'
  editedData: jsonb('edited_data'), // nullable -- human corrections before commit, kept separate from extractedData so the original AI output is never overwritten (an audit trail of what the AI got wrong)
  committedAssetId: text('committed_asset_id'), // nullable -> fm_assets.id, set only once this row is actually committed
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Corporate Services scope for this wave: visitor check-in/check-out only
// (canteen/transport/mailroom/meeting-room-booking are explicitly
// deferred). fmVisitors is separate from fmVisitorLogs so a repeat visitor
// (e.g. a recurring vendor technician) doesn't re-enter their details
// every visit -- front desk searches-and-selects an existing visitor,
// matching how a familiar, register-like flow should behave for reception
// staff. ID/face photos reuse `documents` (linkedEntityType:
// 'fm_visitor_log') -- only a display-safe fragment lives on this table.
export const fmVisitors = complianceSchemaDB.table('fm_visitors', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  fullName: text('full_name').notNull(),
  phoneNumber: text('phone_number'),
  idType: text('id_type'), // 'aadhaar'|'driving_license'|'passport'|'other' -- advisory, not validated
  idNumberLast4: text('id_number_last4'), // deliberately NOT the full ID number -- the readable-in-full ID photo lives in documents, access-controlled the same way erpSuppliers' KYC docs already are
  companyOrOrg: text('company_or_org'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const fmVisitorLogs = complianceSchemaDB.table('fm_visitor_logs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  visitorId: text('visitor_id').notNull(),
  hostUserId: text('host_user_id').notNull(),
  purpose: text('purpose'),
  checkInAt: timestamp('check_in_at').notNull().defaultNow(),
  checkOutAt: timestamp('check_out_at'),
  status: fmVisitorLogStatusEnum('status').notNull().default('checked_in'),
  hostNotifiedAt: timestamp('host_notified_at'), // when the host was pinged -- reuses whatever notification channel already exists, not a new mechanism
  loggedById: text('logged_by_id'), // front-desk/reception user who created the entry
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const fmAssetsRelations = relations(fmAssets, ({ one, many }) => ({
  category: one(fmAssetCategories, { fields: [fmAssets.categoryId], references: [fmAssetCategories.id] }),
  schedules: many(fmPpmSchedules),
  amcContracts: many(fmAmcContracts),
}))
export const fmChecklistTemplatesRelations = relations(fmChecklistTemplates, ({ one, many }) => ({
  category: one(fmAssetCategories, { fields: [fmChecklistTemplates.categoryId], references: [fmAssetCategories.id] }),
  items: many(fmChecklistTemplateItems),
}))
export const fmChecklistTemplateItemsRelations = relations(fmChecklistTemplateItems, ({ one }) => ({
  template: one(fmChecklistTemplates, { fields: [fmChecklistTemplateItems.templateId], references: [fmChecklistTemplates.id] }),
}))
export const fmPpmSchedulesRelations = relations(fmPpmSchedules, ({ one, many }) => ({
  asset: one(fmAssets, { fields: [fmPpmSchedules.assetId], references: [fmAssets.id] }),
  checklistTemplate: one(fmChecklistTemplates, { fields: [fmPpmSchedules.checklistTemplateId], references: [fmChecklistTemplates.id] }),
  occurrences: many(fmPpmOccurrences),
}))
export const fmPpmOccurrencesRelations = relations(fmPpmOccurrences, ({ one, many }) => ({
  schedule: one(fmPpmSchedules, { fields: [fmPpmOccurrences.scheduleId], references: [fmPpmSchedules.id] }),
  asset: one(fmAssets, { fields: [fmPpmOccurrences.assetId], references: [fmAssets.id] }),
  itemResults: many(fmPpmOccurrenceItemResults),
}))
export const fmPpmOccurrenceItemResultsRelations = relations(fmPpmOccurrenceItemResults, ({ one }) => ({
  occurrence: one(fmPpmOccurrences, { fields: [fmPpmOccurrenceItemResults.occurrenceId], references: [fmPpmOccurrences.id] }),
  templateItem: one(fmChecklistTemplateItems, { fields: [fmPpmOccurrenceItemResults.templateItemId], references: [fmChecklistTemplateItems.id] }),
}))
export const fmAmcContractsRelations = relations(fmAmcContracts, ({ one }) => ({
  asset: one(fmAssets, { fields: [fmAmcContracts.assetId], references: [fmAssets.id] }),
  vendor: one(erpSuppliers, { fields: [fmAmcContracts.vendorId], references: [erpSuppliers.id] }),
}))
export const fmRegisterDigitizationBatchesRelations = relations(fmRegisterDigitizationBatches, ({ many }) => ({
  rows: many(fmRegisterDigitizationRows),
}))
export const fmRegisterDigitizationRowsRelations = relations(fmRegisterDigitizationRows, ({ one }) => ({
  batch: one(fmRegisterDigitizationBatches, { fields: [fmRegisterDigitizationRows.batchId], references: [fmRegisterDigitizationBatches.id] }),
}))
export const fmVisitorsRelations = relations(fmVisitors, ({ many }) => ({
  logs: many(fmVisitorLogs),
}))
export const fmVisitorLogsRelations = relations(fmVisitorLogs, ({ one }) => ({
  visitor: one(fmVisitors, { fields: [fmVisitorLogs.visitorId], references: [fmVisitors.id] }),
}))

// ─── THE FIRM AI OS (Wave 108): Practice Management for CA/CS/Legal/GRC/
// Audit firms ────────────────────────────────────────────────────────────
// Product for a firm owner (4-20 staff) serving many clients across some
// mix of CA/CS/Legal/GRC/Audit services -- the `clients`/`clientEntities`
// hierarchy (Wave 1) and the per-client-scoped compliance/legal/CS/audit
// modules already do the heavy lifting; this wave adds what's genuinely
// missing: per-client service-line gating, engagement/scope-of-work,
// Indian tax-notice/appeal case workflow, staff-to-client capacity
// assignment, and client-billable time + invoicing (deliberately parallel
// to, not reusing, pmsTimeEntries -- that table is PMS-issue-scoped with
// no clientId, and conflating "internal project hours" with "billable
// client hours" would give one table two incompatible meanings).
export const firmServiceLineEnum = complianceSchemaDB.enum('firm_service_line', ['ca_services', 'cs_services', 'legal_services', 'grc_services', 'audit_services'])
export const firmFeeTypeEnum = complianceSchemaDB.enum('firm_fee_type', ['fixed', 'hourly', 'retainer'])
export const firmStaffRoleEnum = complianceSchemaDB.enum('firm_staff_role', ['partner', 'manager', 'associate', 'staff'])
export const firmInvoiceStatusEnum = complianceSchemaDB.enum('firm_invoice_status', ['draft', 'sent', 'paid', 'overdue', 'void'])

export const firmClientServiceLines = complianceSchemaDB.table('firm_client_service_lines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  serviceLine: firmServiceLineEnum('service_line').notNull(),
  isEnabled: boolean('is_enabled').notNull().default(true),
  leadStaffUserId: text('lead_staff_user_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// recurrenceType/nextOccurrenceDate/budgetedHours (added alongside the
// Client Portal): recurrenceType follows complianceItems.recurrenceType's
// exact enum precedent (free text, not a pg enum, since this table
// predates that convention decision too) -- the recurrence cron finds rows
// where nextOccurrenceDate <= today, clones a fresh engagement for the new
// period, then advances THIS row's own nextOccurrenceDate forward -- the
// same row stays the one "generator" indefinitely rather than each clone
// needing to carry recurrence itself. budgetedHours enables a real
// budget-vs-actual comparison against firm_time_entries.hours, which
// previously only fed billing, never a budget check.
export const firmEngagements = complianceSchemaDB.table('firm_engagements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  serviceLine: firmServiceLineEnum('service_line').notNull(),
  title: text('title').notNull(),
  scopeOfWork: text('scope_of_work'),
  feeType: firmFeeTypeEnum('fee_type').notNull().default('fixed'),
  feeAmount: numeric('fee_amount'),
  billingFrequency: text('billing_frequency').default('monthly'), // free text, descriptive only -- not branched on internally this wave
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  status: text('status').notNull().default('active'), // 'active'|'on_hold'|'completed'|'terminated' -- matches legalMatters.status's free-text precedent
  leadPartnerUserId: text('lead_partner_user_id'),
  recurrenceType: text('recurrence_type').notNull().default('none'), // 'none'|'monthly'|'quarterly'|'half_yearly'|'annually'
  nextOccurrenceDate: date('next_occurrence_date', { mode: 'string' }),
  budgetedHours: numeric('budgeted_hours'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Polymorphic link, deliberate reuse of documents.linkedEntityType/
// linkedEntityId's exact pattern -- points at an existing per-client
// record (compliance_item/legal_matter/audit_engagement/firm_tax_case/
// notice) so an engagement's deliverable checklist doesn't duplicate data
// that already lives in those modules; null = a standalone deliverable.
// clientVisible/submittedAt (added alongside the Client Portal): a
// deliverable defaults to client-visible (most are "send us X" requests),
// but internal-only checklist items (e.g. "partner sign-off") can be
// excluded from the portal view. submittedAt is set when the CLIENT
// (not staff) marks it done through the portal -- kept distinct from
// completedAt (staff-side completion) so "client says they sent it" and
// "we've actually reviewed and accepted it" stay two different facts.
export const firmEngagementDeliverables = complianceSchemaDB.table('firm_engagement_deliverables', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  engagementId: text('engagement_id').notNull(),
  title: text('title').notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  status: text('status').notNull().default('pending'), // 'pending'|'in_progress'|'done'|'blocked'
  linkedEntityType: text('linked_entity_type'), // 'compliance_item'|'legal_matter'|'audit_engagement'|'firm_tax_case'|'notice'|null
  linkedEntityId: text('linked_entity_id'), // no FK -- polymorphic, follows documents' precedent
  assignedToId: text('assigned_to_id'),
  clientVisible: boolean('client_visible').notNull().default(true),
  submittedAt: timestamp('submitted_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Client Portal magic-link access -- exact same shape/posture as
// erpSupplierPortalLinks (Wave 80's vendor portal): a token-bearer, no
// session, gets a scoped read-only (+ narrow self-service write) view of
// their own client record. One client can have multiple active links
// (e.g. reissued after expiry) -- token is the only secret, not the row id.
export const firmClientPortalLinks = complianceSchemaDB.table('firm_client_portal_links', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  token: text('token').notNull().unique(),
  createdById: text('created_by_id'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// The genuine new domain this wave: Indian income-tax/GST notice,
// assessment, and appeal procedural workflow. caseType/forum/stage are
// free text (not enums) since tax procedure evolves under statute
// amendments faster than a migration cycle should gate on -- matches
// legalMatters.matterType's free-text precedent for the same "sub-
// classification of a case" concept. limitationDate (statute-barred
// date) is deliberately distinct from dueDate (a procedural deadline) --
// missing the former is a firm-ending liability, missing the latter is a
// missed reminder.
export const firmTaxCases = complianceSchemaDB.table('firm_tax_cases', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  assessmentYear: text('assessment_year').notNull(), // e.g. "2023-24"
  caseType: text('case_type').notNull().default('scrutiny'), // scrutiny|reassessment|appeal|gst_notice|tds_default|refund_claim
  sectionCode: text('section_code'), // e.g. "143(3)", "148", "144" -- format varies, free text
  authority: text('authority'),
  forum: text('forum').notNull().default('ao'), // ao|cit_appeals|itat|high_court|supreme_court
  stage: text('stage').notNull().default('notice_received'), // notice_received|reply_filed|hearing|order_passed|appeal_filed|disposed
  dueDate: date('due_date', { mode: 'string' }),
  limitationDate: date('limitation_date', { mode: 'string' }), // statute-barred date, distinct from dueDate
  demandAmount: numeric('demand_amount'),
  outcome: text('outcome'),
  linkedNoticeId: text('linked_notice_id'), // -> notices.id -- reference the existing generic notice, don't duplicate it
  responsibleUserId: text('responsible_user_id'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const firmStaffAssignments = complianceSchemaDB.table('firm_staff_assignments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  userId: text('user_id').notNull(),
  role: firmStaffRoleEnum('role').notNull().default('staff'),
  allocatedHoursPerWeek: numeric('allocated_hours_per_week'),
  startDate: date('start_date', { mode: 'string' }).notNull(),
  endDate: date('end_date', { mode: 'string' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Deliberately parallel to, not reusing, pmsTimeEntries -- see the section
// header comment above for why. invoiceLineItemId is nullable and set
// once billed (prevents double-billing a time entry); added via
// ALTER TABLE after firmInvoiceLineItems exists below, same forward-FK
// pattern Wave 107 used for fmAssets.amcContractId.
export const firmTimeEntries = complianceSchemaDB.table('firm_time_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  engagementId: text('engagement_id'), // nullable -- time can be logged before an engagement is formalized
  userId: text('user_id').notNull(),
  taskDescription: text('task_description').notNull(),
  hours: numeric('hours').notNull(),
  spentOn: date('spent_on', { mode: 'string' }).notNull(),
  billable: boolean('billable').notNull().default(true),
  isRunning: boolean('is_running').notNull().default(false),
  startedAt: timestamp('started_at'),
  hourlyRateSnapshot: numeric('hourly_rate_snapshot'), // captured at billing time, not creation time
  invoiceLineItemId: text('invoice_line_item_id'), // nullable; FK added via ALTER TABLE in the migration (forward reference)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Nullable userId/clientId give a 4-tier resolution precedence (most
// specific wins): (user,client) > (user,null) > (null,client) >
// (null,null firm-wide default) -- generalizes pmsBillableRates' existing
// "null user = org default" convention by adding the client axis.
export const firmBillableRates = complianceSchemaDB.table('firm_billable_rates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  clientId: text('client_id'),
  hourlyRate: numeric('hourly_rate').notNull(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const firmInvoices = complianceSchemaDB.table('firm_invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id').notNull(),
  engagementId: text('engagement_id'),
  invoiceNumber: text('invoice_number').notNull(),
  issueDate: date('issue_date', { mode: 'string' }).notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  status: firmInvoiceStatusEnum('status').notNull().default('draft'),
  subtotal: numeric('subtotal').notNull().default('0'),
  taxAmount: numeric('tax_amount').notNull().default('0'),
  totalAmount: numeric('total_amount').notNull().default('0'),
  notes: text('notes'),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const firmInvoiceLineItems = complianceSchemaDB.table('firm_invoice_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  invoiceId: text('invoice_id').notNull(),
  description: text('description').notNull(),
  quantityHours: numeric('quantity_hours'),
  rate: numeric('rate'),
  amount: numeric('amount').notNull(),
  timeEntryId: text('time_entry_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const firmClientServiceLinesRelations = relations(firmClientServiceLines, ({ one }) => ({
  client: one(clients, { fields: [firmClientServiceLines.clientId], references: [clients.id] }),
}))
export const firmEngagementsRelations = relations(firmEngagements, ({ one, many }) => ({
  client: one(clients, { fields: [firmEngagements.clientId], references: [clients.id] }),
  deliverables: many(firmEngagementDeliverables),
  timeEntries: many(firmTimeEntries),
  invoices: many(firmInvoices),
}))
export const firmEngagementDeliverablesRelations = relations(firmEngagementDeliverables, ({ one }) => ({
  engagement: one(firmEngagements, { fields: [firmEngagementDeliverables.engagementId], references: [firmEngagements.id] }),
}))
export const firmTaxCasesRelations = relations(firmTaxCases, ({ one }) => ({
  client: one(clients, { fields: [firmTaxCases.clientId], references: [clients.id] }),
  linkedNotice: one(notices, { fields: [firmTaxCases.linkedNoticeId], references: [notices.id] }),
}))
export const firmStaffAssignmentsRelations = relations(firmStaffAssignments, ({ one }) => ({
  client: one(clients, { fields: [firmStaffAssignments.clientId], references: [clients.id] }),
}))
export const firmTimeEntriesRelations = relations(firmTimeEntries, ({ one }) => ({
  client: one(clients, { fields: [firmTimeEntries.clientId], references: [clients.id] }),
  engagement: one(firmEngagements, { fields: [firmTimeEntries.engagementId], references: [firmEngagements.id] }),
}))
export const firmInvoicesRelations = relations(firmInvoices, ({ one, many }) => ({
  client: one(clients, { fields: [firmInvoices.clientId], references: [clients.id] }),
  engagement: one(firmEngagements, { fields: [firmInvoices.engagementId], references: [firmEngagements.id] }),
  lineItems: many(firmInvoiceLineItems),
}))
export const firmInvoiceLineItemsRelations = relations(firmInvoiceLineItems, ({ one }) => ({
  invoice: one(firmInvoices, { fields: [firmInvoiceLineItems.invoiceId], references: [firmInvoices.id] }),
}))

// ─── Sales Engine (Wave 109): cross-product referral, pipeline & commission
// tracking ──────────────────────────────────────────────────────────────
// Platform-owned (no orgId column on any table here) -- a sales partner
// (reseller/consultant/referral agent/commission agent/third party) is not
// a member of any one tenant; they refer prospects INTO many different
// eventual orgs across many different products, exactly the same "no
// tenant to scope by" rationale productBranches itself already documents.
// All 5 tables get RLS enabled with ONLY a service_role_bypass policy (see
// the migration) -- no app_runtime policy at all, since there is no org_id
// and no tenant GUC means anything for an external partner. Every service
// function in sales-engine-service.ts uses the raw `db` export, never
// withTenantContext, the same posture auth-guard.ts's autoProvisionUser()
// already uses for the identical reason (creating a brand-new tenant is
// inherently a platform-level operation).
export const salesPartnerTypeEnum = complianceSchemaDB.enum('sales_partner_type', ['reseller', 'consultant', 'referral_agent', 'commission_agent', 'third_party'])
export const salesPartnerStatusEnum = complianceSchemaDB.enum('sales_partner_status', ['active', 'suspended', 'offboarded'])
// Real enum: the service layer state-machines over this exact fixed list
// with forward-only transitions (mirrors recruitment-service.ts's
// VALID_STAGE_TRANSITIONS precedent, Wave 62), not open-ended catalog data.
export const salesReferralStatusEnum = complianceSchemaDB.enum('sales_referral_status', ['clicked', 'signup_completed', 'org_provisioned', 'paid', 'lost'])
export const salesCommissionTypeEnum = complianceSchemaDB.enum('sales_commission_type', ['percentage', 'flat'])
export const salesCommissionAccrualStatusEnum = complianceSchemaDB.enum('sales_commission_accrual_status', ['accrued', 'paid', 'void'])

export const salesPartners = complianceSchemaDB.table('sales_partners', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  phone: text('phone'),
  partnerType: salesPartnerTypeEnum('partner_type').notNull(),
  status: salesPartnerStatusEnum('status').notNull().default('active'),
  companyName: text('company_name'),
  notes: text('notes'), // admin-internal, never shown on the partner dashboard
  // Long-lived dashboard access token -- replaces a full Supabase Auth
  // account for partners this wave (see sales-engine-service.ts's header
  // comment for the full rationale); same token/expiry/revocation shape
  // as erpSupplierPortalLinks/conversationGuestAccess, except long-lived
  // since partners return repeatedly rather than a one-shot submission.
  dashboardToken: text('dashboard_token').notNull().unique(),
  dashboardTokenExpiresAt: timestamp('dashboard_token_expires_at').notNull(),
  dashboardTokenRevokedAt: timestamp('dashboard_token_revoked_at'),
  createdById: text('created_by_id'), // the admin who seeded this partner -- partner self-registration is out of scope this wave
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const salesReferralLinks = complianceSchemaDB.table('sales_referral_links', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  salesPartnerId: text('sales_partner_id').notNull(),
  // Nullable = generic/any-product link (lands on /signup). Non-null =
  // product-specific link (e.g. lands on /the-firm). Free text, NOT an FK
  // -- 'forge' has no product_branches row and 'crm' is unbranched, so a
  // strict FK would reject valid values; validated against a small
  // hardcoded allowlist in the service layer instead (same posture as
  // moduleRegistry.category / productBranches.status).
  productKey: text('product_key'),
  token: text('token').notNull().unique(), // the /r/<token> segment
  label: text('label'), // partner's own name for this link, e.g. "LinkedIn bio link"
  isActive: boolean('is_active').notNull().default(true),
  clickCount: integer('click_count').notNull().default(0), // lightweight counter -- deliberately not a per-click log table
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One row per distinct referred prospect. ipAddress/userAgent captured at
// the moment of signup (the real conversion event), mirroring
// esignatureSigners' own ipAddress/userAgent-at-signing precedent -- not a
// separate high-volume click-log table.
export const salesReferrals = complianceSchemaDB.table('sales_referrals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  salesPartnerId: text('sales_partner_id').notNull(),
  salesReferralLinkId: text('sales_referral_link_id').notNull(),
  productKey: text('product_key'), // denormalized from the link at click time -- survives the link later being edited/deactivated
  status: salesReferralStatusEnum('status').notNull().default('clicked'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  authUserId: text('auth_user_id'), // the Supabase Auth UUID -- not compliance.users.id, which may not exist until org_provisioned
  orgId: text('org_id'), // set the moment autoProvisionUser() creates the org
  clickedAt: timestamp('clicked_at').notNull().defaultNow(),
  signupCompletedAt: timestamp('signup_completed_at'),
  orgProvisionedAt: timestamp('org_provisioned_at'),
  paidAt: timestamp('paid_at'),
  lostAt: timestamp('lost_at'),
  lostReason: text('lost_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const salesCommissionPlans = complianceSchemaDB.table('sales_commission_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productKey: text('product_key').notNull(), // free text, not FK -- see salesReferralLinks.productKey's own comment
  // Nullable = default plan for this product, applying to any partner type
  // without a more specific override. Non-null = override for that one
  // partner type. Resolution (most-specific-wins) is in the service layer.
  partnerType: salesPartnerTypeEnum('partner_type'),
  commissionType: salesCommissionTypeEnum('commission_type').notNull(),
  rate: numeric('rate', { precision: 6, scale: 3 }), // percentage, e.g. 15.000 = 15% -- required if commissionType='percentage'
  flatAmount: numeric('flat_amount', { precision: 12, scale: 2 }), // required if commissionType='flat'
  currency: text('currency').notNull().default('INR'),
  validFrom: timestamp('valid_from').notNull().defaultNow(),
  validTo: timestamp('valid_to'),
  isActive: boolean('is_active').notNull().default(true),
  createdById: text('created_by_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Append-only ledger, mirrors costPayments/auditLogs -- never UPDATE an
// existing row's status; a status change (accrued -> paid, or -> void)
// INSERTS a new row referencing the same salesReferralId. The "current"
// state of a referral's commission is whichever row for that referralId
// has the latest createdAt.
export const salesCommissionAccruals = complianceSchemaDB.table('sales_commission_accruals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  salesReferralId: text('sales_referral_id').notNull(),
  salesPartnerId: text('sales_partner_id').notNull(),
  productKey: text('product_key').notNull(),
  salesCommissionPlanId: text('sales_commission_plan_id'), // nullable -- a void/manual-adjustment row may not reference a plan
  dealValue: numeric('deal_value', { precision: 12, scale: 2 }), // basis this was computed from, nullable for flat-rate plans
  amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
  currency: text('currency').notNull().default('INR'),
  status: salesCommissionAccrualStatusEnum('status').notNull().default('accrued'),
  note: text('note'), // e.g. "voided: duplicate accrual", "paid via bank transfer ref #1234"
  recordedById: text('recorded_by_id'), // null for system-generated accrual rows; set for admin-recorded paid/void transitions
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const salesPartnersRelations = relations(salesPartners, ({ many }) => ({
  referralLinks: many(salesReferralLinks),
  referrals: many(salesReferrals),
  commissionAccruals: many(salesCommissionAccruals),
}))
export const salesReferralLinksRelations = relations(salesReferralLinks, ({ one, many }) => ({
  partner: one(salesPartners, { fields: [salesReferralLinks.salesPartnerId], references: [salesPartners.id] }),
  referrals: many(salesReferrals),
}))
export const salesReferralsRelations = relations(salesReferrals, ({ one, many }) => ({
  partner: one(salesPartners, { fields: [salesReferrals.salesPartnerId], references: [salesPartners.id] }),
  link: one(salesReferralLinks, { fields: [salesReferrals.salesReferralLinkId], references: [salesReferralLinks.id] }),
  commissionAccruals: many(salesCommissionAccruals),
}))
export const salesCommissionPlansRelations = relations(salesCommissionPlans, ({ many }) => ({
  accruals: many(salesCommissionAccruals),
}))
export const salesCommissionAccrualsRelations = relations(salesCommissionAccruals, ({ one }) => ({
  referral: one(salesReferrals, { fields: [salesCommissionAccruals.salesReferralId], references: [salesReferrals.id] }),
  partner: one(salesPartners, { fields: [salesCommissionAccruals.salesPartnerId], references: [salesPartners.id] }),
  plan: one(salesCommissionPlans, { fields: [salesCommissionAccruals.salesCommissionPlanId], references: [salesCommissionPlans.id] }),
}))

// ─── LLM Response Cache (Wave 110, AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md) ──
// Deliberately NOT the same shape as embeddingCache -- that table's cache
// key is a bare content hash because identical text always embeds
// identically regardless of tenant, making a global cache always safe.
// An LLM *completion* for the same prompt text is NOT guaranteed safe to
// share across orgs (a system prompt can carry implicit per-org context),
// so cacheKey here is a hash of (orgId + provider + model + systemPrompt +
// userMessage), never a bare prompt hash -- see callLLMCached() in
// llm-client.ts, which is opt-in per caller, not automatic at every
// existing call site. expiresAt exists because business-data answers go
// stale in a way static embedded text never does.
export const llmResponseCache = complianceSchemaDB.table('llm_response_cache', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  cacheKey: text('cache_key').notNull().unique(),
  content: text('content').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at').notNull(),
})

// --- Wave 113: Visitor Intelligence (VERIDIAN SALES AI) ----------------------
// Anonymous public-site analytics feeding the Sales Engine's conversion
// mission: who visited which product page, how many times, which section
// they reached before leaving, which exit-intent offer they were shown, and
// whether they converted to a signup. Platform-owned (no orgId) -- a public
// visitor belongs to no tenant -- so RLS is service_role_bypass-only and the
// service uses the raw `db` client, the exact posture of the Wave 109 sales
// tables. The visitor_id is a self-generated anonymous id stored client-side;
// no name/email is ever collected pre-signup (see /privacy).
export const visitorSessions = complianceSchemaDB.table('visitor_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  visitorId: text('visitor_id').notNull().unique(),
  firstSeenAt: timestamp('first_seen_at').notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  visitCount: integer('visit_count').notNull().default(1),
  firstPage: text('first_page'),
  lastPage: text('last_page'),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  convertedOrgId: text('converted_org_id'),
  convertedAt: timestamp('converted_at'),
})

export const visitorEvents = complianceSchemaDB.table('visitor_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  visitorId: text('visitor_id').notNull(),
  // page_view | section_view | cta_click | exit | offer_shown | offer_clicked
  // | offer_dismissed | signup_completed
  eventType: text('event_type').notNull(),
  page: text('page').notNull(),
  productKey: text('product_key'),
  section: text('section'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Landing-page lead capture (Join Us / Contact Us). Same platform-owned,
// service_role_bypass posture as visitorSessions/visitorEvents above --
// keyed by the same anonymous visitorId so an abandoned draft is still
// captured even if the visitor never submits.
export const contactSubmissions = complianceSchemaDB.table('contact_submissions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  visitorId: text('visitor_id').notNull(),
  category: text('category'), // 'associate' | 'sales_partner' | 'ai_researcher' | null
  name: text('name'),
  email: text('email'),
  mobile: text('mobile'),
  message: text('message'),
  status: text('status').notNull().default('draft'), // 'draft' | 'submitted'
  confirmToken: text('confirm_token'),
  emailConfirmedAt: timestamp('email_confirmed_at'),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// FORGE intake requests -- same platform-owned, service_role_bypass posture
// as contactSubmissions above. selectionPath is the ordered Mode Pill +
// Chain Selector walk (node keys); selectionLabels is the same walk in
// human-readable form, denormalized so the FORGE team never has to re-derive
// labels from a taxonomy that may have since changed.
export const forgeProjectRequests = complianceSchemaDB.table('forge_project_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  visitorId: text('visitor_id').notNull(),
  selectionPath: jsonb('selection_path').notNull().default([]),
  selectionLabels: jsonb('selection_labels').notNull().default([]),
  notes: text('notes'),
  email: text('email'),
  status: text('status').notNull().default('draft'), // 'draft' | 'submitted'
  confirmToken: text('confirm_token'),
  emailConfirmedAt: timestamp('email_confirmed_at'),
  submittedAt: timestamp('submitted_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── Connectors (sidebar one-click OAuth: Gmail / Google Drive / Google
// Calendar via Composio) ───────────────────────────────────────────────
// Per-user, not per-org: the OAuth grant belongs to the individual whose
// mailbox/calendar it is, same posture as personal_model_config. toolkitSlug
// is Composio's own identifier ('gmail'|'googledrive'|'googlecalendar'),
// composioConnectedAccountId is Composio's ca_* id -- the actual OAuth
// tokens live in Composio, never touch this DB, mirroring how BYO API keys
// are encrypted-at-rest rather than stored raw anywhere in this codebase.
export const connectorAccounts = complianceSchemaDB.table('connector_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  toolkitSlug: text('toolkit_slug').notNull(), // 'gmail' | 'googledrive' | 'googlecalendar'
  composioConnectedAccountId: text('composio_connected_account_id').notNull(),
  status: text('status').notNull().default('INITIALIZING'), // Composio's own status vocabulary: INITIALIZING | ACTIVE | FAILED | EXPIRED
  connectedEmail: text('connected_email'), // populated once known, for display ("Connected as x@gmail.com")
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── VERI Reward (gamification + refer-and-earn) ────────────────────────
// Per docs/research/VERI_REWARD_EVALUATION.md: one module, one currency --
// every gamification event AND every referral event resolve to exactly one
// write path, an insert into veri_reward_points_ledger. Deliberately NOT
// reusing sales_partners/sales_referral_links/sales_referrals/
// sales_commission_accruals (Wave 109) -- that system is platform-owned,
// deliberately RLS-free, for external B2B partners with real currency
// commissions; these are org-scoped, RLS-protected, points-only (Boss
// decision 2026-07-08: points only, no cash bridge for now).

// Append-only ledger -- current balance is SUM(delta), never a separately-
// maintained counter, same discipline sales_commission_accruals already
// uses for money, applied here to points.
export const veriRewardPointsLedger = complianceSchemaDB.table('veri_reward_points_ledger', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  delta: integer('delta').notNull(), // positive award, negative redemption/void
  sourceType: text('source_type').notNull(), // 'achievement_unlock' | 'streak' | 'referral' | 'manual_adjustment' | 'redemption'
  sourceId: text('source_id'), // points to the achievement_unlock/referral row etc.
  reason: text('reason'), // human-readable, shown in the user's activity feed
  createdById: text('created_by_id'), // null for system-awarded, set for admin manual adjustment
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Org-configurable (e.g. HR sets its own thresholds) but ships with
// platform-default rows (orgId null) -- same scope-resolution shape as
// module_rule_configs (platform default, org override).
export const veriRewardAchievementDefinitions = complianceSchemaDB.table('veri_reward_achievement_definitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id'), // NULL = platform default, visible to every org until overridden
  achievementKey: text('achievement_key').notNull(), // 'first_compliance_item' | 'login_streak_3' | 'weekly_task_5' ...
  context: text('context').notNull(), // 'product_engagement' | 'hr_performance' | 'team_gamification' | 'internal_ops'
  displayName: text('display_name').notNull(),
  description: text('description'),
  icon: text('icon'),
  targetValue: integer('target_value').notNull(), // e.g. 5 (tasks), 3 (streak days)
  pointsReward: integer('points_reward').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// One row per user per achievement (unique below) -- prevents double-award,
// and IS the "instant" unlock event an API response payload reads back
// synchronously in the same request that triggered it.
export const veriRewardAchievementUnlocks = complianceSchemaDB.table('veri_reward_achievement_unlocks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  achievementDefinitionId: text('achievement_definition_id').notNull(),
  progressValue: integer('progress_value').notNull().default(0), // current count toward targetValue -- real backing number for a progress bar
  unlockedAt: timestamp('unlocked_at'), // null while in progress, set the instant targetValue is reached
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Grace-window streak state -- deliberately its own table, not folded into
// achievement_unlocks, because a streak's current count resets on a genuine
// miss (past the grace window) in a way a one-time achievement never does.
// Anti-dark-pattern design: one missed day holds via graceUsedAt rather than
// zeroing immediately.
export const veriRewardStreaks = complianceSchemaDB.table('veri_reward_streaks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  streakKey: text('streak_key').notNull(), // 'daily_login' | 'weekly_task_completion' etc.
  currentCount: integer('current_count').notNull().default(0),
  longestCount: integer('longest_count').notNull().default(0),
  lastIncrementedAt: timestamp('last_incremented_at'),
  graceUsedAt: timestamp('grace_used_at'), // set when a missed day consumed this cycle's one grace allowance
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Reuses the Sales Engine's proven 5-state shape (clicked -> signup_completed
// -> org_provisioned -> paid -> lost) and mechanics (token link, click
// count, claim-most-recent-on-signup) as a PATTERN, not the tables
// themselves -- org-scoped and RLS-protected here, unlike sales_referrals.
// rewardPoints only (no currency column): Boss decision 2026-07-08 was
// points-only, no cash-payout bridge into sales-engine-service.ts for now.
export const veriRewardReferrals = complianceSchemaDB.table('veri_reward_referrals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(), // the REFERRER's org -- real tenant scope, unlike sales_referrals
  referrerUserId: text('referrer_user_id').notNull(),
  referralToken: text('referral_token').notNull().unique(),
  targetType: text('target_type').notNull(), // 'customer_to_customer' | 'veridian_growth'
  status: text('status').notNull().default('clicked'), // clicked | signup_completed | org_provisioned | paid | lost
  referredOrgId: text('referred_org_id'), // set once the referred org exists
  referredUserId: text('referred_user_id'),
  clickCount: integer('click_count').notNull().default(0),
  rewardPoints: integer('reward_points'), // credited to referrer's veri_reward_points_ledger via sourceType='referral'
  clickedAt: timestamp('clicked_at'),
  signupCompletedAt: timestamp('signup_completed_at'),
  orgProvisionedAt: timestamp('org_provisioned_at'),
  paidAt: timestamp('paid_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Token Usage Ledger (Finance) ────────────────────────────────────────
// Built 2026-07-08 after a real gap: the AI Team's repo-write dispatches
// (scripts/ai-workforce-agent.mjs, running in GitHub Actions, no Postgres
// access) had ZERO internal record of their own OpenRouter spend -- the
// only way to answer "how much did we spend and on what" was to query
// OpenRouter's own billing API directly. orchestra_executions (Wave 23)
// already covers customer-facing product usage (per-org, per-layer) but
// requires a NOT NULL orgId + orchestraLayerId, so it structurally can't
// represent platform-internal AI Team spend (no org, no Orchestra Layer).
// This is the unified ledger Finance owns: `scope` distinguishes internal
// AI Team dispatch usage from product/customer usage, so orgId/userId/
// roleKey/layerKey are all nullable and populated per-scope.
export const tokenUsageLedger = complianceSchemaDB.table('token_usage_ledger', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  scope: text('scope').notNull(), // 'ai_team_internal' | 'product_orchestra'
  orgId: text('org_id'), // null for ai_team_internal (platform-owned, no tenant)
  userId: text('user_id'), // the end user, when applicable
  roleKey: text('role_key'), // AI Team role_key (src/lib/ai-team/roster.ts), when scope='ai_team_internal'
  layerKey: text('layer_key'), // Orchestra Layer key, when scope='product_orchestra'
  taskSummary: text('task_summary'), // short description of what the call was for, for human review
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens').notNull().default(0),
  completionTokens: integer('completion_tokens').notNull().default(0),
  estimatedCostUsd: numeric('estimated_cost_usd'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── VERIDIAN Computational Engine Library (VCEL) ────────────────────────
// Built 2026-07-08 per the founder's "VERIDIAN Computational Engineering"
// principle: every deterministic business computation should be executed
// by real software, never an LLM -- AI does reasoning/communication/
// prediction/decision-support, engines do the math. This is the
// discoverable catalog (mirrors capability-registry-service.ts's posture
// for worker agents/modules: a real, queryable inventory, not a doc that
// drifts) so the "can software complete this task?" routing step in the
// founder's own diagram has something real to check against.
//
// Status is graded honestly, not aspirationally: 'implemented' means a
// real, cited implementationRef exists and was verified via direct code
// read (not assumed); 'partial' means the capability exists but embedded
// inside a larger service rather than as a standalone reusable engine;
// 'not_started' is the honest majority for a ~250-entry taxonomy audited
// in one pass. openSourceRef notes when a standard OSS library is the
// right build vs. hand-rolling a formula, per the founder's own "don't
// recreate what you can copy" principle.
export const computationEngines = complianceSchemaDB.table('computation_engines', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  engineKey: text('engine_key').notNull().unique(), // stable slug, e.g. 'gst_split_engine'
  name: text('name').notNull(), // display name, e.g. "GST Split Engine"
  category: text('category').notNull(), // one of the founder's 25 domain groupings, e.g. "GST Engine"
  description: text('description'),
  status: text('status').notNull().default('not_started'), // 'implemented' | 'partial' | 'not_started'
  implementationRef: text('implementation_ref'), // file path (+ function name) when implemented/partial, verified not assumed
  openSourceRef: text('open_source_ref'), // note on a standard OSS library to use instead of hand-rolling, when applicable
  inputSchema: jsonb('input_schema').notNull().default({}),
  outputSchema: jsonb('output_schema').notNull().default({}),
  notes: text('notes'), // honest caveats, e.g. "conflicts with prior Wave 35 decision to use LLM Vision over OCR libs"
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// ─── GST Verification & Reconciliation Engine ────────────────────────────
// Built 2026-07-08. Deterministic import -> validate -> reconcile -> file
// pipeline for CAs/accountants (design: veridian_gst_engine_design memory).
// Studied resilient-tech/india-compliance's GSTR-1/3B JSON shape and 2A/2B
// reconciliation approach as reference (GPL-3.0 -- no code copied; the GSTN
// JSON schema itself is public government spec, safe to implement clean-room
// -- same posture as the existing erpEInvoiceLogs comment above). One
// canonical invoice schema is used for every import source (Excel/CSV/Tally/
// Busy/Zoho Books) rather than a table per source -- gstSourceProfiles holds
// the per-client, per-source learned column mapping so re-imports auto-map
// with no AI involved. AI only touches gstAiReviewReports at the very end;
// every table before it is pure deterministic compute (VCEL principle).
export const gstSourceTypeEnum = complianceSchemaDB.enum('gst_source_type', ['excel_generic', 'csv_generic', 'tally_xml', 'busy', 'zoho_books'])
export const gstInvoiceDirectionEnum = complianceSchemaDB.enum('gst_invoice_direction', ['sales', 'purchase', 'gstr2b'])
export const gstImportBatchStatusEnum = complianceSchemaDB.enum('gst_import_batch_status', ['processing', 'staged', 'confirmed', 'failed', 'cancelled'])
export const gstFindingSeverityEnum = complianceSchemaDB.enum('gst_finding_severity', ['error', 'warning', 'info'])
export const gstMatchTypeEnum = complianceSchemaDB.enum('gst_match_type', ['exact', 'probable', 'mismatch', 'missing_in_2b', 'missing_in_books'])
export const gstReturnTypeEnum = complianceSchemaDB.enum('gst_return_type', ['gstr1', 'gstr3b'])
export const gstReturnStatusEnum = complianceSchemaDB.enum('gst_return_status', ['draft', 'generated', 'filed'])

export const gstImportBatches = complianceSchemaDB.table('gst_import_batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'), // nullable -- which VERIDIAN client this import is for, when the org is a CA firm filing on a client's behalf
  sourceType: gstSourceTypeEnum('source_type').notNull(),
  direction: gstInvoiceDirectionEnum('direction').notNull(),
  period: text('period').notNull(), // 'YYYY-MM'
  fileName: text('file_name').notNull(),
  fileType: text('file_type').notNull(),
  fileSizeBytes: integer('file_size_bytes'),
  status: gstImportBatchStatusEnum('status').notNull().default('processing'),
  totalRows: integer('total_rows'),
  stagedCount: integer('staged_count'),
  confirmedCount: integer('confirmed_count'),
  errorMessage: text('error_message'),
  uploadedById: text('uploaded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  confirmedAt: timestamp('confirmed_at'),
  cancelledAt: timestamp('cancelled_at'),
})

// Learned column mapping per org+client+sourceType -- the "auto-map columns"
// requirement without any AI: first import is fuzzy-matched (column-mapper.ts)
// and confirmed once by the user, then reused for every later import from the
// same accounting software so headers never need re-mapping.
export const gstSourceProfiles = complianceSchemaDB.table('gst_source_profiles', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  sourceType: gstSourceTypeEnum('source_type').notNull(),
  name: text('name').notNull().default('Default'),
  columnMapping: jsonb('column_mapping').notNull().default({}), // { canonicalField: sourceHeader }
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Pre-confirmation staging -- raw parsed row + best-effort mapped row, kept
// for audit trail and so a bad auto-map can be corrected before it ever
// touches gstCanonicalInvoices.
export const gstImportStagingRows = complianceSchemaDB.table('gst_import_staging_rows', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  batchId: text('batch_id').notNull(),
  sourceRow: integer('source_row'),
  rawData: jsonb('raw_data').notNull(),
  mappedData: jsonb('mapped_data').notNull(),
  mappingConfidence: numeric('mapping_confidence'), // 0-1, avg confidence of the fuzzy column match
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const gstCanonicalInvoices = complianceSchemaDB.table('gst_canonical_invoices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  batchId: text('batch_id'), // nullable -- the import batch this row was confirmed from
  direction: gstInvoiceDirectionEnum('direction').notNull(),
  period: text('period').notNull(),
  sourceType: gstSourceTypeEnum('source_type').notNull(),
  counterpartyGstin: text('counterparty_gstin'), // supplier GSTIN for purchase/2B rows, buyer GSTIN for sales rows
  counterpartyName: text('counterparty_name'),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceDate: date('invoice_date', { mode: 'string' }).notNull(),
  placeOfSupply: text('place_of_supply'), // 2-digit GST state code
  invoiceType: text('invoice_type').notNull().default('b2b'), // b2b | b2cl | b2cs | cdnr | exports | sez
  taxableValue: numeric('taxable_value').notNull().default('0'),
  cgstAmount: numeric('cgst_amount').notNull().default('0'),
  sgstAmount: numeric('sgst_amount').notNull().default('0'),
  igstAmount: numeric('igst_amount').notNull().default('0'),
  cessAmount: numeric('cess_amount').notNull().default('0'),
  totalValue: numeric('total_value').notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const gstCanonicalInvoiceItems = complianceSchemaDB.table('gst_canonical_invoice_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  invoiceId: text('invoice_id').notNull(),
  hsnSacCode: text('hsn_sac_code'),
  description: text('description'),
  quantity: numeric('quantity').notNull().default('1'),
  rate: numeric('rate').notNull().default('0'),
  taxableValue: numeric('taxable_value').notNull().default('0'),
  gstRatePercent: numeric('gst_rate_percent').notNull().default('0'),
  cgstAmount: numeric('cgst_amount').notNull().default('0'),
  sgstAmount: numeric('sgst_amount').notNull().default('0'),
  igstAmount: numeric('igst_amount').notNull().default('0'),
})

// GSTIN checksum + optional public-lookup cache, so repeated imports of the
// same counterparty don't recompute/re-lookup every time.
export const gstGstinMaster = complianceSchemaDB.table('gst_gstin_master', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  gstin: text('gstin').notNull().unique(),
  checksumValid: boolean('checksum_valid').notNull(),
  legalName: text('legal_name'),
  tradeName: text('trade_name'),
  stateCode: text('state_code'),
  lookupStatus: text('lookup_status'), // 'active' | 'cancelled' | 'unknown' -- from a public GSTIN lookup, when available
  lastCheckedAt: timestamp('last_checked_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Reference HSN/SAC -> default GST rate, seeded with a common starter set;
// used by the validation engine to flag an invoice's applied rate against
// the code's expected rate.
export const gstHsnMaster = complianceSchemaDB.table('gst_hsn_master', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  hsnSacCode: text('hsn_sac_code').notNull().unique(),
  description: text('description'),
  defaultGstRatePercent: numeric('default_gst_rate_percent'),
  isService: boolean('is_service').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const gstValidationFindings = complianceSchemaDB.table('gst_validation_findings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  batchId: text('batch_id'),
  invoiceId: text('invoice_id'),
  ruleCode: text('rule_code').notNull(), // e.g. 'gstin_checksum_failed', 'duplicate_invoice', 'invoice_number_gap', 'hsn_unknown', 'tax_mismatch', 'interstate_split_error'
  severity: gstFindingSeverityEnum('severity').notNull(),
  message: text('message').notNull(),
  suggestedFix: text('suggested_fix'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at'),
})

export const gstReconciliationRuns = complianceSchemaDB.table('gst_reconciliation_runs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  period: text('period').notNull(),
  purchaseBatchId: text('purchase_batch_id'),
  gstr2bBatchId: text('gstr2b_batch_id'),
  status: text('status').notNull().default('running'), // running | completed | failed
  totalPurchaseRows: integer('total_purchase_rows'),
  total2bRows: integer('total_2b_rows'),
  exactMatches: integer('exact_matches'),
  probableMatches: integer('probable_matches'),
  mismatches: integer('mismatches'),
  missingIn2b: integer('missing_in_2b'),
  missingInBooks: integer('missing_in_books'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})

export const gstReconciliationMatches = complianceSchemaDB.table('gst_reconciliation_matches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  runId: text('run_id').notNull(),
  purchaseInvoiceId: text('purchase_invoice_id'),
  gstr2bInvoiceId: text('gstr2b_invoice_id'),
  matchType: gstMatchTypeEnum('match_type').notNull(),
  confidenceScore: numeric('confidence_score'), // 0-1
  deltaAmount: numeric('delta_amount'), // total_value difference, 0 for exact matches
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const gstReturnPeriods = complianceSchemaDB.table('gst_return_periods', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  clientId: text('client_id'),
  period: text('period').notNull(),
  gstin: text('gstin').notNull(),
  returnType: gstReturnTypeEnum('return_type').notNull(),
  status: gstReturnStatusEnum('status').notNull().default('draft'),
  generatedJson: jsonb('generated_json'), // the GSTN-schema-shaped JSON, ready for offline-tool import / portal upload
  summary: jsonb('summary'), // totals by section (b2b/b2cl/b2cs/cdnr/hsn) for the review UI
  generatedById: text('generated_by_id'),
  generatedAt: timestamp('generated_at'),
  filedAt: timestamp('filed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// The one AI-touched table in this whole module -- a narrative risk report
// generated FROM the deterministic findings/matches/totals above, never the
// source of them.
export const gstAiReviewReports = complianceSchemaDB.table('gst_ai_review_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  returnPeriodId: text('return_period_id').notNull(),
  reportText: text('report_text').notNull(),
  riskFlags: jsonb('risk_flags').notNull().default([]),
  provider: text('provider'),
  model: text('model'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const gstImportBatchesRelations = relations(gstImportBatches, ({ many }) => ({
  stagingRows: many(gstImportStagingRows),
}))

export const gstImportStagingRowsRelations = relations(gstImportStagingRows, ({ one }) => ({
  batch: one(gstImportBatches, { fields: [gstImportStagingRows.batchId], references: [gstImportBatches.id] }),
}))

export const gstCanonicalInvoicesRelations = relations(gstCanonicalInvoices, ({ many }) => ({
  items: many(gstCanonicalInvoiceItems),
}))

export const gstCanonicalInvoiceItemsRelations = relations(gstCanonicalInvoiceItems, ({ one }) => ({
  invoice: one(gstCanonicalInvoices, { fields: [gstCanonicalInvoiceItems.invoiceId], references: [gstCanonicalInvoices.id] }),
}))

export const gstReconciliationRunsRelations = relations(gstReconciliationRuns, ({ many }) => ({
  matches: many(gstReconciliationMatches),
}))

export const gstReconciliationMatchesRelations = relations(gstReconciliationMatches, ({ one }) => ({
  run: one(gstReconciliationRuns, { fields: [gstReconciliationMatches.runId], references: [gstReconciliationRuns.id] }),
}))

export const gstReturnPeriodsRelations = relations(gstReturnPeriods, ({ many }) => ({
  aiReviewReports: many(gstAiReviewReports),
}))

export const gstAiReviewReportsRelations = relations(gstAiReviewReports, ({ one }) => ({
  returnPeriod: one(gstReturnPeriods, { fields: [gstAiReviewReports.returnPeriodId], references: [gstReturnPeriods.id] }),
}))

// ─── Construction Intelligence (Wave 115, PROJEXA foundation) ────────────
// Scope of Work/BOQ, Work Progress hierarchy, Daily Site Diary. Built inside
// VERIDIAN AI OS per the Boss decision (2026-07-08) to expose every
// construction module via /api/v1 rather than duplicate it inside the
// separate PROJEXA product -- PROJEXA is a thin client consuming this data.
// No GPL/AGPL code copied (OpenConstructionERP is AGPL-3.0) -- only domain
// concepts studied, matching this repo's existing GST-engine precedent.
export const constructionBoqStatusEnum = complianceSchemaDB.enum('construction_boq_status', ['draft', 'submitted', 'approved', 'superseded'])

// Bill of Quantities. Revisions form a chain via parentBoqId (v1 -> v2 ->
// v3); comparison between two versions is computed at read time by
// construction-boq-service.ts (diff by lineItem.itemCode), never stored --
// matches this codebase's preference for live aggregation over denormalized
// diff tables (see custom-report-service.ts).
export const constructionBoqs = complianceSchemaDB.table('construction_boqs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  version: integer('version').notNull().default(1),
  parentBoqId: text('parent_boq_id'), // self-FK -- previous revision in the chain
  title: text('title').notNull(),
  status: constructionBoqStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id').notNull(),
  approvedById: text('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

export const constructionBoqLineItems = complianceSchemaDB.table('construction_boq_line_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  boqId: text('boq_id').notNull(),
  activityId: text('activity_id'), // nullable -- optional link to constructionActivities, used by the "warn if scope already executed" guard
  itemCode: text('item_code'), // stable key used for revision-to-revision diffing when present; service falls back to description match otherwise
  description: text('description').notNull(),
  unit: text('unit').notNull(),
  quantity: numeric('quantity').notNull().default('0'),
  rate: numeric('rate').notNull().default('0'),
  amount: numeric('amount').notNull().default('0'), // quantity * rate, computed by the service layer on write (not a DB generated column, matching this codebase's convention elsewhere)
  // Wave 125 (OpenConstructionERP-style rate analysis/cost buildup, studied
  // the concept only -- OpenConstructionERP is AGPL-3.0, no code copied):
  // all nullable, so plain BOQ line items (no rate breakdown) keep working
  // unchanged. When present, computedRate() in construction-boq-service.ts
  // derives rate = (material+labour+equipment) * (1+overhead%) * (1+profit%)
  // at read time -- not stored redundantly against the existing `rate` column.
  materialCost: numeric('material_cost'),
  labourCost: numeric('labour_cost'),
  equipmentCost: numeric('equipment_cost'),
  overheadPercent: numeric('overhead_percent'),
  profitPercent: numeric('profit_percent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Work Progress classification hierarchy: Category (e.g. "Civil") ->
// Activity (e.g. "Brickwork"), both project-scoped. Deliberately NOT reusing
// projects.parentProjectId -- child-project grouping is a different
// concept/cardinality than line-item classification within one project.
export const constructionCategories = complianceSchemaDB.table('construction_categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  parentCategoryId: text('parent_category_id'), // self-FK -- sub-categories
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionActivities = complianceSchemaDB.table('construction_activities', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  categoryId: text('category_id').notNull(),
  name: text('name').notNull(),
  unit: text('unit'),
  plannedQuantity: numeric('planned_quantity'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// Daily quantity/percent-complete log against one activity. Photos attach via
// the existing documents table (linkedEntityType='construction_work_progress',
// linkedEntityId=this row's id) -- no new file-storage plumbing needed.
export const constructionWorkProgressEntries = complianceSchemaDB.table('construction_work_progress_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  activityId: text('activity_id').notNull(),
  entryDate: date('entry_date', { mode: 'string' }).notNull(),
  quantityDone: numeric('quantity_done').notNull().default('0'),
  percentComplete: integer('percent_complete').notNull().default(0), // 0-100, cumulative for the activity as of entryDate
  remarks: text('remarks'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// One row per project per day. Unique(projectId, diaryDate) enforced in the
// migration SQL -- this table's Drizzle definition doesn't model composite
// constraints, matching this codebase's convention of keeping RLS and
// composite constraints in the raw SQL rather than the Drizzle layer.
export const constructionSiteDiaries = complianceSchemaDB.table('construction_site_diaries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  diaryDate: date('diary_date', { mode: 'string' }).notNull(),
  weather: text('weather'),
  workDone: text('work_done'),
  visitors: text('visitors'),
  issues: text('issues'),
  instructions: text('instructions'),
  materialReceived: text('material_received'),
  labourCount: integer('labour_count'),
  remarks: text('remarks'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionBoqsRelations = relations(constructionBoqs, ({ many }) => ({
  lineItems: many(constructionBoqLineItems),
}))

export const constructionBoqLineItemsRelations = relations(constructionBoqLineItems, ({ one }) => ({
  boq: one(constructionBoqs, { fields: [constructionBoqLineItems.boqId], references: [constructionBoqs.id] }),
}))

export const constructionCategoriesRelations = relations(constructionCategories, ({ many }) => ({
  activities: many(constructionActivities),
}))

export const constructionActivitiesRelations = relations(constructionActivities, ({ one, many }) => ({
  category: one(constructionCategories, { fields: [constructionActivities.categoryId], references: [constructionCategories.id] }),
  progressEntries: many(constructionWorkProgressEntries),
}))

export const constructionWorkProgressEntriesRelations = relations(constructionWorkProgressEntries, ({ one }) => ({
  activity: one(constructionActivities, { fields: [constructionWorkProgressEntries.activityId], references: [constructionActivities.id] }),
}))

// ─── Construction Intelligence (Wave 116) ─────────────────────────────────
// Manpower/Attendance. constructionLabourRoster deliberately has no userId
// FK -- site labour rarely has login accounts (employeeProfiles.userId is
// notNull().unique(), ruling out extending it); attendance is recorded by a
// supervisor/foreman, not self-service. vendorId links subcontracted labour
// to the existing erpSuppliers table rather than duplicating vendor data.
export const constructionAttendanceStatusEnum = complianceSchemaDB.enum('construction_attendance_status', ['present', 'absent', 'half_day'])

export const constructionLabourRoster = complianceSchemaDB.table('construction_labour_roster', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  trade: text('trade'), // free text (civil/electrical/painter/carpenter/plumber/POP/tiles etc.) -- advisory, not enum-enforced, same posture as documents.category
  skillLevel: text('skill_level'),
  vendorId: text('vendor_id'), // nullable FK to erp_suppliers -- subcontracted labour
  dailyRate: numeric('daily_rate').notNull().default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionAttendance = complianceSchemaDB.table('construction_attendance', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  rosterId: text('roster_id').notNull(),
  attendanceDate: date('attendance_date', { mode: 'string' }).notNull(),
  status: constructionAttendanceStatusEnum('status').notNull().default('present'),
  hoursWorked: numeric('hours_worked'),
  dailyCost: numeric('daily_cost').notNull().default('0'), // computed by the service layer at write time from roster.dailyRate (half_day = half rate), not a DB generated column
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionLabourRosterRelations = relations(constructionLabourRoster, ({ many }) => ({
  attendance: many(constructionAttendance),
}))

export const constructionAttendanceRelations = relations(constructionAttendance, ({ one }) => ({
  roster: one(constructionLabourRoster, { fields: [constructionAttendance.rosterId], references: [constructionLabourRoster.id] }),
}))

// ─── Construction Intelligence (Wave 117) ─────────────────────────────────
// KPI module: designer-fills / manager-approves workflow, modeled as a
// definitions+entries pair (not an extension of kpi-hub-service.ts, which is
// a hardcoded 5-metric scorecard, not a real definitions framework). Role
// gating (submit=member, approve=manager+) reuses the existing
// admin/manager/member rank system rather than introducing new role labels
// -- employeeProfiles.jobTitle already carries free-text designations
// ("Site Engineer", "QS Engineer") for display.
export const constructionKpiPeriodEnum = complianceSchemaDB.enum('construction_kpi_period', ['monthly', 'quarterly', 'milestone'])
export const constructionKpiApprovalStatusEnum = complianceSchemaDB.enum('construction_kpi_approval_status', ['draft', 'submitted', 'approved'])

export const constructionKpiDefinitions = complianceSchemaDB.table('construction_kpi_definitions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id'), // nullable -- org-wide KPIs (e.g. "Designer Hours Utilized") vs. project-scoped ones
  metricName: text('metric_name').notNull(),
  targetValue: numeric('target_value'),
  unit: text('unit'),
  period: constructionKpiPeriodEnum('period').notNull().default('monthly'),
  ownerId: text('owner_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionKpiEntries = complianceSchemaDB.table('construction_kpi_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  kpiDefinitionId: text('kpi_definition_id').notNull(),
  period: text('period').notNull(), // free-text period label, e.g. '2026-07' or a milestone id -- shape depends on the definition's `period` cadence
  actualValue: numeric('actual_value').notNull(),
  filledById: text('filled_by_id').notNull(),
  approvalStatus: constructionKpiApprovalStatusEnum('approval_status').notNull().default('draft'),
  approvedById: text('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionKpiDefinitionsRelations = relations(constructionKpiDefinitions, ({ many }) => ({
  entries: many(constructionKpiEntries),
}))

export const constructionKpiEntriesRelations = relations(constructionKpiEntries, ({ one }) => ({
  definition: one(constructionKpiDefinitions, { fields: [constructionKpiEntries.kpiDefinitionId], references: [constructionKpiDefinitions.id] }),
}))

// ─── Construction Intelligence (Wave 120) ─────────────────────────────────
// Expense heads (material/labour/transport/subcontractor/equipment/misc).
// This is a thin CLASSIFICATION/rollup layer, not a duplicate ledger --
// linkedEntityType/linkedEntityId points back at the real source-of-truth
// row (erp_purchase_invoices, erp_cash_vouchers, or construction_attendance
// for labour cost), matching the documents.linkedEntityType polymorphic-
// pointer precedent already used twice in this codebase. amount is
// snapshotted at classification time, not live-recomputed from the source.
export const constructionExpenseHeadEnum = complianceSchemaDB.enum('construction_expense_head', ['material', 'labour', 'transport', 'subcontractor', 'equipment', 'misc'])

export const constructionExpenseEntries = complianceSchemaDB.table('construction_expense_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  expenseHead: constructionExpenseHeadEnum('expense_head').notNull(),
  description: text('description'),
  amount: numeric('amount').notNull(),
  expenseDate: date('expense_date', { mode: 'string' }).notNull(),
  linkedEntityType: text('linked_entity_type'), // 'erp_purchase_invoice'|'erp_cash_voucher'|'construction_attendance'|null (manual entry)
  linkedEntityId: text('linked_entity_id'),
  recordedById: text('recorded_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Wave 141 (PROJEXA gap analysis: RFIs/Submittals/Punch Lists/Change
// Orders). None of these exist as OSS libraries (confirmed via research --
// "genuine differentiation territory, build in-house"), so this is a
// first-party implementation, matching the exact CRUD/status-workflow
// pattern already used across construction_boq/site_diary/kpi tables.
// Photos/attachments reuse `documents` via its existing linkedEntityType
// convention (category='rfi_attachment' etc.), not new file-storage tables.
// Change Orders reuse esignature-service.ts's real signing workflow
// (extended to accept linkedEntityType='change_order', see that file) --
// not a bespoke approval mechanism. ───────────────────────────────────────
export const constructionRfiStatusEnum = complianceSchemaDB.enum('construction_rfi_status', ['open', 'answered', 'closed'])
export const constructionBallInCourtEnum = complianceSchemaDB.enum('construction_ball_in_court', ['contractor', 'architect', 'owner', 'consultant'])

export const constructionRfis = complianceSchemaDB.table('construction_rfis', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  number: integer('number').notNull(),
  subject: text('subject').notNull(),
  question: text('question').notNull(),
  status: constructionRfiStatusEnum('status').notNull().default('open'),
  ballInCourt: constructionBallInCourtEnum('ball_in_court').notNull().default('architect'),
  raisedById: text('raised_by_id').notNull(),
  assignedToId: text('assigned_to_id'),
  dueDate: date('due_date', { mode: 'string' }),
  answer: text('answer'),
  answeredById: text('answered_by_id'),
  answeredAt: timestamp('answered_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionSubmittalTypeEnum = complianceSchemaDB.enum('construction_submittal_type', ['shop_drawing', 'product_data', 'sample', 'other'])
export const constructionSubmittalStatusEnum = complianceSchemaDB.enum('construction_submittal_status', ['pending', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected'])

export const constructionSubmittals = complianceSchemaDB.table('construction_submittals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  specSection: text('spec_section'),
  type: constructionSubmittalTypeEnum('type').notNull().default('shop_drawing'),
  status: constructionSubmittalStatusEnum('status').notNull().default('pending'),
  submittedById: text('submitted_by_id').notNull(),
  dueDate: date('due_date', { mode: 'string' }),
  reviewedById: text('reviewed_by_id'),
  reviewedAt: timestamp('reviewed_at'),
  reviewComments: text('review_comments'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionPunchStatusEnum = complianceSchemaDB.enum('construction_punch_status', ['open', 'ready_for_review', 'verified_closed'])
export const constructionPunchPriorityEnum = complianceSchemaDB.enum('construction_punch_priority', ['low', 'medium', 'high'])

export const constructionPunchListItems = complianceSchemaDB.table('construction_punch_list_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  number: integer('number').notNull(),
  description: text('description').notNull(),
  location: text('location'),
  trade: text('trade'),
  priority: constructionPunchPriorityEnum('priority').notNull().default('medium'),
  status: constructionPunchStatusEnum('status').notNull().default('open'),
  assignedToId: text('assigned_to_id'),
  dueDate: date('due_date', { mode: 'string' }),
  verifiedById: text('verified_by_id'),
  verifiedAt: timestamp('verified_at'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const constructionChangeOrderStatusEnum = complianceSchemaDB.enum('construction_change_order_status', ['draft', 'pending_approval', 'approved', 'rejected'])

export const constructionChangeOrders = complianceSchemaDB.table('construction_change_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  number: integer('number').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  reason: text('reason'),
  costImpact: numeric('cost_impact').notNull().default('0'), // +/- amount
  scheduleImpactDays: integer('schedule_impact_days').notNull().default(0), // +/- days
  status: constructionChangeOrderStatusEnum('status').notNull().default('draft'),
  requestedById: text('requested_by_id').notNull(),
  approvedById: text('approved_by_id'),
  approvedAt: timestamp('approved_at'),
  esignatureRequestId: text('esignature_request_id'), // nullable FK -- set once sent for signature
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Wave 142 (PROJEXA gap analysis: interior design workflow -- mood
// boards, FF&E specification, procurement markup). Confirmed via research:
// no OSS library exists for either (the one loosely-related repo found,
// a small moodboard image-aggregator, was low-activity/toy-project-grade,
// not production-usable) -- genuine differentiation territory, first-party
// build. Mood board items reuse `documents` for the actual image files
// (same linkedEntityType convention already used for permits/drawings/
// site photos), this table is just the board's own item ordering/labels.
// Procurement markup isn't a separate table -- unitCost (trade/wholesale)
// vs unitPrice (client-billed) sit on the same FF&E line item, margin is
// computed at read time (matches this codebase's query-time-rollup
// convention, e.g. kpi-hub-service.ts), not stored redundantly. ─────────
export const interiorMoodBoardStatusEnum = complianceSchemaDB.enum('interior_mood_board_status', ['draft', 'shared', 'approved'])

export const interiorMoodBoards = complianceSchemaDB.table('interior_mood_boards', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  roomOrArea: text('room_or_area'), // free text, e.g. "Living Room" -- not an enum, matches documents.category's precedent
  title: text('title').notNull(),
  description: text('description'),
  status: interiorMoodBoardStatusEnum('status').notNull().default('draft'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const interiorMoodBoardItems = complianceSchemaDB.table('interior_mood_board_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  moodBoardId: text('mood_board_id').notNull(),
  documentId: text('document_id'), // nullable FK into `documents` (the actual image) -- null while a placeholder/text-only item
  label: text('label'),
  notes: text('notes'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const interiorFfeCategoryEnum = complianceSchemaDB.enum('interior_ffe_category', ['furniture', 'fixture', 'equipment', 'finish', 'textile', 'lighting', 'other'])
export const interiorFfeStatusEnum = complianceSchemaDB.enum('interior_ffe_status', ['specified', 'ordered', 'received', 'installed'])

export const interiorFfeItems = complianceSchemaDB.table('interior_ffe_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  roomOrArea: text('room_or_area'),
  category: interiorFfeCategoryEnum('category').notNull().default('furniture'),
  itemName: text('item_name').notNull(),
  description: text('description'),
  vendorId: text('vendor_id'), // nullable FK into erp_suppliers
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(1),
  unitCost: numeric('unit_cost').notNull().default('0'), // trade/wholesale cost -- never shown to the client
  unitPrice: numeric('unit_price').notNull().default('0'), // client-billed price
  leadTimeDays: integer('lead_time_days'),
  status: interiorFfeStatusEnum('status').notNull().default('specified'),
  documentId: text('document_id'), // nullable FK -- spec sheet/product image
  // Footprint dimensions (cm) -- nullable, only needed once an item is placed
  // in a Wave 143 floor plan; a specified-but-not-yet-placed item has none.
  widthCm: numeric('width_cm'),
  depthCm: numeric('depth_cm'),
  heightCm: numeric('height_cm'),
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Wave 143 (PROJEXA gap analysis, visual design authoring): 2D floor
// plan editor + 3D walkthrough. Rooms are stored as a simple closed
// polygon (jsonb array of {x,y} points, cm) rather than separate wall
// entities with connectivity graphs -- walls are derived as polygon edges
// at render time, matching this codebase's query-time-rollup convention
// and keeping the schema proportionate to an MVP editor, not a full CAD
// tool. Furniture placement reuses Wave 142's interiorFfeItems (a placed
// item is still the same FF&E line item, now with x/y/rotation) rather
// than duplicating item data into a new table. 3D representation is
// primitive-based (extruded polygon + boxes, materials via flat
// color/texture), not glTF asset import -- no OSS 3D-asset pipeline is
// adopted this wave. ───────────────────────────────────────────────────
export const interiorFloorPlans = complianceSchemaDB.table('interior_floor_plans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  floorLevel: text('floor_level'), // free text, e.g. "Ground Floor" -- matches roomOrArea's free-text precedent
  status: text('status').notNull().default('draft'), // draft | final
  createdById: text('created_by_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const interiorMaterialCategoryEnum = complianceSchemaDB.enum('interior_material_category', ['flooring', 'wall', 'ceiling'])

export const interiorMaterials = complianceSchemaDB.table('interior_materials', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  category: interiorMaterialCategoryEnum('category').notNull(),
  colorHex: text('color_hex').notNull().default('#cccccc'), // always-available fallback render even without a texture
  textureDocumentId: text('texture_document_id'), // nullable FK into `documents` -- an uploaded texture/swatch image
  roughness: numeric('roughness').notNull().default('0.8'), // react-three-fiber MeshStandardMaterial props (0-1)
  metalness: numeric('metalness').notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const interiorFloorPlanRooms = complianceSchemaDB.table('interior_floor_plan_rooms', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  floorPlanId: text('floor_plan_id').notNull(),
  name: text('name').notNull(),
  polygon: jsonb('polygon').notNull().$type<{ x: number; y: number }[]>(), // closed polygon, cm, >=3 points
  ceilingHeightCm: numeric('ceiling_height_cm').notNull().default('270'),
  floorMaterialId: text('floor_material_id'), // nullable FK -> interior_materials
  wallMaterialId: text('wall_material_id'),
  ceilingMaterialId: text('ceiling_material_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

export const interiorFurniturePlacements = complianceSchemaDB.table('interior_furniture_placements', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  floorPlanId: text('floor_plan_id').notNull(),
  roomId: text('room_id'), // nullable -- a placement can exist before being assigned to a specific room
  ffeItemId: text('ffe_item_id').notNull(), // FK -> interior_ffe_items (Wave 142) -- one placement per FF&E line item
  x: numeric('x').notNull().default('0'), // cm, room-local coordinate space
  y: numeric('y').notNull().default('0'),
  rotationDeg: numeric('rotation_deg').notNull().default('0'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// ─── Gap closure, 2026-07-09 (AUDIT_2026-07-09.md, Logging & Monitoring
// section) ───────────────────────────────────────────────────────────────
// No APM/error-tracking service exists anywhere in this codebase -- 527
// files' worth of console.error() disappear into Vercel's ephemeral log
// retention with no alerting, aggregation, or historical query capability.
// This table is the pragmatic first step given the real constraints (no
// dedicated ops budget, Vercel+Supabase-only infra): Next.js's built-in
// instrumentation.ts onRequestError hook writes here centrally, reusing the
// DB the app already has rather than adding an external vendor. Gets most
// of the value of an APM without adding cost or a new dependency -- a real
// vendor (Sentry's free tier, etc.) is a reasonable next step once real
// volume through this table is understood, not a prerequisite to closing
// this specific gap. Platform-level, not tenant data (an error can occur
// before orgId is even resolved) -- service_role-bypass-only RLS, same
// posture as loop_executions/token_usage_ledger.
export const applicationErrors = complianceSchemaDB.table('application_errors', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  route: text('route'),
  message: text('message').notNull(),
  stack: text('stack'),
  orgId: text('org_id'),
  userId: text('user_id'),
  digestId: text('digest_id'), // Next.js's own error digest, for cross-referencing Vercel's log output to this row
  createdAt: timestamp('created_at').notNull().defaultNow(),
})

// T0.4 (docs/infra/TOOL_INTEGRATION_PLAN.md): tracking table for on-demand
// doc-processing jobs (PaddleOCR/Docling/Whisper.cpp/LibreOffice). The app
// creates a row (status='pending') before dispatching a repository_dispatch
// event, then polls (or subscribes via Realtime once task #14 lands) for
// the GitHub Actions runner's service-role write to flip status to
// completed/failed and populate result. Tenant-isolated like normal org
// data (unlike applicationErrors above) -- a job always has a known org_id
// from the moment the app creates the row, before dispatch even happens.
export const docProcessingJobs = complianceSchemaDB.table('doc_processing_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  operation: text('operation').notNull(), // 'ocr' | 'parse-document' | 'transcribe' | 'convert'
  status: text('status').notNull().default('pending'), // 'pending' | 'running' | 'completed' | 'failed'
  inputRef: text('input_ref').notNull(), // Supabase Storage path/signed URL -- never the raw file
  result: jsonb('result'),
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
})
